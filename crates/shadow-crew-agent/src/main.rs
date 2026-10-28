mod llm;
mod mcp_client;
mod memory;
mod session_store;

use anyhow::Result;
use memory::AgentMemoryStore;
use session_store::{SessionStore, StoredSession};
use shadow_crew_protocol::{AcpPromptResult, MemoryTrace};
use std::collections::HashMap;
use std::io::{self, BufRead, Write};
use std::path::PathBuf;
use std::sync::Arc;

pub struct SessionState {
    #[allow(dead_code)]
    pub session_id: String,
    #[allow(dead_code)]
    pub session_key: String,
    #[allow(dead_code)]
    pub channel_id: String,
    pub owner_dir: PathBuf,
    pub workspace_dir: PathBuf,
    pub system_prompt: Option<String>,
    pub mcp_pool_key: String,
    pub mcp_client: Option<mcp_client::SharedMcpClient>,
}

/// 受控 MCP 客户端复用池上限：按 (Channel/Agent 作用域 + 规范化工作区路径) 复用，
/// 既保留不同频道/工作区的严格物理隔离，又防止同频道大量 Topic 导致无限派生 MCP 子进程。
pub const MAX_MCP_POOL_SIZE: usize = 8;
const MAX_SESSION_HISTORY_MESSAGES: usize = 48;

struct PooledMcpEntry {
    client: mcp_client::SharedMcpClient,
    last_used_seq: u64,
}

pub struct McpClientPool {
    entries: HashMap<String, PooledMcpEntry>,
    seq: u64,
    max_size: usize,
    #[cfg(test)]
    force_fail_spawn: bool,
}

impl McpClientPool {
    pub fn new(max_size: usize) -> Self {
        Self {
            entries: HashMap::new(),
            seq: 0,
            max_size: max_size.max(1),
            #[cfg(test)]
            force_fail_spawn: false,
        }
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn contains_alive(&mut self, pool_key: &str) -> bool {
        if let Some(existing) = self.entries.get_mut(pool_key) {
            let alive = match existing.client.try_lock() {
                Ok(mut guard) => guard.is_alive(),
                Err(_) => true,
            };
            if alive {
                return true;
            }
            if let Some(dead) = self.entries.remove(pool_key) {
                if let Ok(mut guard) = dead.client.try_lock() {
                    guard.terminate();
                }
            }
        }
        false
    }

    /// 按 (mcp_key, canonical_workspace_dir) 受控获取或启动 MCP 客户端
    pub async fn get_or_spawn(
        &mut self,
        pool_key: &str,
        mcp_key: &str,
        workdir: Option<&str>,
        channel_id: Option<&str>,
    ) -> Option<mcp_client::SharedMcpClient> {
        self.seq = self.seq.wrapping_add(1);
        let now_seq = self.seq;

        if let Some(existing) = self.entries.get_mut(pool_key) {
            let alive = match existing.client.try_lock() {
                Ok(mut guard) => guard.is_alive(),
                Err(_) => true, // 正在执行工具调用，视为存活
            };
            if alive {
                existing.last_used_seq = now_seq;
                return Some(existing.client.clone());
            } else {
                if let Some(dead) = self.entries.remove(pool_key) {
                    if let Ok(mut guard) = dead.client.try_lock() {
                        guard.terminate();
                    }
                }
            }
        }

        // 若池已满，按 LRU 淘汰最久未使用的 MCP 子进程并主动终止
        while self.entries.len() >= self.max_size {
            let oldest_key = self
                .entries
                .iter()
                .min_by_key(|(_, v)| v.last_used_seq)
                .map(|(k, _)| k.clone());
            if let Some(k) = oldest_key {
                if let Some(evicted) = self.entries.remove(&k) {
                    if let Ok(mut guard) = evicted.client.try_lock() {
                        guard.terminate();
                    }
                    eprintln!(
                        "[Shinobi Agent] ♻️ MCP 池达到上限 ({})，已按 LRU 回收闲置工作区客户端: {}",
                        self.max_size, k
                    );
                }
            } else {
                break;
            }
        }

        #[cfg(test)]
        if self.force_fail_spawn {
            eprintln!("[Shinobi Agent] 测试强制模拟 MCP 重连失败 (降级为纯文本推演)");
            return None;
        }

        match mcp_client::NativeMcpClient::spawn_and_connect(workdir, channel_id).await {
            Ok(client) => {
                let tool_names: Vec<String> = client
                    .get_tools()
                    .iter()
                    .filter_map(|t| t["name"].as_str().map(|s| s.to_string()))
                    .collect();
                eprintln!(
                    "[Shinobi Agent] 原生内置 MCP (shinobi-dev-mcp) 挂载成功 (key={}, cwd={:?}, pool={}/{})，可用工具: {:?}",
                    mcp_key,
                    workdir,
                    self.entries.len() + 1,
                    self.max_size,
                    tool_names
                );
                let shared = Arc::new(tokio::sync::Mutex::new(client));
                self.entries.insert(
                    pool_key.to_string(),
                    PooledMcpEntry {
                        client: shared.clone(),
                        last_used_seq: now_seq,
                    },
                );
                Some(shared)
            }
            Err(e) => {
                eprintln!(
                    "[Shinobi Agent] 挂载内置原生 MCP 工具失败 (当前会话降级为纯文本推演，绝不串用其他工作区或已终止的 MCP): {:#}",
                    e
                );
                None
            }
        }
    }

    /// 主动移除并终止不再被任何活跃 Session 引用的 MCP 客户端
    pub fn remove_and_terminate(&mut self, pool_key: &str) {
        if let Some(removed) = self.entries.remove(pool_key) {
            if let Ok(mut guard) = removed.client.try_lock() {
                guard.terminate();
            }
        }
    }
}

/// 同步清理所有已被池淘汰或已终止的 Session MCP 引用，防止悬空持有已终止的客户端
fn prune_dead_session_mcp_refs(
    active_sessions: &mut HashMap<String, SessionState>,
    mcp_pool: &mut McpClientPool,
) {
    for st in active_sessions.values_mut() {
        if !mcp_pool.contains_alive(&st.mcp_pool_key) {
            st.mcp_client = None;
        }
    }
}

/// 纯粹基于路径组件的规范化函数，消除 . 与 .. 相对段，不依赖底层文件系统实际存在
pub fn normalize_path(path: &std::path::Path) -> PathBuf {
    use std::path::Component;
    let mut out = PathBuf::new();
    for comp in path.components() {
        match comp {
            Component::Prefix(p) => out.push(Component::Prefix(p)),
            Component::RootDir => out.push(Component::RootDir),
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            Component::Normal(c) => out.push(c),
        }
    }
    out
}

/// 严格校验工作区单段标识符（Channel ID / Agent ID）：
/// 严禁静默剥离 `/`、`\` 或 `:` 导致 `"a/b"` 与 `"ab"` 发生目录别名碰撞，或破坏复合 Session Key 结构分隔，非法 ID 直接返回 Err 拒绝。
pub fn validate_workspace_segment(raw: &str) -> std::result::Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("workspace segment cannot be empty".to_string());
    }
    if trimmed == "."
        || trimmed == ".."
        || trimmed.starts_with('.')
        || trimmed.ends_with('.')
        || trimmed.contains("..")
    {
        return Err(format!(
            "invalid workspace segment '{}': relative dot segments are forbidden",
            raw
        ));
    }
    if trimmed
        .chars()
        .any(|c| c == ':' || c == '/' || c == '\\' || c == '\0' || c.is_control())
    {
        return Err(format!(
            "invalid workspace segment '{}': colons, path separators, and control characters are forbidden",
            raw
        ));
    }
    Ok(trimmed.to_string())
}

/// 严格校验复合 Session Key 结构与各段合法性：
/// - `dm:<agentId>:<roomId>` (固定 3 段)
/// - `channel:<channelId>:<roomId>` (固定 3 段)
/// - `topic:<channelId>:<topicId>:<discussionMode>` (固定 4 段)
/// - 单段自定义标识 (1 段)
/// 任何段内包含非法字符或段数不匹配（如因 ID 含 `:` 导致被拆成多余段）均直接返回 Err 拒绝。
pub fn validate_session_key(raw_key: &str) -> std::result::Result<String, String> {
    let trimmed = raw_key.trim();
    if trimmed.is_empty() {
        return Err("sessionKey cannot be empty".to_string());
    }
    let parts: Vec<&str> = trimmed.split(':').collect();
    match parts[0] {
        "dm" | "channel" => {
            if parts.len() != 3 {
                return Err(format!(
                    "invalid sessionKey '{}': '{}' namespace requires exactly 3 colon-separated segments (found {})",
                    raw_key,
                    parts[0],
                    parts.len()
                ));
            }
            validate_workspace_segment(parts[1])?;
            validate_workspace_segment(parts[2])?;
            Ok(trimmed.to_string())
        }
        "topic" => {
            if parts.len() != 4 {
                return Err(format!(
                    "invalid sessionKey '{}': 'topic' namespace requires exactly 4 colon-separated segments (found {})",
                    raw_key,
                    parts.len()
                ));
            }
            validate_workspace_segment(parts[1])?;
            validate_workspace_segment(parts[2])?;
            validate_workspace_segment(parts[3])?;
            Ok(trimmed.to_string())
        }
        _ => {
            if parts.len() != 1 {
                return Err(format!(
                    "invalid sessionKey '{}': unrecognized multi-segment prefix '{}'",
                    raw_key, parts[0]
                ));
            }
            validate_workspace_segment(parts[0])
        }
    }
}

/// 严格校验并解析目标工作区路径（词法规范化 + 符号链接穿透 canonicalize 真实路径校验）
/// 1. 必须在创建任何目录前校验已有祖先路径，防止通过指向沙箱外的 symlink 在外部创建目录
/// 2. 禁止目标工作区目录本身或其沙箱内父级容器为 symlink
/// 3. 穿透解析全部已存在祖先的符号链接，确保最终真实物理路径严格位于规范化的 shadow_crew_home 之下
pub fn validate_and_resolve_workspace_dir(
    candidate: &std::path::Path,
    shadow_crew_home: &std::path::Path,
) -> Option<PathBuf> {
    let _ = std::fs::create_dir_all(shadow_crew_home);
    let canonical_home = std::fs::canonicalize(shadow_crew_home)
        .unwrap_or_else(|_| normalize_path(shadow_crew_home));
    let norm_home = normalize_path(shadow_crew_home);
    let norm_candidate = normalize_path(candidate);

    if !norm_candidate.starts_with(&norm_home) && !norm_candidate.starts_with(&canonical_home) {
        return None;
    }

    // 严禁将沙箱根目录 (~/.shadow-crew) 本身直接作为会话工作区，必须位于独立子目录下
    if norm_candidate == norm_home || norm_candidate == canonical_home {
        return None;
    }

    // 目标工作区目录本身绝不允许是符号链接（无论是有效还是悬空 symlink）
    if let Ok(meta) = std::fs::symlink_metadata(&norm_candidate) {
        if meta.file_type().is_symlink() {
            return None;
        }
    }

    // 检查从候选路径向上到沙箱根之间的每一级已存在组件是否包含符号链接
    for ancestor in norm_candidate.ancestors() {
        if ancestor == norm_home || ancestor == canonical_home {
            break;
        }
        if let Ok(meta) = std::fs::symlink_metadata(ancestor) {
            if meta.file_type().is_symlink() {
                match std::fs::canonicalize(ancestor) {
                    Ok(real_target) if real_target.starts_with(&canonical_home) => {}
                    _ => return None,
                }
            }
        }
    }

    // 定位最深层已存在的祖先目录并执行 canonicalize，再拼接尚未创建的相对子路径
    let mut existing_ancestor = norm_candidate.as_path();
    let mut missing_tail = Vec::new();
    while !existing_ancestor.exists() {
        if std::fs::symlink_metadata(existing_ancestor).is_ok() {
            // 祖先中存在悬空符号链接
            return None;
        }
        if let Some(name) = existing_ancestor.file_name() {
            missing_tail.push(name.to_os_string());
        } else {
            return None;
        }
        match existing_ancestor.parent() {
            Some(parent) if !parent.as_os_str().is_empty() => {
                existing_ancestor = parent;
            }
            _ => return None,
        }
    }

    let canonical_existing = std::fs::canonicalize(existing_ancestor).ok()?;
    if !canonical_existing.starts_with(&canonical_home) {
        return None;
    }

    let mut resolved = canonical_existing;
    for comp in missing_tail.iter().rev() {
        resolved.push(comp);
    }

    if !resolved.starts_with(&canonical_home) {
        return None;
    }

    if let Ok(meta) = std::fs::symlink_metadata(&resolved) {
        if meta.file_type().is_symlink() {
            return None;
        }
    }

    // 通过符号链接与真实路径前置校验后，安全创建目录并二次验证 canonicalize 结果
    if std::fs::create_dir_all(&resolved).is_err() {
        return None;
    }
    if std::fs::symlink_metadata(&resolved)
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(true)
    {
        return None;
    }
    let final_canonical = std::fs::canonicalize(&resolved).ok()?;
    if final_canonical.starts_with(&canonical_home) && final_canonical != canonical_home {
        Some(final_canonical)
    } else {
        None
    }
}

/// 安全解析并创建兜底沙箱目录（例如 channels/chan-safe-default 或 agents/agent-safe-default）：
/// 1. 若兜底路径或其父目录被预先植入了 symlink，先主动拔除恶意 symlink 并强制通过 validate_and_resolve_workspace_dir 校验；
/// 2. 若合法 fallback 与进程隔离 fallback 均创建或校验失败，按 Fail-Closed 策略返回 Err，绝不退回至沙箱根目录 (~/.shadow-crew)。
pub fn resolve_safe_fallback_dir(
    home: &std::path::Path,
    category: &str,
    default_name: &str,
) -> std::result::Result<PathBuf, String> {
    let _ = std::fs::create_dir_all(home);
    let canonical_home = std::fs::canonicalize(home).unwrap_or_else(|_| normalize_path(home));
    let cat_dir = canonical_home.join(category);
    if std::fs::symlink_metadata(&cat_dir)
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(false)
    {
        let _ = std::fs::remove_file(&cat_dir);
        let _ = std::fs::remove_dir(&cat_dir);
    }
    let _ = std::fs::create_dir_all(&cat_dir);

    let fallback = cat_dir.join(default_name);
    if std::fs::symlink_metadata(&fallback)
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(false)
    {
        let _ = std::fs::remove_file(&fallback);
        let _ = std::fs::remove_dir(&fallback);
    }

    if let Some(verified) = validate_and_resolve_workspace_dir(&fallback, &canonical_home) {
        return Ok(verified);
    }

    let isolated = cat_dir.join(format!("{}-isolated-{}", default_name, std::process::id()));
    if std::fs::symlink_metadata(&isolated)
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(false)
    {
        let _ = std::fs::remove_file(&isolated);
        let _ = std::fs::remove_dir(&isolated);
    }
    validate_and_resolve_workspace_dir(&isolated, &canonical_home).ok_or_else(|| {
        format!(
            "Failed to resolve or create safe fallback workspace under {:?}/{} (fail-closed: refusing to fall back to sandbox root)",
            canonical_home, category
        )
    })
}

/// 解析用户级全局 Shadow Crew 根目录 (~/.shadow-crew)
fn get_shadow_crew_home_dir() -> std::path::PathBuf {
    let base = std::env::var("SHADOW_CREW_HOME")
        .or_else(|_| std::env::var("SHINOBI_HOME"))
        .ok()
        .map(std::path::PathBuf::from)
        .or_else(|| {
            if cfg!(target_os = "windows") {
                std::env::var("USERPROFILE")
                    .ok()
                    .map(std::path::PathBuf::from)
            } else {
                std::env::var("HOME").ok().map(std::path::PathBuf::from)
            }
        })
        .unwrap_or_else(|| std::path::PathBuf::from("."));

    if base.ends_with(".shadow-crew") {
        base
    } else {
        base.join(".shadow-crew")
    }
}

/// 解析并创建指定频道的独立私有工作区 (~/.shadow-crew/channels/<channel_id>)，失败时返回 Err (Fail-Closed)
pub fn try_get_channel_dir_with_home(
    channel_id: &str,
    home: &std::path::Path,
) -> std::result::Result<PathBuf, String> {
    let safe_dir = match validate_workspace_segment(channel_id) {
        Ok(valid_id) => {
            let candidate = home.join("channels").join(&valid_id);
            match validate_and_resolve_workspace_dir(&candidate, home) {
                Some(dir) => Ok(dir),
                None => resolve_safe_fallback_dir(home, "channels", "chan-safe-default"),
            }
        }
        Err(_) => resolve_safe_fallback_dir(home, "channels", "chan-safe-default"),
    }?;
    std::fs::create_dir_all(safe_dir.join("artifacts"))
        .map_err(|e| format!("Failed to create channel artifacts dir: {}", e))?;
    std::fs::create_dir_all(safe_dir.join("scratch"))
        .map_err(|e| format!("Failed to create channel scratch dir: {}", e))?;
    Ok(safe_dir)
}

#[cfg(test)]
pub fn get_channel_dir_with_home(channel_id: &str, home: &std::path::Path) -> std::path::PathBuf {
    try_get_channel_dir_with_home(channel_id, home).expect("get_channel_dir_with_home failed")
}

/// 解析并创建指定 Agent 的独立私有工作区 (~/.shadow-crew/agents/<agent_id>)，失败时返回 Err (Fail-Closed)
pub fn try_get_agent_dir_with_home(
    agent_id: &str,
    home: &std::path::Path,
) -> std::result::Result<PathBuf, String> {
    let safe_dir = match validate_workspace_segment(agent_id) {
        Ok(valid_id) => {
            let candidate = home.join("agents").join(&valid_id);
            match validate_and_resolve_workspace_dir(&candidate, home) {
                Some(dir) => Ok(dir),
                None => resolve_safe_fallback_dir(home, "agents", "agent-safe-default"),
            }
        }
        Err(_) => resolve_safe_fallback_dir(home, "agents", "agent-safe-default"),
    }?;
    std::fs::create_dir_all(safe_dir.join("artifacts"))
        .map_err(|e| format!("Failed to create agent artifacts dir: {}", e))?;
    std::fs::create_dir_all(safe_dir.join("scratch"))
        .map_err(|e| format!("Failed to create agent scratch dir: {}", e))?;
    Ok(safe_dir)
}

#[cfg(test)]
pub fn get_agent_dir_with_home(agent_id: &str, home: &std::path::Path) -> std::path::PathBuf {
    try_get_agent_dir_with_home(agent_id, home).expect("get_agent_dir_with_home failed")
}

#[derive(Debug, Clone)]
pub struct ResolvedNewSessionConfig {
    pub session_channel_id: String,
    pub is_dm: bool,
    pub owner_dir: PathBuf,
    pub target_workspace_dir: PathBuf,
    pub effective_key: String,
    pub unique_session_id: String,
    pub mcp_key: String,
    pub mcp_pool_key: String,
}

/// 解析并校验 `session/new` 请求参数与隔离工作区（纯函数入口，供主循环与单元测试共用）：
/// 1. 严格校验 `channelId` / `agentId` / `sessionKey` 段合法性（含冒号 `:` 与路径分隔符拦截），非法时返回 `(-32602, ...)`；
/// 2. 判定 `is_dm` 时严格依据显式 `sessionKey` 前缀 (`dm:` vs `channel:`/`topic:`) 或无 `channelId` 时的显式 `params.agentId`，
///    绝不因进程环境变量 `SHADOW_CREW_AGENT_ID` 存在而把正常频道会话误判为私聊；
/// 3. 严格校验自定义 `cwd` 必须归属于当前会话所属的 `channels/<channelId>` 或 `agents/<agentId>` 专属目录（及其子目录），严禁跨频道或跨 Agent 混用工作区；
/// 4. 若主路径与 fallback 隔离路径均无法安全创建，返回 `(-32002, ...)` 拒绝建连，绝不退回至 `~/.shadow-crew` 根目录。
pub fn resolve_new_session_config(
    params: &serde_json::Value,
    shadow_crew_home: &std::path::Path,
    env_agent_id: Option<&str>,
) -> std::result::Result<ResolvedNewSessionConfig, (i32, String)> {
    let raw_session_key = params
        .get("sessionKey")
        .and_then(|v| v.as_str())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty());

    let session_key = match raw_session_key {
        Some(sk) => match validate_session_key(sk) {
            Ok(valid) => Some(valid),
            Err(err_msg) => {
                return Err((-32602, format!("Invalid params (sessionKey): {}", err_msg)));
            }
        },
        None => None,
    };

    let raw_cid = params
        .get("channelId")
        .and_then(|v| v.as_str())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty());

    let validated_cid = match raw_cid {
        Some(c) => match validate_workspace_segment(c) {
            Ok(valid) => Some(valid),
            Err(err_msg) => {
                return Err((-32602, format!("Invalid params (channelId): {}", err_msg)));
            }
        },
        None => None,
    };

    let validated_env_agent_id = env_agent_id.and_then(|s| validate_workspace_segment(s).ok());
    let raw_param_agent_id = params
        .get("agentId")
        .and_then(|v| v.as_str())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty());

    let validated_param_agent_id = match raw_param_agent_id {
        Some(a) => match validate_workspace_segment(a) {
            Ok(valid) => Some(valid),
            Err(err_msg) => {
                return Err((-32602, format!("Invalid params (agentId): {}", err_msg)));
            }
        },
        None => None,
    };

    let mut sk_channel_id: Option<String> = None;
    let mut sk_agent_id: Option<String> = None;
    if let Some(ref sk) = session_key {
        let parts: Vec<&str> = sk.split(':').collect();
        if parts[0] == "dm" && parts.len() == 3 {
            if let Some(ref param_aid) = validated_param_agent_id {
                if param_aid != parts[1] {
                    return Err((
                        -32602,
                        format!(
                            "Invalid params: sessionKey agentId '{}' does not match agentId '{}'",
                            parts[1], param_aid
                        ),
                    ));
                }
            }
            sk_agent_id = Some(parts[1].to_string());
        } else if (parts[0] == "channel" || parts[0] == "topic") && parts.len() >= 3 {
            if let Some(ref param_cid) = validated_cid {
                if param_cid != parts[1] {
                    return Err((
                        -32602,
                        format!(
                            "Invalid params: sessionKey channelId '{}' does not match channelId '{}'",
                            parts[1], param_cid
                        ),
                    ));
                }
            }
            sk_channel_id = Some(parts[1].to_string());
        }
    }

    let session_channel_id = validated_cid
        .clone()
        .or(sk_channel_id)
        .unwrap_or_else(|| "chan-default".to_string());

    // DM 判定优先级：
    // 1. 显式 sessionKey 前缀 ("dm:" -> true, "channel:" / "topic:" -> false)
    // 2. 若显式传入了 channelId：仅当 channelId 为 "dm-*" 或 "direct-messages" 时为 DM，否则一律为频道会话（无视 SHADOW_CREW_AGENT_ID 环境变量）
    // 3. 未传 channelId 时：仅当请求参数显式带有 agentId 时判定为 DM
    let is_dm = if let Some(ref sk) = session_key {
        if sk.starts_with("dm:") {
            true
        } else if sk.starts_with("channel:") || sk.starts_with("topic:") {
            false
        } else if let Some(ref cid) = validated_cid {
            cid.starts_with("dm-") || cid == "direct-messages"
        } else {
            validated_param_agent_id.is_some()
        }
    } else if let Some(ref cid) = validated_cid {
        cid.starts_with("dm-") || cid == "direct-messages"
    } else {
        validated_param_agent_id.is_some()
    };

    let effective_agent_id = validated_param_agent_id
        .as_deref()
        .or(sk_agent_id.as_deref())
        .or(validated_env_agent_id.as_deref())
        .unwrap_or("agent-default");

    let expected_owner_dir = if is_dm {
        try_get_agent_dir_with_home(effective_agent_id, shadow_crew_home)
            .map_err(|e| (-32002, e))?
    } else {
        try_get_channel_dir_with_home(&session_channel_id, shadow_crew_home)
            .map_err(|e| (-32002, e))?
    };

    let logical_owner_dir = if is_dm {
        normalize_path(&shadow_crew_home.join("agents").join(effective_agent_id))
    } else {
        normalize_path(&shadow_crew_home.join("channels").join(&session_channel_id))
    };

    let target_workspace_dir = if let Some(cwd) = params
        .get("cwd")
        .and_then(|v| v.as_str())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    {
        let expanded = if cwd.starts_with("~/") || cwd == "~" {
            let user_home = std::env::var("HOME")
                .or_else(|_| std::env::var("USERPROFILE"))
                .unwrap_or_default();
            cwd.replacen('~', &user_home, 1)
        } else {
            cwd.to_string()
        };
        let p = PathBuf::from(expanded);
        let candidate = if p.is_relative() {
            shadow_crew_home.join(p)
        } else {
            p
        };
        let norm_candidate = normalize_path(&candidate);

        let rebased_subpath =
            if norm_candidate == logical_owner_dir || norm_candidate == expected_owner_dir {
                Some(PathBuf::new())
            } else if let Ok(rel) = norm_candidate.strip_prefix(&expected_owner_dir) {
                Some(rel.to_path_buf())
            } else if let Ok(rel) = norm_candidate.strip_prefix(&logical_owner_dir) {
                Some(rel.to_path_buf())
            } else {
                None
            };

        match rebased_subpath {
            Some(rel) if rel.as_os_str().is_empty() => expected_owner_dir.clone(),
            Some(rel) => {
                let scoped_candidate = expected_owner_dir.join(rel);
                if let Some(safe_canonical) =
                    validate_and_resolve_workspace_dir(&scoped_candidate, &expected_owner_dir)
                {
                    if std::fs::create_dir_all(safe_canonical.join("artifacts")).is_ok()
                        && std::fs::create_dir_all(safe_canonical.join("scratch")).is_ok()
                    {
                        safe_canonical
                    } else {
                        expected_owner_dir.clone()
                    }
                } else {
                    eprintln!(
                        "[Shinobi Agent] ⚠️ 检测到工作区子路径或符号链接越界尝试 (cwd: {:?})，已强制收敛至所属专属目录 {:?}",
                        candidate, expected_owner_dir
                    );
                    expected_owner_dir.clone()
                }
            }
            None => {
                eprintln!(
                    "[Shinobi Agent] ⚠️ 检测到跨频道/跨Agent工作区访问或沙箱越界尝试 (cwd: {:?}, expected_owner: {:?})，已强制隔离至当前会话专属目录",
                    candidate, expected_owner_dir
                );
                expected_owner_dir.clone()
            }
        }
    } else {
        expected_owner_dir.clone()
    };

    let channel_cwd_str = target_workspace_dir.to_string_lossy().to_string();
    let mcp_key = if is_dm {
        format!("agent:{}", effective_agent_id)
    } else {
        session_channel_id.clone()
    };
    let mcp_pool_key = format!("{}::{}", mcp_key, channel_cwd_str);

    let effective_key = session_key.unwrap_or_else(|| {
        if is_dm {
            format!("dm:{}:thread", effective_agent_id)
        } else {
            format!("topic:{}:chan:standard", session_channel_id)
        }
    });
    let unique_session_id = format!("shinobi-session-{}", effective_key);

    Ok(ResolvedNewSessionConfig {
        session_channel_id,
        is_dm,
        owner_dir: expected_owner_dir,
        target_workspace_dir,
        effective_key,
        unique_session_id,
        mcp_key,
        mcp_pool_key,
    })
}

/// 原子安全进入工作区目录：
/// 在 Unix 环境下利用 O_DIRECTORY | O_NOFOLLOW 与 fchdir，确保从路径解析到进程当前工作目录变更之间绝无 symlink 竞争窗口；
/// 若目标路径在最后一刻被替换为 symlink，系统调用立即拒绝 (ELOOP/ENOTDIR)，绝不跟随沙箱外路径。
#[cfg(unix)]
pub fn enter_workspace_dir_safe(dir: &std::path::Path) -> std::io::Result<()> {
    use std::os::unix::ffi::OsStrExt;
    let c_path = std::ffi::CString::new(dir.as_os_str().as_bytes())
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidInput, e))?;
    let fd = unsafe {
        libc::open(
            c_path.as_ptr(),
            libc::O_RDONLY | libc::O_DIRECTORY | libc::O_CLOEXEC | libc::O_NOFOLLOW,
        )
    };
    if fd < 0 {
        return Err(std::io::Error::last_os_error());
    }
    let chdir_res = unsafe { libc::fchdir(fd) };
    let chdir_err = if chdir_res < 0 {
        Some(std::io::Error::last_os_error())
    } else {
        None
    };
    unsafe { libc::close(fd) };
    if let Some(err) = chdir_err {
        return Err(err);
    }
    Ok(())
}

#[cfg(not(unix))]
pub fn enter_workspace_dir_safe(dir: &std::path::Path) -> std::io::Result<()> {
    std::env::set_current_dir(dir)?;
    let cur = std::env::current_dir()?;
    let cur_canonical = std::fs::canonicalize(&cur)?;
    let dir_canonical = std::fs::canonicalize(dir)?;
    if cur_canonical != dir_canonical {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "Security violation: working directory changed during switch",
        ));
    }
    Ok(())
}

/// 在 `session/prompt` 每次进入工作区前对已保存的 `session_state.workspace_dir` 进行实时 TOCTOU 复验：
/// 1. 校验沙箱根目录 `shadow_crew_home` 非符号链接并完成 `canonicalize`；
/// 2. 校验当前会话所属的专属所有者目录 `session_state.owner_dir` 非符号链接且位于 `canonical_home` 的对应类别（channels/ 或 agents/）下；
/// 3. 逐级校验 `session_state.workspace_dir` 及其到 `canonical_home` 的每一级目录均真实存在且绝非 symlink，同时校验 `canonicalize` 后的真实物理路径未漂移、未跨出该会话的 `canonical_owner` 目录；
/// 4. 校验工作区内的 `meta.json`、`memory.sqlite`、`artifacts`、`scratch` 若存在则不得为 symlink；
/// 5. 一旦检测到 `session/new` 之后发生了目录或文件的 symlink 替换（TOCTOU 攻击），立即返回 `Err((-32003, ...))` 拒绝执行。
pub fn revalidate_session_workspace_dir(
    session_state: &SessionState,
    shadow_crew_home: &std::path::Path,
) -> std::result::Result<PathBuf, (i32, String)> {
    let home_meta = std::fs::symlink_metadata(shadow_crew_home).map_err(|e| {
        (
            -32003,
            format!(
                "Security violation (TOCTOU): shadow_crew_home missing or inaccessible: {}",
                e
            ),
        )
    })?;
    if home_meta.file_type().is_symlink() || !home_meta.is_dir() {
        return Err((
            -32003,
            "Security violation (TOCTOU): shadow_crew_home is a symlink or not a directory"
                .to_string(),
        ));
    }
    let canonical_home = std::fs::canonicalize(shadow_crew_home).map_err(|e| {
        (
            -32003,
            format!(
                "Security violation (TOCTOU): failed to canonicalize shadow_crew_home: {}",
                e
            ),
        )
    })?;

    // 校验会话所属的顶层隔离所有者目录 (session_state.owner_dir)
    let is_dm_session = session_state.session_key.starts_with("dm:")
        || session_state.mcp_pool_key.starts_with("agent:")
        || session_state.channel_id.starts_with("dm-")
        || session_state.channel_id == "direct-messages";

    let expected_category = if is_dm_session { "agents" } else { "channels" };
    let category_root = canonical_home.join(expected_category);

    let owner_meta = std::fs::symlink_metadata(&session_state.owner_dir).map_err(|e| {
        (
            -32003,
            format!(
                "Security violation (TOCTOU): owner_dir {:?} missing or inaccessible: {}",
                session_state.owner_dir, e
            ),
        )
    })?;
    if owner_meta.file_type().is_symlink() || !owner_meta.is_dir() {
        return Err((
            -32003,
            format!(
                "Security violation (TOCTOU): owner_dir {:?} was replaced with a symlink or non-directory",
                session_state.owner_dir
            ),
        ));
    }

    let canonical_owner = std::fs::canonicalize(&session_state.owner_dir).map_err(|e| {
        (
            -32003,
            format!(
                "Security violation (TOCTOU): failed to canonicalize owner_dir {:?}: {}",
                session_state.owner_dir, e
            ),
        )
    })?;

    if !canonical_owner.starts_with(&category_root) || canonical_owner == category_root {
        return Err((
            -32003,
            format!(
                "Security violation (TOCTOU): canonical owner {:?} escaped expected category sandbox {:?}",
                canonical_owner, category_root
            ),
        ));
    }

    // 校验 workspace_dir 本身非 symlink 且为真实目录
    let ws_meta = std::fs::symlink_metadata(&session_state.workspace_dir).map_err(|e| {
        (
            -32003,
            format!(
                "Security violation (TOCTOU): workspace_dir {:?} missing or inaccessible: {}",
                session_state.workspace_dir, e
            ),
        )
    })?;
    if ws_meta.file_type().is_symlink() || !ws_meta.is_dir() {
        return Err((
            -32003,
            format!(
                "Security violation (TOCTOU): workspace_dir {:?} was replaced with a symlink or non-directory",
                session_state.workspace_dir
            ),
        ));
    }

    // 逐级向上检查从 workspace_dir 到 canonical_home 的每一个祖先节点，严禁任何一级被替换为 symlink
    let mut cursor: Option<&std::path::Path> = Some(session_state.workspace_dir.as_path());
    let mut reached_home = false;
    while let Some(curr) = cursor {
        let meta = std::fs::symlink_metadata(curr).map_err(|e| {
            (
                -32003,
                format!(
                    "Security violation (TOCTOU): ancestor {:?} inaccessible: {}",
                    curr, e
                ),
            )
        })?;
        if meta.file_type().is_symlink() {
            return Err((
                -32003,
                format!(
                    "Security violation (TOCTOU): workspace ancestor {:?} was replaced with a symlink",
                    curr
                ),
            ));
        }
        if curr == canonical_home.as_path() || curr == shadow_crew_home {
            reached_home = true;
            break;
        }
        cursor = curr.parent();
    }
    if !reached_home {
        return Err((
            -32003,
            format!(
                "Security violation (TOCTOU): workspace_dir {:?} does not descend from shadow_crew_home {:?}",
                session_state.workspace_dir, canonical_home
            ),
        ));
    }

    // 二次 canonicalize 校验真实物理路径未逃逸出 canonical_home 及会话所属的 canonical_owner
    let canonical_ws = std::fs::canonicalize(&session_state.workspace_dir).map_err(|e| {
        (
            -32003,
            format!(
                "Security violation (TOCTOU): failed to canonicalize workspace_dir {:?}: {}",
                session_state.workspace_dir, e
            ),
        )
    })?;

    if !canonical_ws.starts_with(&canonical_home)
        || canonical_ws == canonical_home
        || !canonical_ws.starts_with(&canonical_owner)
    {
        return Err((
            -32003,
            format!(
                "Security violation (TOCTOU): canonical workspace {:?} escaped expected owner sandbox {:?}",
                canonical_ws, canonical_owner
            ),
        ));
    }

    // 校验工作区内部关键文件与子目录（meta.json, memory.sqlite, artifacts, scratch）未被替换为 symlink
    for entry_name in ["meta.json", "memory.sqlite", "artifacts", "scratch"] {
        let candidate_entry = canonical_ws.join(entry_name);
        if let Ok(entry_meta) = std::fs::symlink_metadata(&candidate_entry) {
            if entry_meta.file_type().is_symlink() {
                return Err((
                    -32003,
                    format!(
                        "Security violation (TOCTOU): workspace entry {:?} was replaced with a symlink",
                        candidate_entry
                    ),
                ));
            }
        }
    }

    Ok(canonical_ws)
}

#[tokio::main]
async fn main() -> Result<()> {
    // 实例化私有持久化 SQLite 记忆引擎 (收敛至 ~/.shadow-crew/global_memory.sqlite)
    let db_path = std::env::var("SHADOW_CREW_MEMORY_DB")
        .or_else(|_| std::env::var("SHINOBI_MEMORY_DB"))
        .ok()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| {
            let home = get_shadow_crew_home_dir();
            let _ = std::fs::create_dir_all(&home);
            home.join("global_memory.sqlite")
                .to_string_lossy()
                .to_string()
        });
    let is_first_init = !std::path::Path::new(&db_path).exists();
    let memory_store = AgentMemoryStore::new(&db_path)?;

    // 若新创建的主数据库，写入初始替身认知
    if is_first_init {
        let _ = memory_store.store(
            "identity",
            "alter_ego_role",
            "我是用户的 AI 影替身 (Shinobi Alter-Ego)，代表主人参与技术架构推演与代码审查",
        );
        let _ = memory_store.store(
            "coding_style",
            "rust_guidelines",
            "严禁 unwrap，优先使用 anyhow/thiserror；异步操作一律基于 Tokio",
        );
    }

    let shadow_crew_home = get_shadow_crew_home_dir();
    let _ = std::fs::create_dir_all(&shadow_crew_home);
    let _ = std::env::set_current_dir(&shadow_crew_home);
    let session_store_agent_id = std::env::var("SHADOW_CREW_AGENT_ID")
        .ok()
        .and_then(|raw| validate_workspace_segment(&raw).ok())
        .unwrap_or_else(|| "agent-default".to_string());
    let session_store_dir = shadow_crew_home.join("cache").join("native-agent-sessions");
    let _ = std::fs::create_dir_all(&session_store_dir);
    let mut session_store = SessionStore::new(
        &session_store_dir
            .join(format!("{}.sqlite", session_store_agent_id))
            .to_string_lossy(),
    )?;

    let stdin = io::stdin();
    let stdout_shared = Arc::new(std::sync::Mutex::new(io::stdout()));
    let reader = stdin.lock();

    // 底座模型配置由宿主通过 SHADOW_CREW_LLM_* 环境变量注入
    let llm_config = llm::LlmConfig::from_env();
    let mut active_sessions: HashMap<String, SessionState> = HashMap::new();
    let mut mcp_pool = McpClientPool::new(MAX_MCP_POOL_SIZE);

    // 持续监听来自 Tauri 宿主或父进程的 stdio JSON-RPC 2.0 请求
    for line in reader.lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }

        if let Ok(json_req) = serde_json::from_str::<serde_json::Value>(&line) {
            let id = json_req.get("id").cloned().unwrap_or(serde_json::json!(1));
            let method = json_req
                .get("method")
                .and_then(|v| v.as_str())
                .unwrap_or("session/prompt");
            let params = json_req
                .get("params")
                .cloned()
                .unwrap_or(serde_json::json!({}));

            if method == "initialize" {
                let resp = serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "result": {
                        "protocolVersion": 1,
                        "agentInfo": { "name": "shadow-crew-agent", "version": "0.1.0" },
                        "agentCapabilities": {
                            "prompts": { "listChanged": true },
                            "tools": { "listChanged": true },
                            "memory": { "persistent": true, "backend": "sqlite" },
                            "workspace": { "canDirectExec": true },
                            "sessionCapabilities": {
                                "resume": {}
                            }
                        },
                        "capabilities": {
                            "prompts": { "listChanged": true },
                            "tools": { "listChanged": true },
                            "memory": { "persistent": true, "backend": "sqlite" },
                            "workspace": { "canDirectExec": true }
                        }
                    }
                });
                if let Ok(mut out) = stdout_shared.lock() {
                    writeln!(out, "{}", resp.to_string())?;
                    out.flush()?;
                }
            } else if method == "session/new" {
                let env_agent_id = std::env::var("SHADOW_CREW_AGENT_ID").ok();
                let resolved_cfg = match resolve_new_session_config(
                    &params,
                    &shadow_crew_home,
                    env_agent_id.as_deref(),
                ) {
                    Ok(cfg) => cfg,
                    Err((code, message)) => {
                        let err_resp = serde_json::json!({
                            "jsonrpc": "2.0",
                            "id": id,
                            "error": {
                                "code": code,
                                "message": message
                            }
                        });
                        if let Ok(mut out) = stdout_shared.lock() {
                            writeln!(out, "{}", err_resp.to_string())?;
                            out.flush()?;
                        }
                        continue;
                    }
                };

                let session_channel_id = resolved_cfg.session_channel_id;
                let is_dm = resolved_cfg.is_dm;
                let target_workspace_dir = resolved_cfg.target_workspace_dir;
                let channel_cwd_str = target_workspace_dir.to_string_lossy().to_string();
                let _ = enter_workspace_dir_safe(&target_workspace_dir);

                let meta_file = target_workspace_dir.join("meta.json");
                let now_secs = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs();
                let meta_obj = serde_json::json!({
                    "channelId": session_channel_id,
                    "createdAt": now_secs,
                    "lastActive": now_secs,
                    "workspaceDir": channel_cwd_str,
                    "artifactsDir": target_workspace_dir.join("artifacts").to_string_lossy(),
                    "scratchDir": target_workspace_dir.join("scratch").to_string_lossy(),
                });
                let _ = std::fs::write(&meta_file, meta_obj.to_string());

                let sp = params
                    .get("systemPrompt")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());

                // 按 (Channel/Agent 作用域 + 规范化工作区路径) 受控复用 MCP 客户端池，
                // 严格保持不同频道/工作区物理隔离，同时杜绝大量 Topic 无限派生 MCP 子进程
                let mcp_key = resolved_cfg.mcp_key;
                let mcp_pool_key = resolved_cfg.mcp_pool_key;
                let effective_key = resolved_cfg.effective_key;
                let unique_session_id = resolved_cfg.unique_session_id;
                let stored_session = StoredSession {
                    session_id: unique_session_id.clone(),
                    session_key: effective_key.clone(),
                    channel_id: session_channel_id.clone(),
                    owner_dir: resolved_cfg.owner_dir.clone(),
                    workspace_dir: target_workspace_dir.clone(),
                    system_prompt: sp.clone(),
                    mcp_pool_key: mcp_pool_key.clone(),
                };
                if let Err(e) = session_store.upsert_session(&stored_session, true) {
                    let err_resp = serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "error": {
                            "code": -32603,
                            "message": format!("Failed to persist native ACP session: {:#}", e)
                        }
                    });
                    if let Ok(mut out) = stdout_shared.lock() {
                        let _ = writeln!(out, "{}", err_resp.to_string());
                        let _ = out.flush();
                    }
                    continue;
                }

                let chan_param = if is_dm {
                    None
                } else {
                    Some(session_channel_id.as_str())
                };
                let session_mcp = mcp_pool
                    .get_or_spawn(&mcp_pool_key, &mcp_key, Some(&channel_cwd_str), chan_param)
                    .await;
                prune_dead_session_mcp_refs(&mut active_sessions, &mut mcp_pool);

                active_sessions.insert(
                    unique_session_id.clone(),
                    SessionState {
                        session_id: unique_session_id.clone(),
                        session_key: effective_key,
                        channel_id: session_channel_id.clone(),
                        owner_dir: resolved_cfg.owner_dir,
                        workspace_dir: target_workspace_dir,
                        system_prompt: sp,
                        mcp_pool_key,
                        mcp_client: session_mcp,
                    },
                );

                let resp = serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "result": {
                        "sessionId": unique_session_id
                    }
                });
                if let Ok(mut out) = stdout_shared.lock() {
                    writeln!(out, "{}", resp.to_string())?;
                    out.flush()?;
                }
            } else if method == "session/resume" {
                let requested_sid = match params
                    .get("sessionId")
                    .and_then(|v| v.as_str())
                    .map(str::trim)
                    .filter(|sid| !sid.is_empty())
                {
                    Some(sid) => sid.to_string(),
                    None => {
                        let err_resp = serde_json::json!({
                            "jsonrpc": "2.0",
                            "id": id,
                            "error": {
                                "code": -32602,
                                "message": "Invalid params: missing sessionId for session/resume"
                            }
                        });
                        if let Ok(mut out) = stdout_shared.lock() {
                            let _ = writeln!(out, "{}", err_resp.to_string());
                            let _ = out.flush();
                        }
                        continue;
                    }
                };

                if active_sessions.contains_key(&requested_sid) {
                    let resp = serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "result": {}
                    });
                    if let Ok(mut out) = stdout_shared.lock() {
                        let _ = writeln!(out, "{}", resp.to_string());
                        let _ = out.flush();
                    }
                    continue;
                }

                let stored = match session_store.get_session(&requested_sid) {
                    Ok(Some(session)) => session,
                    Ok(None) => {
                        let err_resp = serde_json::json!({
                            "jsonrpc": "2.0",
                            "id": id,
                            "error": {
                                "code": -32002,
                                "message": format!("Session not found: {}", requested_sid)
                            }
                        });
                        if let Ok(mut out) = stdout_shared.lock() {
                            let _ = writeln!(out, "{}", err_resp.to_string());
                            let _ = out.flush();
                        }
                        continue;
                    }
                    Err(e) => {
                        let err_resp = serde_json::json!({
                            "jsonrpc": "2.0",
                            "id": id,
                            "error": {
                                "code": -32603,
                                "message": format!("Failed to load persisted session: {:#}", e)
                            }
                        });
                        if let Ok(mut out) = stdout_shared.lock() {
                            let _ = writeln!(out, "{}", err_resp.to_string());
                            let _ = out.flush();
                        }
                        continue;
                    }
                };

                if let Some(requested_cwd) = params.get("cwd").and_then(|v| v.as_str()) {
                    let requested_path = std::path::Path::new(requested_cwd);
                    let requested = std::fs::canonicalize(requested_path)
                        .unwrap_or_else(|_| normalize_path(requested_path));
                    let stored_cwd = std::fs::canonicalize(&stored.workspace_dir)
                        .unwrap_or_else(|_| normalize_path(&stored.workspace_dir));
                    if requested != stored_cwd {
                        let err_resp = serde_json::json!({
                            "jsonrpc": "2.0",
                            "id": id,
                            "error": {
                                "code": -32602,
                                "message": format!(
                                    "Session cwd mismatch: stored {:?}, requested {:?}",
                                    stored.workspace_dir,
                                    requested_cwd
                                )
                            }
                        });
                        if let Ok(mut out) = stdout_shared.lock() {
                            let _ = writeln!(out, "{}", err_resp.to_string());
                            let _ = out.flush();
                        }
                        continue;
                    }
                }

                let mut restored_state = SessionState {
                    session_id: stored.session_id.clone(),
                    session_key: stored.session_key.clone(),
                    channel_id: stored.channel_id.clone(),
                    owner_dir: stored.owner_dir,
                    workspace_dir: stored.workspace_dir,
                    system_prompt: stored.system_prompt,
                    mcp_pool_key: stored.mcp_pool_key.clone(),
                    mcp_client: None,
                };
                match revalidate_session_workspace_dir(&restored_state, &shadow_crew_home) {
                    Ok(verified) => restored_state.workspace_dir = verified,
                    Err((code, message)) => {
                        let err_resp = serde_json::json!({
                            "jsonrpc": "2.0",
                            "id": id,
                            "error": { "code": code, "message": message }
                        });
                        if let Ok(mut out) = stdout_shared.lock() {
                            let _ = writeln!(out, "{}", err_resp.to_string());
                            let _ = out.flush();
                        }
                        continue;
                    }
                }

                let is_dm = restored_state.session_key.starts_with("dm:")
                    || restored_state.channel_id.starts_with("dm-");
                let chan_param = if is_dm {
                    None
                } else {
                    Some(restored_state.channel_id.as_str())
                };
                restored_state.mcp_client = mcp_pool
                    .get_or_spawn(
                        &restored_state.mcp_pool_key,
                        &restored_state.channel_id,
                        Some(&restored_state.workspace_dir.to_string_lossy()),
                        chan_param,
                    )
                    .await;
                prune_dead_session_mcp_refs(&mut active_sessions, &mut mcp_pool);
                active_sessions.insert(requested_sid, restored_state);

                let resp = serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "result": {}
                });
                if let Ok(mut out) = stdout_shared.lock() {
                    let _ = writeln!(out, "{}", resp.to_string());
                    let _ = out.flush();
                }
            } else if method == "session/load" {
                let err_resp = serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "error": {
                        "code": -32601,
                        "message": "Method not found: shadow-crew-agent does not support session/load and relies on host context compensation"
                    }
                });
                if let Ok(mut out) = stdout_shared.lock() {
                    writeln!(out, "{}", err_resp.to_string())?;
                    out.flush()?;
                }
                continue;
            } else if method == "session/close" {
                if let Some(close_sid) = params.get("sessionId").and_then(|v| v.as_str()) {
                    if let Err(e) = session_store.delete_session(close_sid) {
                        eprintln!(
                            "[Shinobi Agent] Failed to delete persisted session {}: {:#}",
                            close_sid, e
                        );
                    }
                    if let Some(removed_session) = active_sessions.remove(close_sid) {
                        let still_referenced = active_sessions
                            .values()
                            .any(|st| st.mcp_pool_key == removed_session.mcp_pool_key);
                        if !still_referenced {
                            mcp_pool.remove_and_terminate(&removed_session.mcp_pool_key);
                        }
                    }
                }
                let resp = serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "result": {
                        "closed": true
                    }
                });
                if let Ok(mut out) = stdout_shared.lock() {
                    writeln!(out, "{}", resp.to_string())?;
                    out.flush()?;
                }
            } else if method == "memory/all" {
                let all_records = memory_store.get_all().unwrap_or_default();
                let resp = serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "result": {
                        "memories": all_records
                    }
                });
                if let Ok(mut out) = stdout_shared.lock() {
                    writeln!(out, "{}", resp.to_string())?;
                    out.flush()?;
                }
            } else if method == "session/prompt" {
                let prompt_sid = match params
                    .get("sessionId")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.trim().is_empty())
                {
                    Some(s) => s.trim().to_string(),
                    None => {
                        let err_resp = serde_json::json!({
                            "jsonrpc": "2.0",
                            "id": id,
                            "error": {
                                "code": -32602,
                                "message": "Invalid params: missing sessionId"
                            }
                        });
                        if let Ok(mut out) = stdout_shared.lock() {
                            writeln!(out, "{}", err_resp.to_string())?;
                            out.flush()?;
                        }
                        continue;
                    }
                };

                // 严格 Session 隔离门禁：session/prompt 必须对应通过 session/new 成功建立的活跃会话，杜绝使用全局伪状态
                let verified_workspace_dir = match active_sessions.get(&prompt_sid) {
                    Some(st) => match revalidate_session_workspace_dir(st, &shadow_crew_home) {
                        Ok(dir) => dir,
                        Err((err_code, err_msg)) => {
                            if let Some(removed_session) = active_sessions.remove(&prompt_sid) {
                                let still_referenced = active_sessions.values().any(|other| {
                                    other.mcp_pool_key == removed_session.mcp_pool_key
                                });
                                if !still_referenced {
                                    mcp_pool.remove_and_terminate(&removed_session.mcp_pool_key);
                                }
                            }
                            let err_resp = serde_json::json!({
                                "jsonrpc": "2.0",
                                "id": id,
                                "error": {
                                    "code": err_code,
                                    "message": err_msg
                                }
                            });
                            if let Ok(mut out) = stdout_shared.lock() {
                                writeln!(out, "{}", err_resp.to_string())?;
                                out.flush()?;
                            }
                            continue;
                        }
                    },
                    None => {
                        let err_resp = serde_json::json!({
                            "jsonrpc": "2.0",
                            "id": id,
                            "error": {
                                "code": -32001,
                                "message": format!("Session not found or expired: {}", prompt_sid)
                            }
                        });
                        if let Ok(mut out) = stdout_shared.lock() {
                            writeln!(out, "{}", err_resp.to_string())?;
                            out.flush()?;
                        }
                        continue;
                    }
                };

                let session_state = match active_sessions.get_mut(&prompt_sid) {
                    Some(st) => st,
                    None => continue,
                };
                session_state.workspace_dir = verified_workspace_dir.clone();

                let query =
                    if let Some(prompt_arr) = params.get("prompt").and_then(|v| v.as_array()) {
                        prompt_arr
                            .iter()
                            .find_map(|b| b.get("text").and_then(|t| t.as_str()))
                            .unwrap_or_default()
                    } else {
                        params
                            .get("user_query")
                            .or_else(|| params.get("prompt"))
                            .and_then(|v| v.as_str())
                            .unwrap_or_default()
                    };

                if let Some(prompt_sp) = params.get("systemPrompt").and_then(|v| v.as_str()) {
                    if !prompt_sp.trim().is_empty() {
                        session_state.system_prompt = Some(prompt_sp.to_string());
                    }
                }

                let current_workspace_dir = verified_workspace_dir;
                let current_workspace_cwd = current_workspace_dir.to_string_lossy().to_string();
                if let Err(e) = enter_workspace_dir_safe(&current_workspace_dir) {
                    active_sessions.remove(&prompt_sid);
                    let err_resp = serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "error": {
                            "code": -32003,
                            "message": format!("Security violation (TOCTOU): atomic directory switch failed: {}", e)
                        }
                    });
                    if let Ok(mut out) = stdout_shared.lock() {
                        let _ = writeln!(out, "{}", err_resp.to_string());
                        let _ = out.flush();
                    }
                    continue;
                }

                // 更新工作区活跃状态
                let meta_file = current_workspace_dir.join("meta.json");
                if meta_file.exists() {
                    if let Ok(content) = std::fs::read_to_string(&meta_file) {
                        if let Ok(mut val) = serde_json::from_str::<serde_json::Value>(&content) {
                            let now_secs = std::time::SystemTime::now()
                                .duration_since(std::time::UNIX_EPOCH)
                                .unwrap_or_default()
                                .as_secs();
                            val["lastActive"] = serde_json::json!(now_secs);
                            val["workspaceDir"] = serde_json::json!(current_workspace_cwd);
                            let _ = std::fs::write(&meta_file, val.to_string());
                        }
                    }
                }

                // 严格工作区物理隔离 + 池化存活自愈：
                // 若原 MCP 客户端因池满 LRU 被回收并终止，按原工作区受控重连；
                // 若重连失败，直接降级为 None（纯文本推演），绝不回退到已终止的旧 session_state.mcp_client！
                let is_dm_session = session_state.session_key.starts_with("dm:")
                    || session_state.channel_id.starts_with("dm-");
                let chan_param_for_prompt = if is_dm_session {
                    None
                } else {
                    Some(session_state.channel_id.as_str())
                };
                let current_mcp_client = mcp_pool
                    .get_or_spawn(
                        &session_state.mcp_pool_key,
                        &session_state.channel_id,
                        Some(&current_workspace_cwd),
                        chan_param_for_prompt,
                    )
                    .await;
                session_state.mcp_client = current_mcp_client.clone();

                // 1. 从私有记忆库召回关键知识 (全局核心认知 + 本地私有知识)
                let mut recalled = memory_store.recall_relevant(query).unwrap_or_default();
                let local_mem_path = current_workspace_dir
                    .join("memory.sqlite")
                    .to_string_lossy()
                    .to_string();
                if let Ok(local_mem_store) = AgentMemoryStore::new(&local_mem_path) {
                    if let Ok(loc_recalled) = local_mem_store.recall_relevant(query) {
                        recalled.extend(loc_recalled);
                    }
                }

                let mut memory_traces = Vec::new();
                for r in &recalled {
                    memory_traces.push(MemoryTrace {
                        action: "recall".to_string(),
                        key: r.key.clone(),
                        detail: r.content.clone(),
                    });
                }

                // 2. 以人设 + 召回记忆为上下文，调用底座模型进行真实推演与 MCP 工具执行
                let active_sp = session_state.system_prompt.clone();
                let session_key_owned = session_state.session_key.clone();
                let channel_id_owned = session_state.channel_id.clone();
                prune_dead_session_mcp_refs(&mut active_sessions, &mut mcp_pool);
                let mut system_prompt = active_sp.unwrap_or_else(|| {
                    "你是 Shinobi，用户的 AI 影替身，代表主人参与技术架构推演与代码审查。请给出专业、严谨、可落地的回答。".to_string()
                });
                if !recalled.is_empty() {
                    system_prompt.push_str("\n\n[私有记忆库召回的专属规范，推演时必须遵循]:\n");
                    for r in &recalled {
                        system_prompt.push_str(&format!("- ({}) {}\n", r.key, r.content));
                    }
                }

                let artifacts_dir = current_workspace_dir
                    .join("artifacts")
                    .to_string_lossy()
                    .to_string();
                let scratch_dir = current_workspace_dir
                    .join("scratch")
                    .to_string_lossy()
                    .to_string();
                if !system_prompt.contains("[当前频道专属工作空间环境]")
                    && !system_prompt.contains("[当前 Agent 个人专属独立工作空间环境]")
                {
                    if is_dm_session {
                        system_prompt.push_str(&format!(
                            "\n\n[当前 Agent 个人专属独立工作空间环境]:\n- Session Key: {}\n- Agent 独立工作区根目录 (Working Directory / cwd): {}\n- 专属落地产物目录 (Artifacts): {}\n- 专属临时调试目录 (Scratch): {}\n提示: 您当前处于与用户的 1-on-1 私聊中，沉淀的正式技术推演文档、方案或代码 Patch 将安全保存至您个人的专属产物目录中，与频道(channels)业务及其他 Agent 物理隔离。\n",
                            session_key_owned,
                            current_workspace_cwd,
                            artifacts_dir,
                            scratch_dir
                        ));
                    } else {
                        system_prompt.push_str(&format!(
                            "\n\n[当前频道专属工作空间环境]:\n- 频道 ID: {}\n- 频道独立工作区根目录 (Working Directory / cwd): {}\n- 落地产物目录 (Artifacts): {}\n- 临时调试目录 (Scratch): {}\n提示: 如需沉淀正式技术推演文档、ADR 架构决策或代码 Patch，请优先调用 `write_channel_artifact` 工具安全保存至频道专属产物目录。\n",
                            channel_id_owned,
                            current_workspace_cwd,
                            artifacts_dir,
                            scratch_dir
                        ));
                    }
                }

                let conversation_history = match session_store
                    .load_recent_messages(&prompt_sid, MAX_SESSION_HISTORY_MESSAGES)
                {
                    Ok(messages) => messages
                        .into_iter()
                        .map(|message| llm::ConversationTurn {
                            role: message.role,
                            content: message.content,
                        })
                        .collect::<Vec<_>>(),
                    Err(e) => {
                        eprintln!(
                            "[Shinobi Agent] Failed to load persisted history for {}: {:#}",
                            prompt_sid, e
                        );
                        Vec::new()
                    }
                };
                let query_owned = query.to_string();
                let session_id_owned = prompt_sid.clone();
                let sid_for_tool = prompt_sid.clone();
                let stdout_clone = stdout_shared.clone();
                let mut persist_exchange = false;

                let exec_result = match &llm_config {
                    None => llm::LlmExecutionResult {
                        text_response: "⚠️ Shinobi 尚未配置底座模型：请在 Agent 的模型配置或全局模型设置中填入模型 ID 与 API Key 后重试。".to_string(),
                        mcp_tool_calls: vec![],
                    },
                    Some(cfg) => {
                        let on_tool_step = move |tool_name: &str, _tool_args: &str| {
                            let hint = format!("\n> ⚙️ **[Shinobi 原生工具]** 正在执行 `{}`...\n\n", tool_name);
                            let chunk_notification = serde_json::json!({
                                "jsonrpc": "2.0",
                                "method": "session/update",
                                "params": {
                                    "sessionId": &sid_for_tool,
                                    "update": {
                                        "sessionUpdate": "agent_message_chunk",
                                        "content": {
                                            "type": "text",
                                            "text": hint
                                        }
                                    }
                                }
                            });
                            if let Ok(mut out) = stdout_clone.lock() {
                                let _ = writeln!(out, "{}", chunk_notification.to_string());
                                let _ = out.flush();
                            }
                        };

                        match llm::complete_with_tools(
                            cfg,
                            &system_prompt,
                            &query_owned,
                            &conversation_history,
                            current_mcp_client.clone(),
                            on_tool_step,
                        )
                        .await
                        {
                            Ok(res) => {
                                persist_exchange = true;
                                res
                            }
                            Err(e) => llm::LlmExecutionResult {
                                text_response: format!("⚠️ Shinobi 底座模型推演失败：{:#}", e),
                                mcp_tool_calls: vec![],
                            },
                        }
                    }
                };

                if persist_exchange {
                    if let Err(e) = session_store.append_exchange(
                        &prompt_sid,
                        &query_owned,
                        &exec_result.text_response,
                    ) {
                        eprintln!(
                            "[Shinobi Agent] Failed to persist conversation turn for {}: {:#}",
                            prompt_sid, e
                        );
                    }
                }

                // 流式回传完成通知
                let chunk_notification = serde_json::json!({
                    "jsonrpc": "2.0",
                    "method": "session/update",
                    "params": {
                        "sessionId": &session_id_owned,
                        "update": {
                            "sessionUpdate": "agent_message_chunk",
                            "content": {
                                "type": "text",
                                "text": &exec_result.text_response
                            }
                        }
                    }
                });
                if let Ok(mut out) = stdout_shared.lock() {
                    let _ = writeln!(out, "{}", chunk_notification.to_string());
                    let _ = out.flush();
                }

                let result = AcpPromptResult {
                    text_response: exec_result.text_response,
                    memory_actions: memory_traces,
                    workspace_diffs: vec![],
                    mcp_tool_calls: exec_result.mcp_tool_calls,
                };

                let resp = serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "result": result
                });

                if let Ok(mut out) = stdout_shared.lock() {
                    writeln!(out, "{}", resp.to_string())?;
                    out.flush()?;
                }
            } else {
                let resp = serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "result": {
                        "text_response": format!("【Shinobi 替身响应】已接收方法: {}", method),
                        "memory_actions": [],
                        "workspace_diffs": [],
                        "mcp_tool_calls": []
                    }
                });
                if let Ok(mut out) = stdout_shared.lock() {
                    writeln!(out, "{}", resp.to_string())?;
                    out.flush()?;
                }
            }
        } else {
            // 兜底非标准 JSON 纯文本输入
            let trimmed = line.trim();
            let resp = serde_json::json!({
                "jsonrpc": "2.0",
                "id": 1,
                "result": {
                    "text_response": format!("【Shinobi 替身响应】已收到输入：「{}」，本地 ACP 进程运转正常。", trimmed),
                    "memory_actions": [],
                    "workspace_diffs": [],
                    "mcp_tool_calls": []
                }
            });
            if let Ok(mut out) = stdout_shared.lock() {
                writeln!(out, "{}", resp.to_string())?;
                out.flush()?;
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_path_prevents_traversal() {
        let base = PathBuf::from("/Users/test/.shadow-crew");
        let safe_sub = base.join("channels/chan-1");
        let norm_safe = normalize_path(&safe_sub);
        assert!(norm_safe.starts_with(&base));

        let traversal = base.join("../../etc/passwd");
        let norm_traversal = normalize_path(&traversal);
        assert!(!norm_traversal.starts_with(&base));
        assert_eq!(norm_traversal, PathBuf::from("/Users/etc/passwd"));
    }

    #[test]
    fn test_normalize_path_handles_current_dir_and_dots() {
        let path = PathBuf::from("/a/b/./c/../d");
        let norm = normalize_path(&path);
        assert_eq!(norm, PathBuf::from("/a/b/d"));
    }

    #[test]
    fn test_validate_and_resolve_workspace_dir_blocks_symlink_escape() {
        let temp_base =
            std::env::temp_dir().join(format!("shadow_crew_symlink_test_{}", std::process::id()));
        let sandbox_home = temp_base.join(".shadow-crew");
        let outside_dir = temp_base.join("outside_secret_dir");
        let _ = std::fs::remove_dir_all(&temp_base);
        std::fs::create_dir_all(sandbox_home.join("channels")).unwrap();
        std::fs::create_dir_all(&outside_dir).unwrap();

        // 1. 合法子目录（尚不存在时自动安全创建并 canonicalize）
        let valid_chan = sandbox_home.join("channels/chan-safe-1");
        let resolved_valid = validate_and_resolve_workspace_dir(&valid_chan, &sandbox_home);
        assert!(resolved_valid.is_some(), "合法沙箱内子目录应校验通过");
        let canonical_home = std::fs::canonicalize(&sandbox_home).unwrap();
        assert!(resolved_valid.unwrap().starts_with(&canonical_home));

        // 2. 符号链接越界测试：在 ~/.shadow-crew/channels/evil-link 下创建指向沙箱外 outside_dir 的 symlink
        #[cfg(unix)]
        {
            let symlink_path = sandbox_home.join("channels/evil-link");
            std::os::unix::fs::symlink(&outside_dir, &symlink_path).unwrap();

            // 2a. 直接访问符号链接目录本身 -> 必须被拦截 (返回 None)
            let direct_escape = validate_and_resolve_workspace_dir(&symlink_path, &sandbox_home);
            assert!(
                direct_escape.is_none(),
                "指向沙箱外的符号链接目录必须被 canonicalize 校验拦截"
            );

            // 2b. 访问符号链接下尚未创建的深层子目录 -> 必须在 create_dir_all 之前被拦截，且不得在外部目录创建任何子目录
            let nested_escape = symlink_path.join("sub_escape/deep");
            let nested_res = validate_and_resolve_workspace_dir(&nested_escape, &sandbox_home);
            assert!(nested_res.is_none(), "符号链接下的未创建子路径也必须被拦截");
            assert!(
                !outside_dir.join("sub_escape").exists(),
                "严禁跟随符号链接在沙箱外创建目录"
            );
        }

        let _ = std::fs::remove_dir_all(&temp_base);
    }

    #[test]
    fn test_workspace_segment_validation_prevents_collision() {
        // 合法 ID 通过校验
        assert_eq!(
            validate_workspace_segment("ab").expect("合法段 ab 应通过校验"),
            "ab"
        );
        assert_eq!(
            validate_workspace_segment("chan-alpha_01").expect("合法段应通过校验"),
            "chan-alpha_01"
        );

        // 包含路径分隔符、相对点号或空字符串的非法 ID 必须直接报错，严禁被清洗为 "ab" 产生别名碰撞
        assert!(
            validate_workspace_segment("a/b").is_err(),
            "包含 '/' 的非法 ID 必须被拒绝，严禁静默拼接为 'ab'"
        );
        assert!(
            validate_workspace_segment("a\\b").is_err(),
            "包含 '\\' 的非法 ID 必须被拒绝"
        );
        assert!(
            validate_workspace_segment("../ab").is_err(),
            "包含 '..' 的非法 ID 必须被拒绝"
        );
        assert!(
            validate_workspace_segment(".ab").is_err(),
            "以 '.' 开头的 ID 必须被拒绝"
        );
        assert!(validate_workspace_segment("").is_err(), "空 ID 必须被拒绝");

        // 验证 get_channel_dir_with_home("a/b") 与 get_channel_dir_with_home("ab") 绝不会落入同一工作区目录
        let temp_base =
            std::env::temp_dir().join(format!("shadow_crew_collision_test_{}", std::process::id()));
        let sandbox_home = temp_base.join(".shadow-crew");
        let _ = std::fs::remove_dir_all(&temp_base);

        let dir_ab = get_channel_dir_with_home("ab", &sandbox_home);
        let dir_a_slash_b = get_channel_dir_with_home("a/b", &sandbox_home);
        assert_ne!(
            dir_ab, dir_a_slash_b,
            "\"a/b\" 与 \"ab\" 绝不能碰撞到同一个频道工作区目录"
        );
        assert!(dir_ab.ends_with("channels/ab"));
        assert!(dir_a_slash_b.ends_with("channels/chan-safe-default"));

        let _ = std::fs::remove_dir_all(&temp_base);
    }

    static TEST_CWD_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    #[test]
    fn test_fallback_workspace_dir_blocks_symlink_escape() {
        let temp_base = std::env::temp_dir().join(format!(
            "shadow_crew_fallback_symlink_test_{}",
            std::process::id()
        ));
        let sandbox_home = temp_base.join(".shadow-crew");
        let outside_chan_dir = temp_base.join("outside_chan_target");
        let outside_agent_dir = temp_base.join("outside_agent_target");
        let _ = std::fs::remove_dir_all(&temp_base);
        std::fs::create_dir_all(sandbox_home.join("channels")).unwrap();
        std::fs::create_dir_all(sandbox_home.join("agents")).unwrap();
        std::fs::create_dir_all(&outside_chan_dir).unwrap();
        std::fs::create_dir_all(&outside_agent_dir).unwrap();

        #[cfg(unix)]
        {
            // 预先将 fallback 目标 chan-safe-default 和 agent-safe-default 替换为指向沙箱外的 symlink
            let chan_fallback_link = sandbox_home.join("channels/chan-safe-default");
            let agent_fallback_link = sandbox_home.join("agents/agent-safe-default");
            std::os::unix::fs::symlink(&outside_chan_dir, &chan_fallback_link).unwrap();
            std::os::unix::fs::symlink(&outside_agent_dir, &agent_fallback_link).unwrap();

            // 传入非法路径触发 fallback
            let resolved_chan = get_channel_dir_with_home("../escape", &sandbox_home);
            let resolved_agent = get_agent_dir_with_home("../escape", &sandbox_home);

            let canonical_home = std::fs::canonicalize(&sandbox_home).unwrap();
            assert!(
                resolved_chan.starts_with(&canonical_home),
                "Channel fallback 真实物理路径必须严格位于沙箱内: {:?}",
                resolved_chan
            );
            assert!(
                resolved_agent.starts_with(&canonical_home),
                "Agent fallback 真实物理路径必须严格位于沙箱内: {:?}",
                resolved_agent
            );
            assert!(
                !std::fs::symlink_metadata(&chan_fallback_link)
                    .unwrap()
                    .file_type()
                    .is_symlink(),
                "chan-safe-default 的恶意 symlink 必须被清除并重建为真实目录"
            );
            assert!(
                !std::fs::symlink_metadata(&agent_fallback_link)
                    .unwrap()
                    .file_type()
                    .is_symlink(),
                "agent-safe-default 的恶意 symlink 必须被清除并重建为真实目录"
            );
            assert!(
                !outside_chan_dir.join("artifacts").exists(),
                "严禁跟随 chan-safe-default 符号链接在沙箱外创建 artifacts 目录"
            );
            assert!(
                !outside_agent_dir.join("artifacts").exists(),
                "严禁跟随 agent-safe-default 符号链接在沙箱外创建 artifacts 目录"
            );
        }

        let _ = std::fs::remove_dir_all(&temp_base);
    }

    #[tokio::test]
    async fn test_mcp_client_pool_reuse_and_bounded_eviction() {
        let mut pool = McpClientPool::new(2);
        let temp_base =
            std::env::temp_dir().join(format!("shadow_crew_mcp_pool_test_{}", std::process::id()));
        let dir1 = temp_base.join("chan-1");
        let dir2 = temp_base.join("chan-2");
        let dir3 = temp_base.join("chan-3");
        std::fs::create_dir_all(&dir1).unwrap();
        std::fs::create_dir_all(&dir2).unwrap();
        std::fs::create_dir_all(&dir3).unwrap();

        let d1_str = dir1.to_string_lossy().to_string();
        let d2_str = dir2.to_string_lossy().to_string();
        let d3_str = dir3.to_string_lossy().to_string();

        let c1_a = pool
            .get_or_spawn("chan-1::d1", "chan-1", Some(&d1_str), Some("chan-1"))
            .await
            .expect("测试环境下必须成功拉起内置 MCP 客户端 (shadow-crew-dev-mcp)");

        // 同频道/同工作区的第二个 Topic 会话复用同一个 SharedMcpClient Arc 实例
        let c1_b = pool
            .get_or_spawn("chan-1::d1", "chan-1", Some(&d1_str), Some("chan-1"))
            .await
            .expect("同工作区复用必须返回存活的 MCP 客户端");
        assert!(
            Arc::ptr_eq(&c1_a, &c1_b),
            "同一频道与工作区的多个 Session 必须复用同一 MCP 客户端实例"
        );
        assert_eq!(pool.len(), 1, "复用后池大小保持为 1");

        let _c2 = pool
            .get_or_spawn("chan-2::d2", "chan-2", Some(&d2_str), Some("chan-2"))
            .await
            .expect("第 2 个工作区 MCP 客户端必须拉起成功");
        assert_eq!(pool.len(), 2, "新增不同频道后池大小为 2");

        // 第 3 个不同频道进入容量为 2 的池时，自动按 LRU 淘汰最久未使用的 chan-1::d1
        let _c3 = pool
            .get_or_spawn("chan-3::d3", "chan-3", Some(&d3_str), Some("chan-3"))
            .await
            .expect("第 3 个工作区 MCP 客户端必须拉起成功并触发 LRU 淘汰");
        assert_eq!(
            pool.len(),
            2,
            "超出池上限时触发 LRU 回收，池大小严格受控 <= 2"
        );

        // 被淘汰的 c1_a 子进程必须已被终止
        {
            let mut guard = c1_a.lock().await;
            assert!(
                !guard.is_alive(),
                "被 LRU 回收的旧 MCP 客户端进程必须已终止"
            );
        }

        pool.remove_and_terminate("chan-2::d2");
        pool.remove_and_terminate("chan-3::d3");
        assert_eq!(pool.len(), 0, "主动移除后池清空");
        let _ = std::fs::remove_dir_all(&temp_base);
    }

    #[tokio::test]
    async fn test_mcp_pool_eviction_clears_session_and_reconnect_failure_does_not_use_dead_client()
    {
        let mut pool = McpClientPool::new(1);
        let mut active_sessions: HashMap<String, SessionState> = HashMap::new();
        let temp_base = std::env::temp_dir().join(format!(
            "shadow_crew_mcp_evict_dead_test_{}",
            std::process::id()
        ));
        let dir1 = temp_base.join("chan-1");
        let dir2 = temp_base.join("chan-2");
        std::fs::create_dir_all(&dir1).unwrap();
        std::fs::create_dir_all(&dir2).unwrap();
        let d1_str = dir1.to_string_lossy().to_string();
        let d2_str = dir2.to_string_lossy().to_string();

        // 1. Session 1 建立并挂载 MCP 客户端
        let mcp1 = pool
            .get_or_spawn("chan-1::d1", "chan-1", Some(&d1_str), Some("chan-1"))
            .await
            .expect("Session 1 MCP 启动应成功");
        active_sessions.insert(
            "s1".to_string(),
            SessionState {
                session_id: "s1".to_string(),
                session_key: "topic:t1:chan-1:standard".to_string(),
                channel_id: "chan-1".to_string(),
                owner_dir: dir1.clone(),
                workspace_dir: dir1.clone(),
                system_prompt: None,
                mcp_pool_key: "chan-1::d1".to_string(),
                mcp_client: Some(mcp1.clone()),
            },
        );

        // 2. Session 2 进入容量为 1 的池，触发 Session 1 的 MCP 客户端被 LRU 淘汰并终止
        let _mcp2 = pool
            .get_or_spawn("chan-2::d2", "chan-2", Some(&d2_str), Some("chan-2"))
            .await
            .expect("Session 2 MCP 启动应成功");
        prune_dead_session_mcp_refs(&mut active_sessions, &mut pool);

        assert!(
            active_sessions.get("s1").unwrap().mcp_client.is_none(),
            "被池淘汰的活跃 Session 必须同步清空旧 mcp_client 引用，防止悬空指向已终止客户端"
        );

        // 3. 模拟 Session 1 再次发起 session/prompt 时重连失败，验证绝不会回退到已终止的旧客户端
        pool.force_fail_spawn = true;
        let s1_state = active_sessions.get_mut("s1").unwrap();
        let current_mcp_client = pool
            .get_or_spawn(
                &s1_state.mcp_pool_key,
                &s1_state.channel_id,
                Some(&d1_str),
                Some("chan-1"),
            )
            .await;
        s1_state.mcp_client = current_mcp_client.clone();

        assert!(
            current_mcp_client.is_none(),
            "重连失败时必须降级为 None（纯文本推演），绝不能回退到已终止的旧 MCP 客户端"
        );
        assert!(
            s1_state.mcp_client.is_none(),
            "Session 1 的 mcp_client 必须保持为 None"
        );

        pool.remove_and_terminate("chan-2::d2");
        let _ = std::fs::remove_dir_all(&temp_base);
    }

    #[test]
    fn test_env_agent_id_does_not_misclassify_channel_session_as_dm() {
        let temp_base = std::env::temp_dir().join(format!(
            "shadow_crew_env_agent_dm_test_{}",
            std::process::id()
        ));
        let sandbox_home = temp_base.join(".shadow-crew");
        let _ = std::fs::remove_dir_all(&temp_base);

        // 1. 进程环境中设置了 SHADOW_CREW_AGENT_ID ("agent-shinobi")，但请求带有正常 channelId ("chan-arch")：
        // 必须判定为频道会话 (is_dm = false)，使用 channels/chan-arch 目录与频道级 mcp_key
        let chan_params = serde_json::json!({
            "channelId": "chan-arch",
            "sessionKey": "channel:chan-arch:thread-101"
        });
        let chan_cfg =
            resolve_new_session_config(&chan_params, &sandbox_home, Some("agent-shinobi"))
                .expect("正常频道会话在存在 SHADOW_CREW_AGENT_ID 环境变量时应解析成功");

        assert!(
            !chan_cfg.is_dm,
            "存在 SHADOW_CREW_AGENT_ID 环境变量时，带 channelId 的请求绝不能被误判为 DM"
        );
        assert!(
            chan_cfg
                .target_workspace_dir
                .ends_with("channels/chan-arch"),
            "频道会话必须使用 channels/<channelId> 工作区而非 Agent 私有目录: {:?}",
            chan_cfg.target_workspace_dir
        );
        assert_eq!(chan_cfg.mcp_key, "chan-arch");

        // 2. 即使未显式传 sessionKey，只要传了正常 channelId，也绝不能因 SHADOW_CREW_AGENT_ID 误判为 DM
        let chan_no_key_params = serde_json::json!({
            "channelId": "chan-backend"
        });
        let chan_no_key_cfg =
            resolve_new_session_config(&chan_no_key_params, &sandbox_home, Some("agent-shinobi"))
                .expect("仅传 channelId 的频道会话应解析成功");
        assert!(!chan_no_key_cfg.is_dm);
        assert!(chan_no_key_cfg
            .target_workspace_dir
            .ends_with("channels/chan-backend"));

        // 3. 真实 DM 场景（sessionKey 以 "dm:" 开头，或无 channelId 且显式传了 agentId）：应正确识别为 DM 并使用 agents/<agentId>
        let dm_params = serde_json::json!({
            "sessionKey": "dm:agent-shinobi:thread-dm-1"
        });
        let dm_cfg = resolve_new_session_config(&dm_params, &sandbox_home, Some("agent-shinobi"))
            .expect("显式 dm: sessionKey 应解析成功");
        assert!(dm_cfg.is_dm, "dm: 前缀应识别为私聊会话");
        assert!(
            dm_cfg
                .target_workspace_dir
                .ends_with("agents/agent-shinobi"),
            "私聊会话应使用 agents/<agentId> 专属目录: {:?}",
            dm_cfg.target_workspace_dir
        );
        assert_eq!(dm_cfg.mcp_key, "agent:agent-shinobi");

        let _ = std::fs::remove_dir_all(&temp_base);
    }

    #[test]
    fn test_fallback_all_creation_failures_reject_session_without_returning_root() {
        let temp_base = std::env::temp_dir().join(format!(
            "shadow_crew_fallback_failclosed_test_{}",
            std::process::id()
        ));
        let sandbox_home = temp_base.join(".shadow-crew");
        let _ = std::fs::remove_dir_all(&temp_base);
        std::fs::create_dir_all(&sandbox_home).unwrap();

        // 将 ~/.shadow-crew/channels 预先创建为普通文件（非目录），导致主工作区、chan-safe-default 与 isolated fallback 全部无法创建子目录
        let channels_blocker_file = sandbox_home.join("channels");
        std::fs::write(&channels_blocker_file, "blocker-not-a-directory").unwrap();

        // 1. 直接调用 resolve_safe_fallback_dir 必须返回 Err，绝不退回至 sandbox_home 根目录
        let fallback_res =
            resolve_safe_fallback_dir(&sandbox_home, "channels", "chan-safe-default");
        assert!(
            fallback_res.is_err(),
            "当 fallback 与 isolated 目录全部创建失败时，resolve_safe_fallback_dir 必须返回 Err (Fail-Closed)"
        );

        // 2. 调用 resolve_new_session_config 必须返回 (-32002, ...) 拒绝建连，绝不将 ~/.shadow-crew 根目录作为工作区返回
        let params = serde_json::json!({
            "channelId": "chan-normal",
            "sessionKey": "channel:chan-normal:thread-1"
        });
        let sess_res = resolve_new_session_config(&params, &sandbox_home, None);
        assert!(
            sess_res.is_err(),
            "当所有安全子工作区均无法创建时，session/new 必须拒绝建连，严禁退回至沙箱根目录"
        );
        let (err_code, err_msg) = sess_res.unwrap_err();
        assert_eq!(err_code, -32002);
        assert!(
            err_msg.contains("fail-closed"),
            "错误信息应明确标识 fail-closed 拒绝原因: {}",
            err_msg
        );
        assert!(
            !sandbox_home.join("artifacts").exists() && !sandbox_home.join("scratch").exists(),
            "严禁在 ~/.shadow-crew 沙箱根目录下创建根级 artifacts 或 scratch"
        );

        let _ = std::fs::remove_dir_all(&temp_base);
    }

    #[test]
    fn test_colon_in_agent_or_channel_id_is_rejected() {
        let temp_base =
            std::env::temp_dir().join(format!("shadow_crew_colon_id_test_{}", std::process::id()));
        let sandbox_home = temp_base.join(".shadow-crew");
        let _ = std::fs::remove_dir_all(&temp_base);

        // 1. 单段校验必须拒绝包含冒号 ':' 的 ID
        assert!(
            validate_workspace_segment("a:b").is_err(),
            "包含 ':' 的 Agent/Channel ID 必须被 validate_workspace_segment 拒绝"
        );
        assert!(
            validate_session_key("dm:a:b:thread-1").is_err(),
            "因 ID 含 ':' 导致被拆成 4 段的 dm:a:b:thread-1 必须被 validate_session_key 拒绝"
        );
        assert!(
            validate_session_key("channel:chan:1:thread-1").is_err(),
            "因 channelId 含 ':' 导致被拆成 4 段的 channel:chan:1:thread-1 必须被拒绝"
        );

        // 2. session/new 参数校验必须以 -32602 拒绝含 ':' 的 agentId、channelId 或畸形 sessionKey
        let bad_agent_res = resolve_new_session_config(
            &serde_json::json!({ "agentId": "a:b" }),
            &sandbox_home,
            None,
        );
        assert!(bad_agent_res.is_err());
        assert_eq!(bad_agent_res.unwrap_err().0, -32602);

        let bad_channel_res = resolve_new_session_config(
            &serde_json::json!({ "channelId": "chan:1" }),
            &sandbox_home,
            None,
        );
        assert!(bad_channel_res.is_err());
        assert_eq!(bad_channel_res.unwrap_err().0, -32602);

        let bad_sk_res = resolve_new_session_config(
            &serde_json::json!({ "sessionKey": "dm:a:b:thread-1" }),
            &sandbox_home,
            None,
        );
        assert!(bad_sk_res.is_err());
        assert_eq!(bad_sk_res.unwrap_err().0, -32602);

        let _ = std::fs::remove_dir_all(&temp_base);
    }

    #[test]
    fn test_cwd_cross_channel_or_agent_is_isolated_to_owner_workspace() {
        let temp_base = std::env::temp_dir().join(format!(
            "shadow_crew_cwd_owner_isolation_test_{}",
            std::process::id()
        ));
        let sandbox_home = temp_base.join(".shadow-crew");
        let _ = std::fs::remove_dir_all(&temp_base);

        // 1. 频道 A 会话试图通过 cwd 指向频道 B 的沙箱内目录 (~/.shadow-crew/channels/chan-B)：
        // 必须被拦截并强制收敛至 channels/chan-A，且绝不能在磁盘上创建 channels/chan-B！
        let cross_chan_cwd = sandbox_home.join("channels/chan-B");
        let chan_a_cfg = resolve_new_session_config(
            &serde_json::json!({
                "channelId": "chan-A",
                "sessionKey": "channel:chan-A:thread-1",
                "cwd": cross_chan_cwd.to_string_lossy().to_string()
            }),
            &sandbox_home,
            None,
        )
        .expect("跨频道 cwd 请求应被安全收敛至所属频道目录而非崩溃");

        assert!(
            chan_a_cfg.target_workspace_dir.ends_with("channels/chan-A"),
            "channelId=chan-A 传入 channels/chan-B 作为 cwd 时，必须强制隔离回 channels/chan-A: {:?}",
            chan_a_cfg.target_workspace_dir
        );
        assert!(
            !cross_chan_cwd.exists(),
            "严禁为越权的跨频道 cwd (channels/chan-B) 在磁盘上创建目录"
        );

        // 2. 频道 A 会话传入归属于 chan-A 内部的子目录 (channels/chan-A/module-auth) -> 允许并正确解析
        let valid_sub_cwd = sandbox_home.join("channels/chan-A/module-auth");
        let chan_a_sub_cfg = resolve_new_session_config(
            &serde_json::json!({
                "channelId": "chan-A",
                "sessionKey": "channel:chan-A:thread-1",
                "cwd": valid_sub_cwd.to_string_lossy().to_string()
            }),
            &sandbox_home,
            None,
        )
        .expect("同频道合法子目录 cwd 应解析成功");
        assert!(
            chan_a_sub_cfg
                .target_workspace_dir
                .ends_with("channels/chan-A/module-auth"),
            "归属于当前频道的子目录应被允许: {:?}",
            chan_a_sub_cfg.target_workspace_dir
        );

        // 3. 私聊 Agent A 会话试图通过 cwd 指向 Agent B 或频道目录 -> 必须强制隔离回 agents/agent-A
        let cross_agent_cwd = sandbox_home.join("agents/agent-B");
        let dm_a_cfg = resolve_new_session_config(
            &serde_json::json!({
                "agentId": "agent-A",
                "sessionKey": "dm:agent-A:thread-dm-1",
                "cwd": cross_agent_cwd.to_string_lossy().to_string()
            }),
            &sandbox_home,
            None,
        )
        .expect("跨 Agent cwd 请求应被安全收敛至所属 Agent 目录");
        assert!(
            dm_a_cfg.target_workspace_dir.ends_with("agents/agent-A"),
            "agentId=agent-A 传入 agents/agent-B 作为 cwd 时，必须强制隔离回 agents/agent-A: {:?}",
            dm_a_cfg.target_workspace_dir
        );
        assert!(
            !cross_agent_cwd.exists(),
            "严禁为越权的跨 Agent cwd (agents/agent-B) 在磁盘上创建目录"
        );

        let _ = std::fs::remove_dir_all(&temp_base);
    }

    #[cfg(unix)]
    #[test]
    fn test_session_prompt_workspace_toctou_symlink_replacement_is_blocked() {
        let temp_base =
            std::env::temp_dir().join(format!("shadow_crew_toctou_test_{}", std::process::id()));
        let sandbox_home = temp_base.join(".shadow-crew");
        let outside_dir = temp_base.join("outside_sensitive_dir");
        let _ = std::fs::remove_dir_all(&temp_base);
        std::fs::create_dir_all(&sandbox_home).expect("create sandbox_home");
        std::fs::create_dir_all(&outside_dir).expect("create outside_dir");

        // 1. session/new 阶段：创建合法的频道工作区与子目录工作区
        let sub_cwd = sandbox_home.join("channels/chan-toctou/module-core");
        let cfg = resolve_new_session_config(
            &serde_json::json!({
                "channelId": "chan-toctou",
                "sessionKey": "channel:chan-toctou:thread-1",
                "cwd": sub_cwd.to_string_lossy().to_string()
            }),
            &sandbox_home,
            None,
        )
        .expect("session/new 初始合法配置应解析成功");

        let session_state = SessionState {
            session_id: cfg.unique_session_id.clone(),
            session_key: cfg.effective_key.clone(),
            channel_id: cfg.session_channel_id.clone(),
            owner_dir: cfg.owner_dir.clone(),
            workspace_dir: cfg.target_workspace_dir.clone(),
            system_prompt: None,
            mcp_pool_key: cfg.mcp_pool_key.clone(),
            mcp_client: None,
        };

        // 2. 未被篡改前，session/prompt 的 TOCTOU 复验通过
        let verified = revalidate_session_workspace_dir(&session_state, &sandbox_home)
            .expect("未篡改的工作区应通过 TOCTOU 复验");
        assert_eq!(verified, session_state.workspace_dir);

        // 3. 场景 A：在 session/new 与 session/prompt 之间，工作区目录内的 meta.json 被替换为指向沙箱外的 symlink
        let meta_link_path = session_state.workspace_dir.join("meta.json");
        let _ = std::fs::remove_file(&meta_link_path);
        let outside_secret_file = outside_dir.join("secret.json");
        std::fs::write(&outside_secret_file, r#"{"secret":true}"#).expect("write secret");
        std::os::unix::fs::symlink(&outside_secret_file, &meta_link_path)
            .expect("create meta.json symlink");

        let meta_toctou_err = revalidate_session_workspace_dir(&session_state, &sandbox_home)
            .expect_err("meta.json 被替换为 symlink 时必须被 TOCTOU 复验拦截");
        assert_eq!(meta_toctou_err.0, -32003);
        assert!(meta_toctou_err.1.contains("TOCTOU"));
        let _ = std::fs::remove_file(&meta_link_path);

        // 4. 场景 B：在 session/new 与 session/prompt 之间，整个工作区子目录 module-core 被删除并替换为指向 outside_dir 的 symlink
        std::fs::remove_dir_all(&session_state.workspace_dir).expect("remove module-core dir");
        std::os::unix::fs::symlink(&outside_dir, &session_state.workspace_dir)
            .expect("replace workspace_dir with symlink to outside_dir");

        let dir_toctou_err = revalidate_session_workspace_dir(&session_state, &sandbox_home)
            .expect_err("workspace_dir 在 session/new 后被替换为 symlink 时必须被 TOCTOU 复验拦截");
        assert_eq!(dir_toctou_err.0, -32003);
        assert!(dir_toctou_err.1.contains("TOCTOU"));

        // 5. 场景 C：父级频道目录 channels/chan-toctou 被整体替换为指向其他频道或沙箱外的 symlink
        let chan_dir = sandbox_home.join("channels/chan-toctou");
        let _ = std::fs::remove_dir_all(&chan_dir);
        std::os::unix::fs::symlink(&outside_dir, &chan_dir)
            .expect("replace parent channel dir with symlink");

        let parent_toctou_err = revalidate_session_workspace_dir(&session_state, &sandbox_home)
            .expect_err("祖先目录在 session/new 后被替换为 symlink 时必须被 TOCTOU 复验拦截");
        assert_eq!(parent_toctou_err.0, -32003);
        assert!(parent_toctou_err.1.contains("TOCTOU"));

        let _ = std::fs::remove_dir_all(&temp_base);
    }

    #[tokio::test]
    async fn test_fallback_session_lifecycle_runs_session_prompt_successfully() {
        let _lock = TEST_CWD_LOCK.lock().unwrap();
        let orig_cwd = std::env::current_dir().ok();

        let temp_base = std::env::temp_dir().join(format!(
            "shadow_crew_fallback_lifecycle_test_{}",
            std::process::id()
        ));
        let sandbox_home = temp_base.join("home");
        let outside_dir = temp_base.join("outside");
        std::fs::create_dir_all(&sandbox_home).unwrap();
        std::fs::create_dir_all(&outside_dir).unwrap();

        // 场景 1：Channel 目录被恶意篡改为指向沙箱外的 symlink，触发回退到 channels/chan-safe-default
        let chan_link_path = sandbox_home.join("channels/chan-attack");
        std::fs::create_dir_all(sandbox_home.join("channels")).unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(&outside_dir, &chan_link_path).unwrap();
        #[cfg(windows)]
        std::os::windows::fs::symlink_dir(&outside_dir, &chan_link_path).unwrap();

        let cfg = resolve_new_session_config(
            &serde_json::json!({
                "channelId": "chan-attack",
                "sessionKey": "channel:chan-attack:topic-1"
            }),
            &sandbox_home,
            None,
        )
        .expect("resolve_new_session_config 应自动回退至 chan-safe-default 安全目录");

        assert!(
            cfg.target_workspace_dir
                .ends_with("channels/chan-safe-default"),
            "target_workspace_dir 应回退到 chan-safe-default: {:?}",
            cfg.target_workspace_dir
        );
        assert!(
            cfg.owner_dir.ends_with("channels/chan-safe-default"),
            "owner_dir 必须记录为 chan-safe-default: {:?}",
            cfg.owner_dir
        );
        assert_eq!(cfg.session_channel_id, "chan-attack");

        let fallback_session = SessionState {
            session_id: cfg.unique_session_id.clone(),
            session_key: cfg.effective_key.clone(),
            channel_id: cfg.session_channel_id.clone(),
            owner_dir: cfg.owner_dir.clone(),
            workspace_dir: cfg.target_workspace_dir.clone(),
            system_prompt: None,
            mcp_pool_key: cfg.mcp_pool_key.clone(),
            mcp_client: None,
        };

        // 验证：回退会话在 session/prompt 阶段的 TOCTOU 复验必须成功，绝不得被错误拒绝
        let verified_ws = revalidate_session_workspace_dir(&fallback_session, &sandbox_home)
            .expect("合法回退会话必须顺利通过 session/prompt 的 TOCTOU 复验");
        assert_eq!(
            std::fs::canonicalize(&verified_ws).unwrap(),
            std::fs::canonicalize(&fallback_session.workspace_dir).unwrap()
        );

        // 验证：原子进入工作区目录也必须成功
        enter_workspace_dir_safe(&verified_ws).expect("安全回退目录原子进入应成功");

        // 场景 2：DM 会话的 agent 目录为指向沙箱外的 symlink，触发回退到 agents/agent-safe-default
        let agent_link_path = sandbox_home.join("agents/agent-attack");
        std::fs::create_dir_all(sandbox_home.join("agents")).unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(&outside_dir, &agent_link_path).unwrap();
        #[cfg(windows)]
        std::os::windows::fs::symlink_dir(&outside_dir, &agent_link_path).unwrap();

        let dm_cfg = resolve_new_session_config(
            &serde_json::json!({
                "isDirectMessage": true,
                "agentId": "agent-attack",
                "sessionKey": "dm:agent-attack:thread-1"
            }),
            &sandbox_home,
            Some("agent-attack"),
        )
        .expect("DM resolve_new_session_config 应自动回退至 agent-safe-default");

        assert!(
            dm_cfg.owner_dir.ends_with("agents/agent-safe-default"),
            "DM owner_dir 必须记录为 agent-safe-default: {:?}",
            dm_cfg.owner_dir
        );

        let dm_fallback_session = SessionState {
            session_id: dm_cfg.unique_session_id.clone(),
            session_key: dm_cfg.effective_key.clone(),
            channel_id: dm_cfg.session_channel_id.clone(),
            owner_dir: dm_cfg.owner_dir.clone(),
            workspace_dir: dm_cfg.target_workspace_dir.clone(),
            system_prompt: None,
            mcp_pool_key: dm_cfg.mcp_pool_key.clone(),
            mcp_client: None,
        };

        let verified_dm_ws = revalidate_session_workspace_dir(&dm_fallback_session, &sandbox_home)
            .expect("DM 回退会话必须顺利通过 session/prompt 的 TOCTOU 复验");
        enter_workspace_dir_safe(&verified_dm_ws).expect("DM 安全回退目录原子进入应成功");

        if let Some(orig) = orig_cwd {
            let _ = std::env::set_current_dir(orig);
        }
        let _ = std::fs::remove_dir_all(&temp_base);
    }

    #[test]
    fn test_atomic_workspace_enter_blocks_symlink_replacement() {
        let _lock = TEST_CWD_LOCK.lock().unwrap();
        let orig_cwd = std::env::current_dir().ok();

        let temp_base = std::env::temp_dir().join(format!(
            "shadow_crew_atomic_enter_test_{}",
            std::process::id()
        ));
        let real_dir = temp_base.join("real_workspace");
        let symlink_path = temp_base.join("symlink_workspace");
        std::fs::create_dir_all(&real_dir).unwrap();

        // 建立指向真实工作区的 symlink
        #[cfg(unix)]
        std::os::unix::fs::symlink(&real_dir, &symlink_path).unwrap();
        #[cfg(windows)]
        std::os::windows::fs::symlink_dir(&real_dir, &symlink_path).unwrap();

        // 真实目录进入必须成功
        enter_workspace_dir_safe(&real_dir).expect("进入真实物理目录应成功");

        // 符号链接必须被 O_NOFOLLOW 拒绝，杜绝 TOCTOU 竞争替换
        let err = enter_workspace_dir_safe(&symlink_path)
            .expect_err("通过 symlink 进入工作区必须被 enter_workspace_dir_safe 阻断");
        assert!(
            err.kind() == std::io::ErrorKind::PermissionDenied
                || err.kind() == std::io::ErrorKind::InvalidInput
                || err.raw_os_error() == Some(libc::ELOOP)
                || err.raw_os_error() == Some(libc::ENOTDIR),
            "错误类型应匹配 symlink 拒绝: {:?}",
            err
        );

        if let Some(orig) = orig_cwd {
            let _ = std::env::set_current_dir(orig);
        }
        let _ = std::fs::remove_dir_all(&temp_base);
    }

    #[test]
    fn test_session_load_restoration_and_workspace_revalidation() {
        let temp_home = std::env::temp_dir().join(format!(
            "shadow_crew_session_load_test_{}",
            std::process::id()
        ));
        let chan_id = "test-load-chan";
        let expected_owner = temp_home.join("channels").join(chan_id);
        std::fs::create_dir_all(&expected_owner).unwrap();
        let canonical_expected_owner =
            std::fs::canonicalize(&expected_owner).unwrap_or(expected_owner.clone());

        let persisted_session_id = "session-topic:test-load-chan:thread-1:standard";
        let load_params = serde_json::json!({
            "sessionId": persisted_session_id,
            "sessionKey": "topic:test-load-chan:thread-1:standard",
            "channelId": chan_id,
            "cwd": expected_owner.to_string_lossy(),
            "systemPrompt": "You are a test agent"
        });

        let resolved_cfg = resolve_new_session_config(&load_params, &temp_home, None)
            .expect("session/load 参数解析必须成功");

        assert_eq!(resolved_cfg.session_channel_id, chan_id);
        assert!(!resolved_cfg.is_dm);
        assert_eq!(resolved_cfg.target_workspace_dir, canonical_expected_owner);

        let restored_state = SessionState {
            session_id: persisted_session_id.to_string(),
            session_key: resolved_cfg.effective_key,
            channel_id: resolved_cfg.session_channel_id,
            owner_dir: resolved_cfg.owner_dir,
            workspace_dir: resolved_cfg.target_workspace_dir,
            system_prompt: Some("You are a test agent".to_string()),
            mcp_pool_key: resolved_cfg.mcp_pool_key,
            mcp_client: None,
        };

        // 验证恢复出的 SessionState 可顺利通过 session/prompt 阶段的 TOCTOU 复验
        let verified = revalidate_session_workspace_dir(&restored_state, &temp_home)
            .expect("恢复的 SessionState 必须通过工作区目录复验");
        assert_eq!(verified, canonical_expected_owner);

        let _ = std::fs::remove_dir_all(&temp_home);
    }
}
