use anyhow::{Context, Result};
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, oneshot, Mutex as TokioMutex};

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

static NEXT_INIT_REQUEST_ID: AtomicU64 = AtomicU64::new(1001);

fn next_init_request_id() -> u64 {
    NEXT_INIT_REQUEST_ID.fetch_add(1, Ordering::Relaxed)
}

/// 格式化并写入本地持久化日志文件 (~/.shadow-crew/logs/acp.log)
pub fn log_acp_event(agent_id: &str, direction: &str, line: &str) {
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
    let formatted = format!("[{}] [{}] [{}] {}\n", now, agent_id, direction, line);

    let logs_dir = crate::db_manager::get_shadow_crew_home_dir().join("logs");
    let _ = std::fs::create_dir_all(&logs_dir);
    let log_file = logs_dir.join("acp.log");

    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_file)
    {
        use std::io::Write;
        let _ = file.write_all(formatted.as_bytes());
    }
}

pub fn get_acp_log_path() -> String {
    let logs_dir = crate::db_manager::get_shinobi_home_dir().join("logs");
    let _ = std::fs::create_dir_all(&logs_dir);
    let log_file = logs_dir.join("acp.log");
    log_file.to_string_lossy().to_string()
}

pub fn read_recent_acp_logs(lines_count: usize) -> String {
    let log_path = get_acp_log_path();
    if let Ok(content) = std::fs::read_to_string(&log_path) {
        let lines: Vec<&str> = content.lines().collect();
        let start = if lines.len() > lines_count {
            lines.len() - lines_count
        } else {
            0
        };
        lines[start..].join("\n")
    } else {
        format!("暂无日志文件或尚未生成: {}", log_path)
    }
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
#[serde(untagged)]
pub enum AcpEnvVar {
    Pair(String, String),
    Object { key: String, value: String },
}

impl AcpEnvVar {
    pub fn into_pair(self) -> (String, String) {
        match self {
            AcpEnvVar::Pair(k, v) => (k, v),
            AcpEnvVar::Object { key, value } => (key, value),
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpNativeMemoryCapability {
    pub status: String,
    pub persistent: Option<bool>,
    pub cross_thread: Option<bool>,
    pub provider: Option<String>,
    pub scope: Option<String>,
    pub detail: Option<String>,
    pub last_checked_at: u64,
}

impl Default for AcpNativeMemoryCapability {
    fn default() -> Self {
        Self {
            status: "unknown".to_string(),
            persistent: None,
            cross_thread: None,
            provider: None,
            scope: Some("unknown".to_string()),
            detail: Some("等待 ACP 端点握手声明".to_string()),
            last_checked_at: 0,
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AgentRuntimeStatus {
    pub agent_id: String,
    pub pid: u32,
    pub is_alive: bool,
    pub is_initialized: bool,
    pub auth_state: String, // "ok" | "auth_required" | "missing_key" | "unknown"
    pub status: String,     // "running" | "auth_required" | "starting" | "error" | "idle"
    pub status_detail: Option<String>,
    pub supports_load_session: Option<bool>,
    pub supports_resume_session: Option<bool>,
    pub native_memory: Option<AcpNativeMemoryCapability>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionEntry {
    pub session_id: String,
    pub system_prompt: String,
    pub created_gen: u64,
}

#[derive(Debug, Default, Clone)]
pub struct SessionRegistry {
    pub entries: HashMap<String, SessionEntry>,
    pub latest_clear_generation: u64,
}

impl SessionRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn get(&self, session_key: &str) -> Option<&SessionEntry> {
        self.entries.get(session_key)
    }

    pub fn insert(
        &mut self,
        session_key: String,
        session_id: String,
        system_prompt: String,
    ) -> u64 {
        let created_gen = self.latest_clear_generation + 1;
        self.entries.insert(
            session_key,
            SessionEntry {
                session_id,
                system_prompt,
                created_gen,
            },
        );
        created_gen
    }

    pub fn remove(&mut self, session_key: &str) -> Option<SessionEntry> {
        self.entries.remove(session_key)
    }

    /// 按作用域与清理代际（`clear_generation`）原子裁剪会话映射表：
    /// 1. 若 `clear_generation < latest_clear_generation`，判定为已超时/被新请求取代的迟到清理，直接返回空列表且不修改任何状态；
    /// 2. 否则推进 `latest_clear_generation`，并仅移除匹配作用域且 `created_gen <= clear_generation` 的会话，保护清理发起后新建的会话不被误删。
    pub fn prune_with_generation(
        &mut self,
        key_or_prefix: Option<&str>,
        clear_generation: Option<u64>,
    ) -> Vec<String> {
        if let Some(gen) = clear_generation {
            if gen < self.latest_clear_generation {
                tracing::warn!(
                    "[ACP Manager] Ignoring stale clear_sessions request (gen {} < latest {})",
                    gen,
                    self.latest_clear_generation
                );
                return Vec::new();
            }
            self.latest_clear_generation = self.latest_clear_generation.max(gen);
        }

        let mut removed_sessions: Vec<String> = Vec::new();

        if let Some(target) = key_or_prefix {
            let t = target.trim();
            // 精确 key 匹配或冒号前缀边界匹配 (如 "topic:c1:" 或 "channel:c1:")，杜绝 contains 模糊误删相邻键
            let colon_prefix = if t.ends_with(':') {
                t.to_string()
            } else {
                format!("{}:", t)
            };
            let mut keys_to_remove = Vec::new();

            for (k, entry) in self.entries.iter() {
                if k == t || k.starts_with(&colon_prefix) {
                    if let Some(max_gen) = clear_generation {
                        if entry.created_gen > max_gen {
                            continue;
                        }
                    }
                    keys_to_remove.push(k.clone());
                    removed_sessions.push(entry.session_id.clone());
                }
            }

            for k in keys_to_remove {
                self.entries.remove(&k);
            }
        } else if let Some(max_gen) = clear_generation {
            let mut keys_to_remove = Vec::new();
            for (k, entry) in self.entries.iter() {
                if entry.created_gen > max_gen {
                    continue;
                }
                keys_to_remove.push(k.clone());
                removed_sessions.push(entry.session_id.clone());
            }
            for k in keys_to_remove {
                self.entries.remove(&k);
            }
        } else {
            removed_sessions.extend(self.entries.values().map(|e| e.session_id.clone()));
            self.entries.clear();
        }

        removed_sessions
    }
}

/// 检查 ACP initialize 响应中是否声明了 loadSession 能力 (支持 capabilities.loadSession 或 agentCapabilities.loadSession)
pub fn check_supports_load_session(result: &serde_json::Value) -> bool {
    result
        .get("capabilities")
        .and_then(|c| c.get("loadSession"))
        .and_then(|v| v.as_bool())
        .or_else(|| {
            result
                .get("agentCapabilities")
                .and_then(|c| c.get("loadSession"))
                .and_then(|v| v.as_bool())
        })
        .or_else(|| {
            result
                .get("capabilities")
                .and_then(|c| c.get("sessions"))
                .and_then(|s| s.get("load"))
                .and_then(|v| v.as_bool())
        })
        .or_else(|| {
            result
                .get("agentCapabilities")
                .and_then(|c| c.get("sessions"))
                .and_then(|s| s.get("load"))
                .and_then(|v| v.as_bool())
        })
        .unwrap_or(false)
}

/// 检查 ACP initialize 响应中是否声明了 session/resume 能力 (优先遵循 ACP v1 标准 agentCapabilities.sessionCapabilities.resume，同时兼容平铺拓展)
pub fn check_supports_resume_session(result: &serde_json::Value) -> bool {
    result
        .get("agentCapabilities")
        .and_then(|c| c.get("sessionCapabilities"))
        .and_then(|s| s.get("resume"))
        .or_else(|| {
            result
                .get("sessionCapabilities")
                .and_then(|c| c.get("resume"))
        })
        .or_else(|| {
            result
                .get("capabilities")
                .and_then(|c| c.get("sessionCapabilities"))
                .and_then(|s| s.get("resume"))
        })
        .or_else(|| {
            result
                .get("capabilities")
                .and_then(|c| c.get("resume"))
                .filter(|v| v.as_bool() == Some(true))
        })
        .or_else(|| {
            result
                .get("agentCapabilities")
                .and_then(|c| c.get("resume"))
                .filter(|v| v.as_bool() == Some(true))
        })
        .is_some()
}

/// 解析 ACP 可选扩展 agentCapabilities.nativeMemory。
///
/// 契约示例：
/// ```json
/// {
///   "agentCapabilities": {
///     "nativeMemory": {
///       "supported": true,
///       "enabled": true,
///       "persistent": true,
///       "crossThread": true,
///       "scope": "runtime",
///       "provider": "codex-memories"
///     }
///   }
/// }
/// ```
pub fn check_native_memory_capability(result: &serde_json::Value) -> AcpNativeMemoryCapability {
    let Some(raw) = result
        .get("agentCapabilities")
        .and_then(|capabilities| capabilities.get("nativeMemory"))
        .and_then(|value| value.as_object())
    else {
        return AcpNativeMemoryCapability {
            status: "unknown".to_string(),
            persistent: None,
            cross_thread: None,
            provider: None,
            scope: Some("unknown".to_string()),
            detail: Some("ACP 端点未声明 nativeMemory 扩展".to_string()),
            last_checked_at: now_millis(),
        };
    };

    let supported = raw.get("supported").and_then(|value| value.as_bool());
    let enabled = raw.get("enabled").and_then(|value| value.as_bool());
    let status = match (supported, enabled) {
        (Some(false), _) => "unsupported",
        (Some(true), Some(false)) => "disabled",
        (Some(true), Some(true)) => "enabled",
        _ => "unknown",
    };
    let scope = raw
        .get("scope")
        .and_then(|value| value.as_str())
        .filter(|value| matches!(*value, "agent" | "workspace" | "runtime"))
        .unwrap_or("unknown")
        .to_string();

    AcpNativeMemoryCapability {
        status: status.to_string(),
        persistent: raw.get("persistent").and_then(|value| value.as_bool()),
        cross_thread: raw.get("crossThread").and_then(|value| value.as_bool()),
        provider: raw
            .get("provider")
            .and_then(|value| value.as_str())
            .map(str::to_string),
        scope: Some(scope),
        detail: raw
            .get("detail")
            .and_then(|value| value.as_str())
            .map(str::to_string)
            .or_else(|| {
                (status == "unknown")
                    .then(|| "ACP 端点 nativeMemory 声明缺少有效的 supported/enabled 布尔字段".to_string())
            }),
        last_checked_at: now_millis(),
    }
}

pub fn maybe_refresh_native_memory_capability(
    result: &serde_json::Value,
) -> Option<AcpNativeMemoryCapability> {
    result
        .get("agentCapabilities")
        .and_then(|capabilities| capabilities.get("nativeMemory"))
        .and_then(|value| value.as_object())?;
    Some(check_native_memory_capability(result))
}

fn build_native_memory_prompt_meta(
    enabled: Option<bool>,
    auto_generate: Option<bool>,
) -> serde_json::Value {
    let enabled = enabled.unwrap_or(false);
    serde_json::json!({
        "shadowCrew": {
            "nativeMemory": {
                "enabled": enabled,
                "autoGenerate": enabled && auto_generate.unwrap_or(false)
            }
        }
    })
}

/// 从 ACP session/update 载荷中提取文本内容
pub fn extract_update_text(update: &serde_json::Value) -> Option<String> {
    if let Some(text) = update
        .get("content")
        .and_then(|c| c.get("text"))
        .and_then(|t| t.as_str())
    {
        Some(text.to_string())
    } else if let Some(s) = update.get("content").and_then(|c| c.as_str()) {
        Some(s.to_string())
    } else if let Some(arr) = update.get("content").and_then(|c| c.as_array()) {
        let mut combined = String::new();
        for item in arr {
            if let Some(t) = item.get("text").and_then(|t| t.as_str()) {
                combined.push_str(t);
            } else if let Some(s) = item.as_str() {
                combined.push_str(s);
            }
        }
        if !combined.is_empty() {
            Some(combined)
        } else {
            None
        }
    } else if let Some(text) = update
        .get("item")
        .and_then(|i| i.get("text"))
        .and_then(|t| t.as_str())
    {
        Some(text.to_string())
    } else {
        None
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayMessageItem {
    pub message_id: String,
    pub role: String,
    pub content: String,
    pub timestamp: u64,
}

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct ReplaySinkState {
    pub session_id: String,
    pub session_key: String,
    pub agent_id: String,
    pub room_id: String,
    pub messages: Vec<ReplayMessageItem>,
    pub current_chunk_buffer: String,
    pub current_message_id: Option<String>,
    pub current_role: Option<String>,
}

impl ReplaySinkState {
    pub fn new(session_id: String, session_key: String, agent_id: String, room_id: String) -> Self {
        Self {
            session_id,
            session_key,
            agent_id,
            room_id,
            messages: Vec::new(),
            current_chunk_buffer: String::new(),
            current_message_id: None,
            current_role: None,
        }
    }

    pub fn flush_current_chunk(&mut self) {
        if !self.current_chunk_buffer.trim().is_empty() {
            let role = self
                .current_role
                .clone()
                .unwrap_or_else(|| "assistant".to_string());
            let msg_id = self.current_message_id.clone().unwrap_or_else(|| {
                format!("msg-replay-{}-{}", &self.session_id, self.messages.len())
            });
            let content = std::mem::take(&mut self.current_chunk_buffer);
            self.messages.push(ReplayMessageItem {
                message_id: msg_id,
                role,
                content,
                timestamp: std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as u64,
            });
            self.current_message_id = None;
            self.current_role = None;
        } else {
            self.current_chunk_buffer.clear();
            self.current_message_id = None;
            self.current_role = None;
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnsureSessionResult {
    pub session_id: String,
    pub is_new: bool,
    pub load_failed: bool,
    pub recovery_mode: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AcpPermissionOptionView {
    pub option_id: String,
    pub name: String,
    pub kind: String,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpPermissionRequestView {
    pub request_id: String,
    pub agent_id: String,
    pub session_id: String,
    pub session_key: String,
    pub scope_type: String,
    pub scope_id: String,
    pub workspace_binding_id: String,
    pub cwd: String,
    pub capability: String,
    pub tool_name: String,
    pub tool_title: String,
    pub tool_kind: String,
    pub command: Option<String>,
    pub paths: Vec<String>,
    pub outside_workspace_paths: Vec<String>,
    pub description: Option<String>,
    pub supports_allow_once: bool,
    pub supports_reject: bool,
    pub options: Vec<AcpPermissionOptionView>,
    pub created_at: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PermissionScopeContext {
    pub scope_type: String,
    pub scope_id: String,
    pub workspace_binding_id: String,
    pub session_key: String,
    pub cwd: String,
}

#[derive(Debug, Clone, Hash, PartialEq, Eq)]
pub struct PermissionGrantKey {
    pub scope_type: String,
    pub scope_id: String,
    pub workspace_binding_id: String,
    pub capability: String,
}

#[derive(Debug, Clone, Hash, PartialEq, Eq)]
pub struct SessionPermissionGrantKey {
    pub session_id: String,
    pub grant: PermissionGrantKey,
}

#[derive(Debug, Clone)]
pub struct PendingAcpPermission {
    pub rpc_id: serde_json::Value,
    pub view: AcpPermissionRequestView,
    pub options: Vec<AcpPermissionOptionView>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AcpPermissionDecision {
    Deny,
    AllowOnce,
    AllowSession,
    AllowScope,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpPromptAttachment {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub mime_type: String,
    pub size: u64,
    pub path: String,
    pub uri: String,
}

impl AcpPermissionDecision {
    pub fn parse(raw: &str) -> Result<Self> {
        match raw.trim() {
            "deny" => Ok(Self::Deny),
            "allow_once" => Ok(Self::AllowOnce),
            "allow_session" => Ok(Self::AllowSession),
            "allow_scope" => Ok(Self::AllowScope),
            other => anyhow::bail!("Unsupported ACP permission decision: {}", other),
        }
    }

    fn is_allow(self) -> bool {
        !matches!(self, Self::Deny)
    }
}

fn jsonrpc_id_key(id: &serde_json::Value) -> Option<String> {
    if let Some(value) = id.as_str() {
        return Some(value.to_string());
    }
    if let Some(value) = id.as_u64() {
        return Some(value.to_string());
    }
    if let Some(value) = id.as_i64() {
        return Some(value.to_string());
    }
    None
}

fn acp_client_capabilities() -> serde_json::Value {
    serde_json::json!({
        "fs": {
            "readTextFile": false,
            "writeTextFile": false
        },
        "terminal": false
    })
}

fn check_supports_prompt_image(result: &serde_json::Value) -> bool {
    result
        .get("agentCapabilities")
        .and_then(|value| value.get("promptCapabilities"))
        .and_then(|value| value.get("image"))
        .and_then(|value| value.as_bool())
        .or_else(|| {
            result
                .get("promptCapabilities")
                .and_then(|value| value.get("image"))
                .and_then(|value| value.as_bool())
        })
        .unwrap_or(false)
}

fn check_supports_embedded_context(result: &serde_json::Value) -> bool {
    result
        .get("agentCapabilities")
        .and_then(|value| value.get("promptCapabilities"))
        .and_then(|value| value.get("embeddedContext"))
        .and_then(|value| value.as_bool())
        .or_else(|| {
            result
                .get("promptCapabilities")
                .and_then(|value| value.get("embeddedContext"))
                .and_then(|value| value.as_bool())
        })
        .unwrap_or(false)
}

fn attachment_file_uri(path: &Path) -> String {
    let raw = path.to_string_lossy().replace('\\', "/");
    let mut encoded = String::new();
    for byte in raw.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'/' | b'-' | b'_' | b'.' | b'~') {
            encoded.push(byte as char);
        } else {
            encoded.push_str(&format!("%{:02X}", byte));
        }
    }
    if encoded.starts_with('/') {
        format!("file://{}", encoded)
    } else {
        format!("file:///{}", encoded)
    }
}

fn resolve_acp_attachment_path(
    raw_path: &str,
    attachment_root: &Path,
) -> Result<PathBuf> {
    let canonical_root = std::fs::canonicalize(attachment_root)
        .with_context(|| format!("Attachment root is unavailable: {}", attachment_root.display()))?;
    let canonical_path = std::fs::canonicalize(raw_path)
        .with_context(|| format!("Attachment does not exist: {}", raw_path))?;
    if !canonical_path.starts_with(&canonical_root) {
        anyhow::bail!(
            "Attachment path escapes Shadow Crew attachment root: {}",
            raw_path
        );
    }
    if !canonical_path.is_file() {
        anyhow::bail!("Attachment is not a regular file: {}", raw_path);
    }
    Ok(canonical_path)
}

fn build_prompt_content_blocks(
    prompt: &str,
    attachments: &[AcpPromptAttachment],
    supports_image: bool,
    supports_embedded_context: bool,
) -> Result<Vec<serde_json::Value>> {
    let attachment_root = crate::db_manager::get_shadow_crew_home_dir().join("attachments");
    build_prompt_content_blocks_from_root(
        prompt,
        attachments,
        supports_image,
        supports_embedded_context,
        &attachment_root,
    )
}

fn build_prompt_content_blocks_from_root(
    prompt: &str,
    attachments: &[AcpPromptAttachment],
    supports_image: bool,
    supports_embedded_context: bool,
    attachment_root: &Path,
) -> Result<Vec<serde_json::Value>> {
    let mut blocks = vec![serde_json::json!({
        "type": "text",
        "text": prompt
    })];

    for attachment in attachments {
        let path = resolve_acp_attachment_path(&attachment.path, attachment_root)?;
        let bytes = std::fs::read(&path)
            .with_context(|| format!("Failed to read ACP attachment: {}", path.display()))?;
        if bytes.len() as u64 != attachment.size {
            anyhow::bail!(
                "Attachment size changed after upload: {} (expected {}, actual {})",
                attachment.name,
                attachment.size,
                bytes.len()
            );
        }
        if attachment.uri.trim().is_empty() {
            anyhow::bail!("Attachment URI is missing for '{}'", attachment.name);
        }
        let uri = attachment_file_uri(&path);

        if attachment.kind == "image" {
            if !supports_image {
                anyhow::bail!(
                    "当前 ACP Agent 未声明 promptCapabilities.image，无法发送图片附件 '{}'",
                    attachment.name
                );
            }
            blocks.push(serde_json::json!({
                "type": "image",
                "data": BASE64_STANDARD.encode(&bytes),
                "mimeType": attachment.mime_type,
                "uri": uri,
                "_meta": {
                    "shadowCrewAttachmentId": attachment.id,
                    "name": attachment.name
                }
            }));
            continue;
        }

        if supports_embedded_context {
            let resource = if let Ok(text) = String::from_utf8(bytes.clone()) {
                serde_json::json!({
                    "uri": uri,
                    "mimeType": attachment.mime_type,
                    "text": text
                })
            } else {
                serde_json::json!({
                    "uri": uri,
                    "mimeType": attachment.mime_type,
                    "blob": BASE64_STANDARD.encode(&bytes)
                })
            };
            blocks.push(serde_json::json!({
                "type": "resource",
                "resource": resource
            }));
        } else {
            blocks.push(serde_json::json!({
                "type": "resource_link",
                "uri": uri,
                "name": attachment.name,
                "title": attachment.name,
                "description": "User-attached file from Shadow Crew",
                "mimeType": attachment.mime_type,
                "size": attachment.size
            }));
        }
    }
    Ok(blocks)
}

fn classify_permission_capability(tool_call: &serde_json::Value) -> String {
    let kind = tool_call
        .get("kind")
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    let name = tool_call
        .get("name")
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();

    match kind.as_str() {
        "read" | "search" => "fs.read",
        "edit" | "write" => "fs.write",
        "delete" | "move" => "fs.delete",
        "execute" => "shell.execute",
        "fetch" => "network.access",
        _ if name.contains("write")
            || name.contains("edit")
            || name.contains("replace")
            || name.contains("patch") =>
        {
            "fs.write"
        }
        _ if name.contains("delete")
            || name.contains("remove")
            || name.contains("unlink") =>
        {
            "fs.delete"
        }
        _ if name.contains("read")
            || name.contains("grep")
            || name.contains("search")
            || name.contains("glob")
            || name.contains("list") =>
        {
            "fs.read"
        }
        _ if name.contains("bash")
            || name.contains("shell")
            || name.contains("terminal")
            || name.contains("execute") =>
        {
            "shell.execute"
        }
        _ if name.contains("fetch")
            || name.contains("http")
            || name.contains("browser")
            || name.contains("web") =>
        {
            "network.access"
        }
        _ => "other",
    }
    .to_string()
}

fn permission_path_candidates(tool_call: &serde_json::Value) -> Vec<String> {
    let mut candidates = Vec::new();
    if let Some(locations) = tool_call.get("locations").and_then(|value| value.as_array()) {
        for location in locations {
            if let Some(path) = location.get("path").and_then(|value| value.as_str()) {
                if !path.trim().is_empty() {
                    candidates.push(path.trim().to_string());
                }
            }
        }
    }

    if let Some(raw_input) = tool_call.get("rawInput").and_then(|value| value.as_object()) {
        for key in [
            "file_path",
            "filePath",
            "path",
            "notebook_path",
            "notebookPath",
            "cwd",
            "workdir",
        ] {
            if let Some(path) = raw_input.get(key).and_then(|value| value.as_str()) {
                if !path.trim().is_empty() {
                    candidates.push(path.trim().to_string());
                }
            }
        }
    }

    let mut seen = HashSet::new();
    candidates
        .into_iter()
        .filter(|path| seen.insert(path.clone()))
        .collect()
}

fn expand_permission_path(raw: &str, cwd: &Path) -> PathBuf {
    let trimmed = raw.trim();
    let expanded = if trimmed == "~" || trimmed.starts_with("~/") {
        std::env::var("HOME")
            .or_else(|_| std::env::var("USERPROFILE"))
            .map(|home| {
                if trimmed == "~" {
                    PathBuf::from(home)
                } else {
                    PathBuf::from(home).join(&trimmed[2..])
                }
            })
            .unwrap_or_else(|_| PathBuf::from(trimmed))
    } else {
        PathBuf::from(trimmed)
    };

    if expanded.is_absolute() {
        expanded
    } else {
        cwd.join(expanded)
    }
}

fn normalize_lexical_path(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            std::path::Component::Prefix(prefix) => normalized.push(prefix.as_os_str()),
            std::path::Component::RootDir => normalized.push(component.as_os_str()),
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                normalized.pop();
            }
            std::path::Component::Normal(value) => normalized.push(value),
        }
    }
    normalized
}

fn resolve_permission_path(path: &Path) -> PathBuf {
    if let Ok(canonical) = std::fs::canonicalize(path) {
        return canonical;
    }
    if let (Some(parent), Some(name)) = (path.parent(), path.file_name()) {
        if let Ok(canonical_parent) = std::fs::canonicalize(parent) {
            return canonical_parent.join(name);
        }
    }
    normalize_lexical_path(path)
}

fn partition_permission_paths(
    paths: &[String],
    cwd: &Path,
) -> (Vec<String>, Vec<String>) {
    let canonical_cwd = std::fs::canonicalize(cwd).unwrap_or_else(|_| cwd.to_path_buf());
    let mut inside = Vec::new();
    let mut outside = Vec::new();
    for raw in paths {
        let resolved = resolve_permission_path(&expand_permission_path(raw, &canonical_cwd));
        let display = resolved.to_string_lossy().to_string();
        if resolved.starts_with(&canonical_cwd) {
            inside.push(display);
        } else {
            outside.push(display);
        }
    }
    (inside, outside)
}

fn parse_permission_options(params: &serde_json::Value) -> Vec<AcpPermissionOptionView> {
    params
        .get("options")
        .and_then(|value| value.as_array())
        .map(|options| {
            options
                .iter()
                .filter_map(|option| {
                    let option_id = option
                        .get("optionId")
                        .and_then(|value| value.as_str())
                        .filter(|value| !value.trim().is_empty())?
                        .to_string();
                    Some(AcpPermissionOptionView {
                        option_id,
                        name: option
                            .get("name")
                            .and_then(|value| value.as_str())
                            .unwrap_or_default()
                            .to_string(),
                        kind: option
                            .get("kind")
                            .and_then(|value| value.as_str())
                            .unwrap_or_default()
                            .to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn select_permission_option(
    options: &[AcpPermissionOptionView],
    decision: AcpPermissionDecision,
) -> Option<String> {
    if decision.is_allow() {
        return options
            .iter()
            .find(|option| option.kind == "allow_once")
            .or_else(|| {
                options.iter().find(|option| {
                    let option_id = option.option_id.to_ascii_lowercase();
                    option_id == "allow-once" || option_id == "allow_once"
                })
            })
            .map(|option| option.option_id.clone());
    }

    options
        .iter()
        .find(|option| option.kind == "reject_once")
        .or_else(|| {
            options.iter().find(|option| {
                option.kind.starts_with("reject")
                    || option.option_id.to_ascii_lowercase().contains("reject")
            })
        })
        .map(|option| option.option_id.clone())
}

fn permission_selected_response(
    rpc_id: serde_json::Value,
    option_id: &str,
) -> serde_json::Value {
    serde_json::json!({
        "jsonrpc": "2.0",
        "id": rpc_id,
        "result": {
            "outcome": {
                "outcome": "selected",
                "optionId": option_id
            }
        }
    })
}

fn permission_cancelled_response(rpc_id: serde_json::Value) -> serde_json::Value {
    serde_json::json!({
        "jsonrpc": "2.0",
        "id": rpc_id,
        "result": {
            "outcome": {
                "outcome": "cancelled"
            }
        }
    })
}

fn build_permission_grant_id(
    agent_id: &str,
    scope: &PermissionScopeContext,
    capability: &str,
) -> String {
    format!(
        "acp-grant:{}:{}:{}:{}:{}",
        agent_id, scope.scope_type, scope.scope_id, scope.workspace_binding_id, capability
    )
}

fn build_permission_request_view(
    agent_id: &str,
    request_id: String,
    session_id: String,
    scope: PermissionScopeContext,
    params: &serde_json::Value,
    options: Vec<AcpPermissionOptionView>,
) -> AcpPermissionRequestView {
    let tool_call = params
        .get("toolCall")
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}));
    let capability = classify_permission_capability(&tool_call);
    let raw_paths = permission_path_candidates(&tool_call);
    let (paths, outside_workspace_paths) =
        partition_permission_paths(&raw_paths, Path::new(&scope.cwd));
    let command = tool_call
        .get("rawInput")
        .and_then(|value| value.get("command"))
        .and_then(|value| value.as_str())
        .map(|value| value.to_string());
    let description = params
        .get("_meta")
        .and_then(|value| value.get("permission"))
        .and_then(|value| value.get("description"))
        .and_then(|value| value.as_str())
        .map(|value| value.to_string());
    let supports_allow_once = options
        .iter()
        .any(|option| option.kind == "allow_once");
    let supports_reject = options.iter().any(|option| {
        option.kind.starts_with("reject")
            || option.option_id.to_ascii_lowercase().contains("reject")
    });

    AcpPermissionRequestView {
        request_id,
        agent_id: agent_id.to_string(),
        session_id,
        session_key: scope.session_key,
        scope_type: scope.scope_type,
        scope_id: scope.scope_id,
        workspace_binding_id: scope.workspace_binding_id,
        cwd: scope.cwd,
        capability,
        tool_name: tool_call
            .get("name")
            .and_then(|value| value.as_str())
            .unwrap_or("unknown")
            .to_string(),
        tool_title: tool_call
            .get("title")
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .to_string(),
        tool_kind: tool_call
            .get("kind")
            .and_then(|value| value.as_str())
            .unwrap_or("other")
            .to_string(),
        command,
        paths,
        outside_workspace_paths,
        description,
        supports_allow_once,
        supports_reject,
        options,
        created_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64,
    }
}

#[derive(Clone)]
pub struct RunningAgent {
    pub agent_id: String,
    #[allow(dead_code)]
    pub pid: u32,
    pub child: Arc<TokioMutex<Option<Child>>>,
    pub stdin_tx: mpsc::Sender<String>,
    pub pending_requests: Arc<TokioMutex<HashMap<u64, oneshot::Sender<serde_json::Value>>>>,
    #[allow(dead_code)]
    pub active_chunks: Arc<TokioMutex<HashMap<u64, String>>>,
    pub session_active_req: Arc<TokioMutex<HashMap<String, u64>>>,
    pub loading_sessions: Arc<TokioMutex<HashSet<String>>>,
    pub replay_sinks: Arc<TokioMutex<HashMap<String, Arc<TokioMutex<ReplaySinkState>>>>>,
    pub is_alive: Arc<AtomicBool>,
    pub initialized: Arc<AtomicBool>,
    /// ACP 握手被 Agent 明确拒绝时的根因。存在即代表本进程不可用，运行态必须报 error。
    pub init_error: Arc<TokioMutex<Option<String>>>,
    pub auth_state: Arc<TokioMutex<String>>,
    pub status_detail: Arc<TokioMutex<Option<String>>>,
    pub session_registry: Arc<TokioMutex<SessionRegistry>>,
    pub permission_scopes: Arc<TokioMutex<HashMap<String, PermissionScopeContext>>>,
    pub pending_permissions: Arc<TokioMutex<HashMap<String, PendingAcpPermission>>>,
    pub session_permission_grants: Arc<TokioMutex<HashSet<SessionPermissionGrantKey>>>,
    pub pending_permission_count: Arc<AtomicUsize>,
    pub supports_load_session: Arc<AtomicBool>,
    pub supports_resume_session: Arc<AtomicBool>,
    pub supports_prompt_image: Arc<AtomicBool>,
    pub supports_embedded_context: Arc<AtomicBool>,
    pub native_memory_capability: Arc<TokioMutex<AcpNativeMemoryCapability>>,
    pub db_manager: Option<Arc<crate::db_manager::DatabaseManager>>,
    #[allow(dead_code)]
    pub cwd: String,
    pub app_handle: AppHandle,
    pub last_activity: Arc<AtomicU64>,
    pub expert_pack_id: Option<String>,
    /// 单 Agent 内部指令互斥锁：确保向同一 Agent 连续下发指令时不发生 stdio 管道竞态，
    /// 而不同 Agent 之间拥有独立的 RunningAgent 实例与子进程，完全并发、互不阻塞！
    pub prompt_lock: Arc<TokioMutex<()>>,
}

pub struct AcpProcessManager {
    agents: HashMap<String, RunningAgent>,
    db_manager: Option<Arc<crate::db_manager::DatabaseManager>>,
}

impl AcpProcessManager {
    #[allow(dead_code)]
    pub fn new() -> Self {
        Self {
            agents: HashMap::new(),
            db_manager: None,
        }
    }

    pub fn with_db(db_manager: Arc<crate::db_manager::DatabaseManager>) -> Self {
        Self {
            agents: HashMap::new(),
            db_manager: Some(db_manager),
        }
    }

    /// 检查指定 Agent 进程是否真正存活运行
    pub fn is_agent_running(&self, agent_id: &str) -> bool {
        self.agents
            .get(agent_id)
            .map(|a| a.is_alive.load(Ordering::SeqCst))
            .unwrap_or(false)
    }

    /// 获取指定 Agent 的轻量级 Clone 句柄 (持有子进程管道与锁的 Arc 引用)
    pub fn get_agent(&self, agent_id: &str) -> Option<RunningAgent> {
        self.agents.get(agent_id).cloned()
    }

    /// 将用户对本地 ACP 权限请求的决策写回对应 Agent 的 stdio 通道。
    pub async fn respond_to_acp_permission(
        &self,
        agent_id: &str,
        request_id: &str,
        decision: &str,
    ) -> Result<()> {
        let decision = AcpPermissionDecision::parse(decision)?;
        let agent = self
            .get_agent(agent_id)
            .ok_or_else(|| anyhow::anyhow!("Agent {} is not running", agent_id))?;
        agent
            .respond_to_permission(request_id, decision)
            .await
            .with_context(|| {
                format!(
                    "Failed to respond to ACP permission request {} for agent {}",
                    request_id, agent_id
                )
            })
    }

    /// 列出当前仍等待用户处理的本地 ACP 权限请求。
    pub async fn list_pending_acp_permissions(&self) -> Vec<AcpPermissionRequestView> {
        let mut requests = Vec::new();
        for agent in self.agents.values() {
            let pending = agent.pending_permissions.lock().await;
            requests.extend(pending.values().map(|item| item.view.clone()));
        }
        requests.sort_by_key(|request| request.created_at);
        requests
    }

    pub fn list_acp_permission_grants(
        &self,
        agent_id: Option<&str>,
    ) -> Result<Vec<crate::db_manager::AcpPermissionGrantRecord>> {
        let db = self
            .db_manager
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Database is unavailable"))?;
        db.list_acp_permission_grants(agent_id)
    }

    pub fn revoke_acp_permission_grant(&self, grant_id: &str) -> Result<bool> {
        let db = self
            .db_manager
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Database is unavailable"))?;
        db.revoke_acp_permission_grant(grant_id)
    }

    pub fn revoke_all_acp_permission_grants(&self) -> Result<usize> {
        let db = self
            .db_manager
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Database is unavailable"))?;
        db.revoke_all_acp_permission_grants()
    }

    pub fn revoke_acp_permission_grants_for_agent(&self, agent_id: &str) -> Result<usize> {
        let db = self
            .db_manager
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Database is unavailable"))?;
        db.revoke_acp_permission_grants_for_agent(agent_id)
    }

    pub fn revoke_acp_permission_grants_for_scope(
        &self,
        scope_type: &str,
        scope_id: &str,
    ) -> Result<usize> {
        let db = self
            .db_manager
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Database is unavailable"))?;
        db.revoke_acp_permission_grants_for_scope(scope_type, scope_id)
    }

    /// 获取当前所有正在运行的 Agent ID 列表
    pub fn get_running_agent_ids(&self) -> Vec<String> {
        self.agents
            .iter()
            .filter(|(_, a)| a.is_alive.load(Ordering::SeqCst))
            .map(|(id, _)| id.clone())
            .collect()
    }

    /// 获取当前所有 Agent 的细粒度运行时状态 (包括握手与鉴权)
    pub async fn get_agents_runtime_status(&self) -> Vec<AgentRuntimeStatus> {
        let mut statuses = Vec::new();
        for (id, agent) in &self.agents {
            let is_alive = agent.is_alive.load(Ordering::SeqCst);
            let is_initialized = agent.initialized.load(Ordering::SeqCst);
            let auth_state = agent.auth_state.lock().await.clone();
            let init_error = agent.init_error.lock().await.clone();
            let status_detail = match init_error.clone() {
                Some(err) => Some(err),
                None => agent.status_detail.lock().await.clone(),
            };

            let status =
                derive_runtime_status(is_alive, &auth_state, init_error.is_some()).to_string();
            let supports_load = if is_alive {
                Some(agent.supports_load_session.load(Ordering::SeqCst))
            } else {
                None
            };
            let supports_resume = if is_alive {
                Some(agent.supports_resume_session.load(Ordering::SeqCst))
            } else {
                None
            };
            let native_memory = if is_alive {
                Some(agent.native_memory_capability.lock().await.clone())
            } else {
                None
            };

            statuses.push(AgentRuntimeStatus {
                agent_id: id.clone(),
                pid: agent.pid,
                is_alive,
                is_initialized,
                auth_state,
                status,
                status_detail,
                supports_load_session: supports_load,
                supports_resume_session: supports_resume,
                native_memory,
            });
        }
        statuses
    }

    /// 清空指定 Agent 或指定前缀的所有会话 sessionId 映射，重置底层 ACP 会话沙箱
    #[allow(dead_code)]
    pub async fn clear_agent_sessions(
        &self,
        agent_id: Option<&str>,
        session_key_prefix: Option<&str>,
    ) -> Result<()> {
        self.clear_agent_sessions_with_generation(agent_id, session_key_prefix, None)
            .await
    }

    /// 带代际令牌 (clear_generation) 的会话清理：若迟到请求的 generation 小于已执行的最新代际，或目标会话创建于该 generation 之后，则跳过误删
    pub async fn clear_agent_sessions_with_generation(
        &self,
        agent_id: Option<&str>,
        session_key_prefix: Option<&str>,
        clear_generation: Option<u64>,
    ) -> Result<()> {
        if let Some(aid) = agent_id {
            if let Some(agent) = self.agents.get(aid) {
                agent
                    .clear_sessions_with_generation(session_key_prefix, clear_generation)
                    .await;
            } else if let Some(ref db) = self.db_manager {
                // Agent 进程当前未在运行，但收到会话清理请求，直接同步清理 SQLite 持久化记录（带 generation 保护）
                db.delete_acp_session(Some(aid), session_key_prefix, clear_generation)
                    .with_context(|| format!("Failed to delete ACP session for agent '{}'", aid))?;
            }
        } else {
            for agent in self.agents.values() {
                agent
                    .clear_sessions_with_generation(session_key_prefix, clear_generation)
                    .await;
            }
            if let Some(ref db) = self.db_manager {
                db.delete_acp_session(None, session_key_prefix, clear_generation)
                    .with_context(|| "Failed to delete ACP sessions globally".to_string())?;
            }
        }
        Ok(())
    }

    /// 预检并确保指定 Agent 在当前会话下拥有已建立或已恢复的 ACP sessionId
    #[allow(dead_code)]
    pub async fn ensure_session(
        &self,
        agent_id: &str,
        room_id: &str,
        channel_id: Option<&str>,
        system_prompt: Option<&str>,
        discussion_mode: Option<&str>,
        local_history_intact: Option<bool>,
    ) -> Result<EnsureSessionResult> {
        let agent = self
            .get_agent(agent_id)
            .with_context(|| format!("Agent {} not running", agent_id))?;
        agent
            .ensure_session(
                agent_id,
                room_id,
                channel_id,
                None,
                None,
                None,
                system_prompt,
                discussion_mode,
                local_history_intact,
            )
            .await
    }

    /// 终止指定 Agent 进程并释放资源
    pub async fn stop_agent(&mut self, agent_id: &str) -> Result<()> {
        if let Some(agent) = self.agents.remove(agent_id) {
            agent.is_alive.store(false, Ordering::SeqCst);
            drop(agent.stdin_tx);
            if let Some(mut child) = agent.child.lock().await.take() {
                let _ = child.kill().await;
            }
            log_acp_event(agent_id, "STOPPED", "Agent process terminated by user");
        }
        Ok(())
    }

    /// 启动子进程并接管 stdin/stdout
    pub async fn spawn_agent(
        &mut self,
        agent_id: &str,
        command_line: &str,
        cwd: &str,
        env_vars: Option<Vec<AcpEnvVar>>,
        app_handle: AppHandle,
    ) -> Result<u32> {
        // 若该 Agent 之前已在运行，先行安全清理旧进程
        if let Some(old_agent) = self.agents.remove(agent_id) {
            old_agent.is_alive.store(false, Ordering::SeqCst);
            drop(old_agent.stdin_tx);
            if let Some(mut old_child) = old_agent.child.lock().await.take() {
                let _ = old_child.kill().await;
            }
            log_acp_event(
                agent_id,
                "REPLACED",
                "Killed previous instance before respawning",
            );
        }

        let mut actual_cmd = command_line.to_string();
        let host_cwd = std::env::current_dir()
            .ok()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| ".".to_string());

        // 预先解析 shadow-crew-dev-mcp (及 shinobi-dev-mcp) 绝对路径，防止切换 current_dir 到 ~/.shadow-crew 后相对路径失效
        let mut resolved_dev_mcp: Option<String> = None;
        let possible_mcp_bins = [
            format!("{}/target/debug/shadow-crew-dev-mcp", cwd),
            format!("{}/target/release/shadow-crew-dev-mcp", cwd),
            format!("{}/target/debug/shadow-crew-dev-mcp", host_cwd),
            format!("{}/target/release/shadow-crew-dev-mcp", host_cwd),
            "target/debug/shadow-crew-dev-mcp".to_string(),
            "target/release/shadow-crew-dev-mcp".to_string(),
            "../target/debug/shadow-crew-dev-mcp".to_string(),
            "../../target/debug/shadow-crew-dev-mcp".to_string(),
            format!("{}/target/debug/shinobi-dev-mcp", cwd),
            format!("{}/target/release/shinobi-dev-mcp", cwd),
            format!("{}/target/debug/shinobi-dev-mcp", host_cwd),
            format!("{}/target/release/shinobi-dev-mcp", host_cwd),
            "target/debug/shinobi-dev-mcp".to_string(),
            "target/release/shinobi-dev-mcp".to_string(),
            "../target/debug/shinobi-dev-mcp".to_string(),
            "../../target/debug/shinobi-dev-mcp".to_string(),
        ];
        for mcp_bin in &possible_mcp_bins {
            if let Ok(canonical) = std::fs::canonicalize(mcp_bin) {
                if canonical.is_file() {
                    resolved_dev_mcp = Some(canonical.to_string_lossy().to_string());
                    break;
                }
            }
        }

        // 智能路径探测: codex-acp 适配器命令
        let home = std::env::var("HOME").unwrap_or_default();
        if command_line.contains("codex-acp") {
            let possible_bins = [
                format!("{}/bin/codex-acp", cwd),
                format!("{}/bin/codex-acp", host_cwd),
                "bin/codex-acp".to_string(),
                "../bin/codex-acp".to_string(),
                format!("{}/.local/bin/codex-acp", home),
            ];
            for b in &possible_bins {
                if let Ok(canonical) = std::fs::canonicalize(b) {
                    if canonical.is_file() {
                        actual_cmd = canonical.to_string_lossy().to_string();
                        break;
                    }
                }
            }
        }

        // 注入常见环境 PATH，保障 macOS GUI 模式下能正常执行 cargo/openclaw/codex 等 CLI
        let current_path = std::env::var("PATH").unwrap_or_default();
        let extra_paths = format!("{}/.local/bin:{}/.cargo/bin:{}/.codex/plugins/.plugin-appserver:/opt/homebrew/bin:/usr/local/bin:{}", home, home, home, current_path);

        let parts: Vec<&str> = actual_cmd.split_whitespace().collect();
        if parts.is_empty() {
            anyhow::bail!("Command line cannot be empty");
        }
        let program = parts[0];
        let args = &parts[1..];

        // 统一将所有 Agent 底层进程的默认根工作目录收敛至用户级全局 ~/.shadow-crew，彻底脱离项目源码仓目录
        let shadow_crew_home = crate::db_manager::get_shadow_crew_home_dir();
        let shadow_crew_home_str = shadow_crew_home.to_string_lossy().to_string();
        let default_db = crate::db_manager::get_default_db_path();

        let mut cmd = Command::new(program);
        cmd.args(args)
            .current_dir(&shadow_crew_home)
            .env("PATH", &extra_paths)
            .env("SHADOW_CREW_HOME", &shadow_crew_home)
            .env("SHINOBI_HOME", &shadow_crew_home)
            .env("SHADOW_CREW_MEMORY_DB", &default_db)
            .env("SHINOBI_MEMORY_DB", &default_db)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);

        if let Some(ref mcp_path) = resolved_dev_mcp {
            cmd.env("SHADOW_CREW_DEV_MCP_PATH", mcp_path);
            cmd.env("SHINOBI_DEV_MCP_PATH", mcp_path);
        }

        // 检测是否为挂载了 .scpack 的便携式专家 Agent (Portable Expert Agent)
        let mut detected_expert_pack_id: Option<String> = None;
        let mut is_portable_expert = false;
        if let Some(ref vars) = env_vars {
            for item in vars {
                let (k, v) = item.clone().into_pair();
                let tk = k.trim();
                let tv = v.trim();
                if tk == "SHADOW_CREW_EXPERT_PACK_ID" && !tv.is_empty() {
                    detected_expert_pack_id = Some(tv.to_string());
                    is_portable_expert = true;
                } else if tk == "SHADOW_CREW_PORTABLE_EXPERT_AGENT" && (tv == "1" || tv.eq_ignore_ascii_case("true")) {
                    is_portable_expert = true;
                }
            }
        }

        // 注入用户配置的环境变量 (如 ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL 等)
        if let Some(ref vars) = env_vars {
            for item in vars {
                let (k, v) = item.clone().into_pair();
                let trimmed_k = k.trim();
                let trimmed_v = v.trim();
                if !trimmed_k.is_empty() && !trimmed_v.is_empty() {
                    // Fail-Closed 安全门禁: 便携式专家 Agent 严禁注入沙箱/权限绕过变量或原生配置覆盖变量
                    if is_portable_expert
                        && (trimmed_k == "CODEX_DANGEROUSLY_BYPASS_SANDBOX"
                            || trimmed_k == "CODEX_HOME"
                            || trimmed_k == "CLAUDE_DANGEROUSLY_BYPASS_PERMISSIONS"
                            || trimmed_k == "CLAUDE_CONFIG_DIR"
                            || trimmed_k == "ANTHROPIC_DANGEROUS_ALLOW_ALL")
                    {
                        log_acp_event(
                            agent_id,
                            "SECURITY_BLOCK",
                            &format!(
                                "Blocked unsafe env var `{}` on Portable Expert Agent",
                                trimmed_k
                            ),
                        );
                        continue;
                    }
                    cmd.env(trimmed_k, trimmed_v);
                    let display_val = if trimmed_k.to_uppercase().contains("KEY")
                        || trimmed_k.to_uppercase().contains("TOKEN")
                        || trimmed_k.to_uppercase().contains("SECRET")
                    {
                        "***"
                    } else {
                        trimmed_v
                    };
                    tracing::info!(
                        "[Agent {}] Injected ENV: {} = {}",
                        agent_id,
                        trimmed_k,
                        display_val
                    );
                    log_acp_event(
                        agent_id,
                        "ENV",
                        &format!("Injected: {} = {}", trimmed_k, display_val),
                    );
                }
            }
        }
        if is_portable_expert {
            cmd.env("SHADOW_CREW_PORTABLE_EXPERT_AGENT", "1");
            cmd.env_remove("CODEX_DANGEROUSLY_BYPASS_SANDBOX");
        }
        let mut child: Child = cmd.spawn().with_context(|| {
            format!(
                "Failed to spawn command '{}' (resolved from '{}')",
                actual_cmd, command_line
            )
        })?;

        let pid = child.id().unwrap_or(0);
        let stdin = child.stdin.take().expect("Failed to open stdin");
        let stdout = child.stdout.take().expect("Failed to open stdout");
        let stderr_opt = child.stderr.take();
        let child_arc = Arc::new(TokioMutex::new(Some(child)));

        log_acp_event(
            agent_id,
            "SPAWNED",
            &format!("Process spawned successfully with PID: {}", pid),
        );

        // 异步任务: 监听并排空 stderr 避免管道缓冲区阻塞，并落盘
        if let Some(stderr) = stderr_opt {
            let agent_id_err = agent_id.to_string();
            tokio::spawn(async move {
                let mut reader = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = reader.next_line().await {
                    log_acp_event(&agent_id_err, "STDERR", &line);
                    tracing::debug!("[Agent {} stderr] {}", agent_id_err, line);
                }
            });
        }

        let (stdin_tx, mut stdin_rx) = mpsc::channel::<String>(64);
        let pending_requests: Arc<TokioMutex<HashMap<u64, oneshot::Sender<serde_json::Value>>>> =
            Arc::new(TokioMutex::new(HashMap::new()));
        let active_chunks: Arc<TokioMutex<HashMap<u64, String>>> =
            Arc::new(TokioMutex::new(HashMap::new()));
        let session_active_req: Arc<TokioMutex<HashMap<String, u64>>> =
            Arc::new(TokioMutex::new(HashMap::new()));
        let loading_sessions: Arc<TokioMutex<HashSet<String>>> =
            Arc::new(TokioMutex::new(HashSet::new()));
        let is_alive = Arc::new(AtomicBool::new(true));
        let initialized = Arc::new(AtomicBool::new(false));
        let init_error = Arc::new(TokioMutex::new(None::<String>));
        let auth_state = Arc::new(TokioMutex::new("ok".to_string()));
        let status_detail = Arc::new(TokioMutex::new(None::<String>));
        let session_registry = Arc::new(TokioMutex::new(SessionRegistry::new()));
        let permission_scopes = Arc::new(TokioMutex::new(HashMap::<
            String,
            PermissionScopeContext,
        >::new()));
        let pending_permissions = Arc::new(TokioMutex::new(HashMap::<
            String,
            PendingAcpPermission,
        >::new()));
        let session_permission_grants = Arc::new(TokioMutex::new(HashSet::new()));
        let pending_permission_count = Arc::new(AtomicUsize::new(0));
        let supports_load_session = Arc::new(AtomicBool::new(false));
        let supports_resume_session = Arc::new(AtomicBool::new(false));
        let supports_prompt_image = Arc::new(AtomicBool::new(false));
        let supports_embedded_context = Arc::new(AtomicBool::new(false));
        let native_memory_capability =
            Arc::new(TokioMutex::new(AcpNativeMemoryCapability::default()));
        let replay_sinks = Arc::new(TokioMutex::new(HashMap::<
            String,
            Arc<TokioMutex<ReplaySinkState>>,
        >::new()));
        let now_millis = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        let last_activity = Arc::new(AtomicU64::new(now_millis));

        // 异步任务 1: 处理写往 Agent 的指令
        let agent_id_in = agent_id.to_string();
        let mut async_stdin = stdin;
        let last_activity_stdin = last_activity.clone();
        tokio::spawn(async move {
            while let Some(msg) = stdin_rx.recv().await {
                let current_ts = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as u64;
                last_activity_stdin.store(current_ts, Ordering::Relaxed);
                log_acp_event(&agent_id_in, "STDIN >>>", &msg);
                if let Err(e) = async_stdin.write_all(msg.as_bytes()).await {
                    log_acp_event(
                        &agent_id_in,
                        "STDIN_ERR",
                        &format!("Error writing to agent stdin: {}", e),
                    );
                    eprintln!("Error writing to agent stdin: {}", e);
                    break;
                }
                let _ = async_stdin.write_all(b"\n").await;
                let _ = async_stdin.flush().await;
            }
        });

        // 异步任务 2: 读取 Agent stdout 并通过 Tauri IPC emit 推送给 React 前端，并完成响应路由
        let agent_id_clone = agent_id.to_string();
        let app_handle_clone = app_handle.clone();
        let pending_requests_clone = pending_requests.clone();
        let active_chunks_clone = active_chunks.clone();
        let session_active_req_clone = session_active_req.clone();
        let loading_sessions_clone = loading_sessions.clone();
        let replay_sinks_clone = replay_sinks.clone();
        let is_alive_clone = is_alive.clone();
        let stdin_tx_reader = stdin_tx.clone();
        let last_activity_clone = last_activity.clone();
        let session_registry_permissions = session_registry.clone();
        let permission_scopes_clone = permission_scopes.clone();
        let pending_permissions_clone = pending_permissions.clone();
        let session_permission_grants_clone = session_permission_grants.clone();
        let pending_permission_count_clone = pending_permission_count.clone();
        let permission_db_manager = self.db_manager.clone();

        tokio::spawn(async move {
            let mut reader = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                let current_ts = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as u64;
                last_activity_clone.store(current_ts, Ordering::Relaxed);
                log_acp_event(&agent_id_clone, "STDOUT <<<", &line);

                // 1. 触发逐行流式事件: acp:stream:{agent_id}
                let event_name = format!("acp:stream:{}", agent_id_clone);
                let _ = app_handle_clone.emit(
                    &event_name,
                    serde_json::json!({
                        "agent_id": &agent_id_clone,
                        "line": &line
                    }),
                );

                // 2. 尝试解析为 JSON-RPC 回包并路由给等待的 oneshot channel
                if let Ok(mut json_val) = serde_json::from_str::<serde_json::Value>(&line) {
                    let _ = app_handle_clone.emit(
                        "acp:response",
                        serde_json::json!({
                            "agent_id": &agent_id_clone,
                            "data": &json_val
                        }),
                    );

                    // 判断是否为 ACP 通知或来自 Agent 端的主动请求 (带 method)
                    if let Some(method) = json_val.get("method").and_then(|m| m.as_str()) {
                        if method == "session/update" {
                            if let Some(params) = json_val.get("params") {
                                let sess_id = params
                                    .get("sessionId")
                                    .and_then(|s| s.as_str())
                                    .unwrap_or_default();

                                // 专用 Replay Sink 检查：若该会话正处于 session/load 恢复回放阶段，
                                // 将历史回放 chunk 导入专用 Replay Sink，与实时输出通道 (acp:chunk) 彻底隔离，杜绝污染当前前端 pending 卡片
                                let sink_opt = {
                                    let sinks = replay_sinks_clone.lock().await;
                                    sinks.get(sess_id).cloned()
                                };
                                if let Some(sink_arc) = sink_opt {
                                    if let Some(update) = params.get("update") {
                                        let mut sink = sink_arc.lock().await;
                                        let update_type = update
                                            .get("sessionUpdate")
                                            .and_then(|u| u.as_str())
                                            .unwrap_or_default();

                                        let explicit_msg_id = update
                                            .get("messageId")
                                            .or_else(|| update.get("id"))
                                            .or_else(|| params.get("messageId"))
                                            .and_then(|m| m.as_str())
                                            .map(|s| s.to_string());

                                        if update_type == "agent_message_chunk"
                                            || update_type == "user_message_chunk"
                                        {
                                            let chunk_role = if update_type == "user_message_chunk" {
                                                "user"
                                            } else {
                                                "assistant"
                                            };
                                            // 跨消息边界或跨角色切换时，自动 flush 前一条消息
                                            let should_flush = match (&sink.current_message_id, &explicit_msg_id) {
                                                (Some(curr_id), Some(new_id)) => curr_id != new_id,
                                                _ => sink
                                                    .current_role
                                                    .as_deref()
                                                    .map(|r| r != chunk_role)
                                                    .unwrap_or(false),
                                            };
                                            if should_flush {
                                                sink.flush_current_chunk();
                                            }
                                            if sink.current_message_id.is_none() {
                                                sink.current_message_id = explicit_msg_id;
                                            }
                                            sink.current_role = Some(chunk_role.to_string());
                                            if let Some(text) = extract_update_text(update) {
                                                sink.current_chunk_buffer.push_str(&text);
                                            }
                                        } else if update_type == "user_message"
                                            || update_type == "agent_message"
                                        {
                                            // 完整消息到来：先 flush 正在缓冲的 chunk 消息
                                            sink.flush_current_chunk();
                                            let text =
                                                extract_update_text(update).unwrap_or_default();
                                            let msg_id = explicit_msg_id.unwrap_or_else(|| {
                                                format!(
                                                    "msg-replay-{}-{}",
                                                    sess_id,
                                                    sink.messages.len()
                                                )
                                            });
                                            sink.messages.push(ReplayMessageItem {
                                                message_id: msg_id,
                                                role: if update_type == "user_message" {
                                                    "user".to_string()
                                                } else {
                                                    "assistant".to_string()
                                                },
                                                content: text,
                                                timestamp: std::time::SystemTime::now()
                                                    .duration_since(std::time::UNIX_EPOCH)
                                                    .unwrap_or_default()
                                                    .as_millis()
                                                    as u64,
                                            });
                                        }
                                    }
                                    continue;
                                }

                                let is_loading = {
                                    let loading = loading_sessions_clone.lock().await;
                                    loading.contains(sess_id)
                                };
                                if is_loading {
                                    continue;
                                }

                                let session_active = session_active_req_clone.lock().await;
                                let active_req_id = session_active.get(sess_id).cloned();
                                drop(session_active);

                                if let Some(update) = params.get("update") {
                                    let update_type = update
                                        .get("sessionUpdate")
                                        .and_then(|u| u.as_str())
                                        .unwrap_or_default();
                                    if update_type == "agent_message_chunk" {
                                        // 仅当当前会话有明确正在执行中的 session/prompt 请求时才路由 chunk
                                        if let Some(req_id) = active_req_id {
                                            // 智能提取文本内容，兼容 string / object / array 多种结构
                                            let text_opt = extract_update_text(update);

                                            if let Some(text) = text_opt {
                                                // 反查 session_key 供前端精确路由到所属房间，避免同一 Agent
                                                // 在其他会话的 pending 卡被跨会话来流污染。必须在锁 active_chunks
                                                // 之前完成，保持既有的锁获取顺序。
                                                let session_key = {
                                                    let registry =
                                                        session_registry_permissions.lock().await;
                                                    registry
                                                        .entries
                                                        .iter()
                                                        .find_map(|(key, entry)| {
                                                            (entry.session_id == sess_id)
                                                                .then(|| key.clone())
                                                        })
                                                };

                                                let mut chunks = active_chunks_clone.lock().await;
                                                chunks.entry(req_id).or_default().push_str(&text);

                                                // 触发前端细粒度 chunk 事件与全局通用 chunk 事件
                                                let chunk_event =
                                                    format!("acp:chunk:{}", agent_id_clone);
                                                let payload = serde_json::json!({
                                                    "agent_id": &agent_id_clone,
                                                    "sessionId": sess_id,
                                                    "session_key": session_key,
                                                    "chunk": text
                                                });
                                                let _ =
                                                    app_handle_clone.emit(&chunk_event, &payload);
                                                let _ =
                                                    app_handle_clone.emit("acp:chunk", &payload);
                                            }
                                        }
                                    }
                                }
                            }
                        } else if method == "session/request_permission" {
                            let Some(rpc_id) = json_val.get("id").cloned() else {
                                log_acp_event(
                                    &agent_id_clone,
                                    "PERM_INVALID",
                                    "session/request_permission without JSON-RPC id",
                                );
                                continue;
                            };
                            let Some(request_id) = jsonrpc_id_key(&rpc_id) else {
                                let _ = stdin_tx_reader
                                    .send(permission_cancelled_response(rpc_id).to_string())
                                    .await;
                                log_acp_event(
                                    &agent_id_clone,
                                    "PERM_INVALID",
                                    "session/request_permission with unsupported JSON-RPC id",
                                );
                                continue;
                            };
                            let params = json_val
                                .get("params")
                                .cloned()
                                .unwrap_or_else(|| serde_json::json!({}));
                            let session_id = params
                                .get("sessionId")
                                .and_then(|value| value.as_str())
                                .unwrap_or_default()
                                .to_string();
                            let has_active_prompt = {
                                let active = session_active_req_clone.lock().await;
                                active.contains_key(&session_id)
                            };
                            if !has_active_prompt {
                                let _ = stdin_tx_reader
                                    .send(permission_cancelled_response(rpc_id).to_string())
                                    .await;
                                log_acp_event(
                                    &agent_id_clone,
                                    "PERM_NO_ACTIVE_PROMPT",
                                    &format!(
                                        "Permission request {} cancelled because session '{}' has no active prompt",
                                        request_id, session_id
                                    ),
                                );
                                continue;
                            }

                            let session_key = {
                                let registry = session_registry_permissions.lock().await;
                                registry
                                    .entries
                                    .iter()
                                    .find_map(|(key, entry)| {
                                        (entry.session_id == session_id).then(|| key.clone())
                                    })
                            };
                            let scope = if let Some(ref session_key) = session_key {
                                permission_scopes_clone.lock().await.get(session_key).cloned()
                            } else {
                                None
                            };

                            let Some(scope) = scope else {
                                let _ = stdin_tx_reader
                                    .send(permission_cancelled_response(rpc_id).to_string())
                                    .await;
                                log_acp_event(
                                    &agent_id_clone,
                                    "PERM_SCOPE_MISSING",
                                    &format!(
                                        "No permission scope for ACP session '{}'; request {} cancelled",
                                        session_id, request_id
                                    ),
                                );
                                continue;
                            };

                            let permission_options = parse_permission_options(&params);
                            let view = build_permission_request_view(
                                &agent_id_clone,
                                request_id.clone(),
                                session_id.clone(),
                                scope.clone(),
                                &params,
                                permission_options.clone(),
                            );
                            let targets_sensitive_host_path = view
                                .paths
                                .iter()
                                .chain(view.outside_workspace_paths.iter())
                                .any(|p| {
                                    let low = p.to_lowercase();
                                    low.contains("/.codex")
                                        || low.contains("\\.codex")
                                        || low.contains("/.ssh")
                                        || low.contains("\\.ssh")
                                        || low.ends_with("/config.toml")
                                        || low.ends_with("/auth.json")
                                });
                            if targets_sensitive_host_path
                                || (is_portable_expert && !view.outside_workspace_paths.is_empty())
                            {
                                let _ = stdin_tx_reader
                                    .send(permission_cancelled_response(rpc_id).to_string())
                                    .await;
                                log_acp_event(
                                    &agent_id_clone,
                                    "PERM_SECURITY_BLOCKED",
                                    &format!(
                                        "Auto-denied permission request {} targeting protected host/outside-workspace path: {:?}",
                                        request_id, view.outside_workspace_paths
                                    ),
                                );
                                continue;
                            }
                            let grant_key = SessionPermissionGrantKey {
                                session_id: session_id.clone(),
                                grant: PermissionGrantKey {
                                    scope_type: scope.scope_type.clone(),
                                    scope_id: scope.scope_id.clone(),
                                    workspace_binding_id: scope.workspace_binding_id.clone(),
                                    capability: view.capability.clone(),
                                },
                            };
                            let session_granted = if view.outside_workspace_paths.is_empty() {
                                session_permission_grants_clone
                                    .lock()
                                    .await
                                    .contains(&grant_key)
                            } else {
                                false
                            };
                            let persisted_granted = if !session_granted
                                && view.outside_workspace_paths.is_empty()
                            {
                                permission_db_manager
                                    .as_ref()
                                    .and_then(|db| {
                                        db.has_acp_permission_grant(
                                            &agent_id_clone,
                                            &scope.scope_type,
                                            &scope.scope_id,
                                            &scope.workspace_binding_id,
                                            &view.capability,
                                        )
                                        .ok()
                                    })
                                    .unwrap_or(false)
                            } else {
                                false
                            };

                            if (session_granted || persisted_granted)
                                && view.supports_allow_once
                            {
                                if let Some(option_id) = select_permission_option(
                                    &permission_options,
                                    AcpPermissionDecision::AllowOnce,
                                ) {
                                    let response = permission_selected_response(
                                        rpc_id.clone(),
                                        &option_id,
                                    );
                                    let _ = stdin_tx_reader.send(response.to_string()).await;
                                    log_acp_event(
                                        &agent_id_clone,
                                        "PERM_LEASE_ALLOW",
                                        &format!(
                                            "request={} capability={} scope={}:{} source={}",
                                            request_id,
                                            view.capability,
                                            view.scope_type,
                                            view.scope_id,
                                            if session_granted { "session" } else { "persisted" }
                                        ),
                                    );
                                    continue;
                                }
                            }

                            let pending = PendingAcpPermission {
                                rpc_id: rpc_id.clone(),
                                view: view.clone(),
                                options: permission_options,
                            };
                            let inserted = {
                                let mut requests = pending_permissions_clone.lock().await;
                                requests.insert(request_id.clone(), pending).is_none()
                            };
                            if inserted {
                                pending_permission_count_clone.fetch_add(1, Ordering::SeqCst);
                            }
                            log_acp_event(
                                &agent_id_clone,
                                "PERM_REQUEST",
                                &format!(
                                    "request={} tool={} capability={} scope={}:{} paths={:?} outside={:?}",
                                    request_id,
                                    view.tool_name,
                                    view.capability,
                                    view.scope_type,
                                    view.scope_id,
                                    view.paths,
                                    view.outside_workspace_paths
                                ),
                            );
                            let _ = app_handle_clone.emit("acp:permission_request", &view);
                        } else if let Some(req_id) = json_val.get("id").cloned() {
                            // Agent 发起了其它未支持的客户端调用，按 JSON-RPC 2.0 规范返回 MethodNotFound 避免 Agent 挂起死等
                            log_acp_event(
                                &agent_id_clone,
                                "UNHANDLED_METHOD",
                                &format!("Agent sent unsupported method '{}' with id {:?}, responding with MethodNotFound", method, req_id),
                            );
                            let not_found_resp = serde_json::json!({
                                "jsonrpc": "2.0",
                                "id": req_id,
                                "error": {
                                    "code": -32601,
                                    "message": format!("Method '{}' is not supported by client", method)
                                }
                            });
                            let _ = stdin_tx_reader.send(not_found_resp.to_string()).await;
                        }

                        // 如果是通知或方法请求，不要作为对 client request 的响应消费
                        continue;
                    }

                    // 如果是带有 id 的响应，匹配并唤醒 oneshot channel
                    let matched_id = json_val.get("id").and_then(|v| {
                        v.as_u64()
                            .or_else(|| v.as_str().and_then(|s| s.parse::<u64>().ok()))
                    });

                    if let Some(id) = matched_id {
                        let mut map = pending_requests_clone.lock().await;
                        if let Some(tx) = map.remove(&id) {
                            // 如果此请求累积了流式 chunk 文本，回填进 result.text_response
                            let accumulated = active_chunks_clone
                                .lock()
                                .await
                                .remove(&id)
                                .unwrap_or_default();
                            if !accumulated.is_empty() {
                                if let Some(res_obj) =
                                    json_val.get_mut("result").and_then(|r| r.as_object_mut())
                                {
                                    let needs_fill = res_obj
                                        .get("text_response")
                                        .and_then(|t| t.as_str())
                                        .map(|s| s.is_empty())
                                        .unwrap_or(true);
                                    if needs_fill {
                                        res_obj.insert(
                                            "text_response".to_string(),
                                            serde_json::Value::String(accumulated),
                                        );
                                    }
                                }
                            }
                            let _ = tx.send(json_val);
                        }
                    }
                }
            }

            // 当 stdout 到达 EOF 时，标记子进程退出并通知所有挂起的请求
            is_alive_clone.store(false, Ordering::SeqCst);
            log_acp_event(&agent_id_clone, "EXIT", "Agent process stdout EOF reached");
            let _ = app_handle_clone.emit(
                "acp:status_change",
                serde_json::json!({
                    "agent_id": &agent_id_clone,
                    "status": "stopped"
                }),
            );
            let cancelled_permissions = {
                let mut requests = pending_permissions_clone.lock().await;
                requests.drain().map(|(_, request)| request.view).collect::<Vec<_>>()
            };
            pending_permission_count_clone.store(0, Ordering::SeqCst);
            for request in cancelled_permissions {
                let _ = app_handle_clone.emit(
                    "acp:permission_resolved",
                    serde_json::json!({
                        "agentId": &agent_id_clone,
                        "requestId": request.request_id,
                        "reason": "agent process exited",
                    }),
                );
            }
            let mut map = pending_requests_clone.lock().await;
            for (_, tx) in map.drain() {
                let _ = tx.send(serde_json::json!({
                    "status": "closed",
                    "error": "Agent process exited and closed stdout pipe"
                }));
            }
        });

        self.agents.insert(
            agent_id.to_string(),
            RunningAgent {
                agent_id: agent_id.to_string(),
                pid,
                child: child_arc,
                stdin_tx: stdin_tx.clone(),
                pending_requests: pending_requests.clone(),
                active_chunks,
                session_active_req,
                loading_sessions,
                replay_sinks: replay_sinks.clone(),
                is_alive: is_alive.clone(),
                initialized: initialized.clone(),
                init_error: init_error.clone(),
                auth_state: auth_state.clone(),
                status_detail: status_detail.clone(),
                session_registry,
                permission_scopes,
                pending_permissions,
                session_permission_grants,
                pending_permission_count,
                supports_load_session: supports_load_session.clone(),
                supports_resume_session: supports_resume_session.clone(),
                supports_prompt_image: supports_prompt_image.clone(),
                supports_embedded_context: supports_embedded_context.clone(),
                native_memory_capability: native_memory_capability.clone(),
                db_manager: self.db_manager.clone(),
                cwd: shadow_crew_home_str,
                app_handle: app_handle.clone(),
                last_activity: last_activity.clone(),
                expert_pack_id: detected_expert_pack_id,
                prompt_lock: Arc::new(TokioMutex::new(())),
            },
        );

        // 1. 立即发起 ACP initialize 握手 (超时 10 秒，兼容适配器冷启动探测)
        let init_id = next_init_request_id();
        let (init_tx, init_rx) = oneshot::channel();
        {
            let mut map = pending_requests.lock().await;
            map.insert(init_id, init_tx);
        }
        let init_req = serde_json::json!({
            "jsonrpc": "2.0",
            "id": init_id,
            "method": "initialize",
            "params": {
                "protocolVersion": 1,
                "clientInfo": {
                    "name": "shadow-crew",
                    "version": "0.1.0"
                },
                "clientCapabilities": acp_client_capabilities()
            }
        });
        let _ = stdin_tx.send(init_req.to_string()).await;

        let mut initial_status = "running".to_string();
        let mut initial_auth_state = "ok".to_string();
        let mut detail_msg: Option<String> = None;

        match tokio::time::timeout(Duration::from_millis(10000), init_rx).await {
            Ok(Ok(resp)) => {
                if let Some(err) = resp.get("error") {
                    // ACP initialize 返回 JSON-RPC error = Agent 明确拒绝握手，绝不可视为可用
                    let err_code = err.get("code").and_then(|c| c.as_i64()).unwrap_or(0);
                    let err_msg = err
                        .get("message")
                        .and_then(|m| m.as_str())
                        .unwrap_or("unknown error");
                    let detail =
                        format!("ACP initialize 握手被拒绝 (code {}): {}", err_code, err_msg);
                    tracing::error!("[Agent {}] {}", agent_id, detail);
                    log_acp_event(agent_id, "INIT_REJECTED", &detail);
                    initial_status = "error".to_string();
                    detail_msg = Some(detail.clone());
                    *init_error.lock().await = Some(detail);
                } else {
                    tracing::info!(
                        "[Agent {}] Immediate initialize succeeded: {:?}",
                        agent_id,
                        resp
                    );
                    log_acp_event(
                        agent_id,
                        "INIT_OK",
                        &format!(
                            "ACP initialize handshake confirmed: {:?}",
                            resp.get("result")
                        ),
                    );
                    initialized.store(true, Ordering::SeqCst);
                    if let Some(res) = resp.get("result") {
                        let supported = check_supports_load_session(res);
                        supports_load_session.store(supported, Ordering::SeqCst);
                        let supported_resume = check_supports_resume_session(res);
                        supports_resume_session.store(supported_resume, Ordering::SeqCst);
                        supports_prompt_image
                            .store(check_supports_prompt_image(res), Ordering::SeqCst);
                        supports_embedded_context
                            .store(check_supports_embedded_context(res), Ordering::SeqCst);
                        *native_memory_capability.lock().await =
                            check_native_memory_capability(res);
                        if supported {
                            tracing::info!("[Agent {}] Immediate init: Agent reports support for ACP session/load capability", agent_id);
                        }
                        if supported_resume {
                            tracing::info!("[Agent {}] Immediate init: Agent reports support for ACP session/resume capability", agent_id);
                        }
                    }
                }
            }
            Ok(Err(_)) => {
                let detail = "Agent 在 ACP initialize 期间关闭了连接".to_string();
                tracing::warn!("[Agent {}] Initialize channel closed immediately", agent_id);
                log_acp_event(agent_id, "INIT_FAILED", &detail);
                initial_status = "error".to_string();
                detail_msg = Some(detail.clone());
                *init_error.lock().await = Some(detail);
            }
            Err(_) => {
                pending_requests.lock().await.remove(&init_id);
                tracing::warn!("[Agent {}] Immediate initialize timed out after 10s, deferring to lazy initialize on first session/prompt", agent_id);
            }
        }

        // 2. 检查特定 Agent 的 API Key 凭证 (如 Claude Code 需要 ANTHROPIC_API_KEY)
        let is_claude = command_line.contains("claude") || agent_id.contains("claude");
        if is_claude {
            let has_key = env_vars
                .as_ref()
                .map(|vars| {
                    vars.iter().any(|item| {
                        let (k, v) = item.clone().into_pair();
                        k.trim() == "ANTHROPIC_API_KEY" && !v.trim().is_empty()
                    })
                })
                .unwrap_or(false)
                || std::env::var("ANTHROPIC_API_KEY")
                    .map(|k| !k.trim().is_empty())
                    .unwrap_or(false);

            if !has_key {
                initial_status = "auth_required".to_string();
                initial_auth_state = "auth_required".to_string();
                detail_msg = Some("缺少 ANTHROPIC_API_KEY，点击编辑配置".to_string());
                *auth_state.lock().await = "auth_required".to_string();
                *status_detail.lock().await = detail_msg.clone();
                log_acp_event(
                    agent_id,
                    "WARN",
                    "Missing ANTHROPIC_API_KEY for Claude Code ACP",
                );
            }
        }

        let _ = app_handle.emit(
            "acp:status_change",
            serde_json::json!({
                "agent_id": agent_id,
                "status": initial_status,
                "auth_state": initial_auth_state,
                "status_detail": detail_msg,
                "pid": pid
            }),
        );

        Ok(pid)
    }

    /// 发送 Prompt 请求并等待 Agent 返回 (符合标准 ACP 规范)
    #[allow(dead_code)]
    pub async fn send_session_prompt(
        &self,
        agent_id: &str,
        room_id: &str,
        channel_id: Option<&str>,
        workspace_binding_id: Option<&str>,
        workspace_cwd: Option<&str>,
        scope_type: Option<&str>,
        attachments: &[AcpPromptAttachment],
        prompt: &str,
        system_prompt: Option<&str>,
        discussion_mode: Option<&str>,
        native_memory_enabled: Option<bool>,
        native_memory_auto_generate: Option<bool>,
    ) -> Result<serde_json::Value> {
        let agent = self
            .get_agent(agent_id)
            .with_context(|| format!("Agent {} not running", agent_id))?;
        agent
            .send_session_prompt(
                agent_id,
                room_id,
                channel_id,
                workspace_binding_id,
                workspace_cwd,
                scope_type,
                attachments,
                prompt,
                system_prompt,
                discussion_mode,
                native_memory_enabled,
                native_memory_auto_generate,
            )
            .await
    }
}

impl RunningAgent {
    pub async fn respond_to_permission(
        &self,
        request_id: &str,
        decision: AcpPermissionDecision,
    ) -> Result<()> {
        let pending = {
            let requests = self.pending_permissions.lock().await;
            requests
                .get(request_id)
                .cloned()
                .ok_or_else(|| anyhow::anyhow!("Permission request {} is no longer pending", request_id))?
        };

        if decision.is_allow() && !pending.view.supports_allow_once {
            anyhow::bail!(
                "ACP endpoint did not provide an allow_once option; the request remains blocked"
            );
        }
        if matches!(
            decision,
            AcpPermissionDecision::AllowSession | AcpPermissionDecision::AllowScope
        ) && !pending.view.outside_workspace_paths.is_empty()
        {
            anyhow::bail!(
                "Cannot grant a reusable permission for paths outside the Workspace Binding"
            );
        }
        if matches!(
            decision,
            AcpPermissionDecision::AllowSession | AcpPermissionDecision::AllowScope
        ) && pending.view.capability == "other"
        {
            anyhow::bail!(
                "Unclassified ACP tools can only be allowed once because their risk boundary is unknown"
            );
        }

        let option_id = select_permission_option(&pending.options, decision);
        if decision.is_allow() && option_id.is_none() {
            anyhow::bail!("ACP endpoint did not provide an allow_once option");
        }

        {
            let mut requests = self.pending_permissions.lock().await;
            if requests.remove(request_id).is_none() {
                anyhow::bail!("Permission request {} was already resolved", request_id);
            }
        }

        if matches!(
            decision,
            AcpPermissionDecision::AllowSession | AcpPermissionDecision::AllowScope
        ) {
            let key = SessionPermissionGrantKey {
                session_id: pending.view.session_id.clone(),
                grant: PermissionGrantKey {
                    scope_type: pending.view.scope_type.clone(),
                    scope_id: pending.view.scope_id.clone(),
                    workspace_binding_id: pending.view.workspace_binding_id.clone(),
                    capability: pending.view.capability.clone(),
                },
            };
            if decision == AcpPermissionDecision::AllowSession {
                self.session_permission_grants.lock().await.insert(key);
            } else if let Some(ref db) = self.db_manager {
                let grant = crate::db_manager::AcpPermissionGrantRecord {
                    id: build_permission_grant_id(&self.agent_id, &PermissionScopeContext {
                        scope_type: pending.view.scope_type.clone(),
                        scope_id: pending.view.scope_id.clone(),
                        workspace_binding_id: pending.view.workspace_binding_id.clone(),
                        session_key: pending.view.session_key.clone(),
                        cwd: pending.view.cwd.clone(),
                    }, &pending.view.capability),
                    agent_id: self.agent_id.clone(),
                    scope_type: pending.view.scope_type.clone(),
                    scope_id: pending.view.scope_id.clone(),
                    workspace_binding_id: pending.view.workspace_binding_id.clone(),
                    capability: pending.view.capability.clone(),
                    created_at: std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis() as u64,
                };
                if let Err(err) = db.save_acp_permission_grant(&grant) {
                    self.pending_permissions
                        .lock()
                        .await
                        .insert(request_id.to_string(), pending.clone());
                    return Err(err).context("Failed to persist ACP permission grant");
                }
            }
        }

        self.pending_permission_count
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |count| {
                Some(count.saturating_sub(1))
            })
            .ok();

        let response = if let Some(option_id) = option_id {
            permission_selected_response(pending.rpc_id.clone(), &option_id)
        } else {
            permission_cancelled_response(pending.rpc_id.clone())
        };
        self.stdin_tx
            .send(response.to_string())
            .await
            .with_context(|| "Failed to write ACP permission response to agent stdin")?;
        log_acp_event(
            &self.agent_id,
            "PERM_RESOLVED",
            &format!(
                "request={} decision={:?} capability={} scope={}:{}",
                request_id,
                decision,
                pending.view.capability,
                pending.view.scope_type,
                pending.view.scope_id
            ),
        );
        let _ = self.app_handle.emit(
            "acp:permission_resolved",
            serde_json::json!({
                "agentId": &self.agent_id,
                "requestId": request_id,
            }),
        );
        Ok(())
    }

    async fn cancel_pending_permissions_for_session(
        &self,
        session_id: &str,
        reason: &str,
    ) {
        let cancelled = {
            let mut requests = self.pending_permissions.lock().await;
            let keys: Vec<String> = requests
                .iter()
                .filter(|(_, request)| request.view.session_id == session_id)
                .map(|(key, _)| key.clone())
                .collect();
            keys.into_iter()
                .filter_map(|key| requests.remove(&key))
                .collect::<Vec<_>>()
        };

        if cancelled.is_empty() {
            return;
        }
        self.pending_permission_count
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |count| {
                Some(count.saturating_sub(cancelled.len()))
            })
            .ok();
        for request in &cancelled {
            let _ = self
                .stdin_tx
                .send(permission_cancelled_response(request.rpc_id.clone()).to_string())
                .await;
            let _ = self.app_handle.emit(
                "acp:permission_resolved",
                serde_json::json!({
                    "agentId": &self.agent_id,
                    "requestId": &request.view.request_id,
                    "reason": reason,
                }),
            );
            log_acp_event(
                &self.agent_id,
                "PERM_CANCELLED",
                &format!(
                    "request={} session={} reason={}",
                    request.view.request_id, session_id, reason
                ),
            );
        }
    }

    async fn cancel_expired_permissions(&self, max_age: Duration) {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        let max_age_ms = max_age.as_millis() as u64;
        let expired = {
            let mut requests = self.pending_permissions.lock().await;
            let keys: Vec<String> = requests
                .iter()
                .filter(|(_, request)| now.saturating_sub(request.view.created_at) >= max_age_ms)
                .map(|(key, _)| key.clone())
                .collect();
            keys.into_iter()
                .filter_map(|key| requests.remove(&key))
                .collect::<Vec<_>>()
        };
        if expired.is_empty() {
            return;
        }
        self.pending_permission_count
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |count| {
                Some(count.saturating_sub(expired.len()))
            })
            .ok();
        for request in expired {
            let _ = self
                .stdin_tx
                .send(permission_cancelled_response(request.rpc_id.clone()).to_string())
                .await;
            let _ = self.app_handle.emit(
                "acp:permission_resolved",
                serde_json::json!({
                    "agentId": &self.agent_id,
                    "requestId": &request.view.request_id,
                    "reason": "permission request timed out",
                }),
            );
            log_acp_event(
                &self.agent_id,
                "PERM_TIMEOUT",
                &format!(
                    "request={} capability={} scope={}:{} timed out",
                    request.view.request_id,
                    request.view.capability,
                    request.view.scope_type,
                    request.view.scope_id
                ),
            );
        }
        self.last_activity.store(now, Ordering::Relaxed);
    }

    #[allow(dead_code)]
    pub async fn clear_sessions(&self, key_or_prefix: Option<&str>) {
        self.clear_sessions_with_generation(key_or_prefix, None)
            .await;
    }

    /// 清空当前 Agent 内部指定 key/前缀（或全部）的 session 缓存映射，
    /// 并在移除前向 Agent 进程发送 ACP `session/close` 标准请求释放底层沙箱与上下文内存。
    /// 若提供了 `clear_generation`：
    /// 1. 当 `clear_generation < self.latest_clear_generation` 时，判定为超时迟到的旧清理请求，直接丢弃；
    /// 2. 仅清理创建代际 `<= clear_generation` 的会话，绝不误删在该清理请求发起之后新建的会话。
    pub async fn clear_sessions_with_generation(
        &self,
        key_or_prefix: Option<&str>,
        clear_generation: Option<u64>,
    ) {
        let _guard = self.prompt_lock.lock().await;

        let removed_sessions = {
            let mut reg = self.session_registry.lock().await;
            reg.prune_with_generation(key_or_prefix, clear_generation)
        };
        let active_session_keys = {
            let reg = self.session_registry.lock().await;
            reg.entries.keys().cloned().collect::<HashSet<_>>()
        };
        self.permission_scopes
            .lock()
            .await
            .retain(|session_key, _| active_session_keys.contains(session_key));
        self.session_permission_grants
            .lock()
            .await
            .retain(|grant| !removed_sessions.contains(&grant.session_id));

        // 同步清理 SQLite 持久化表，并携带 clear_generation 保护，杜绝误删清理发起之后新建的会话记录
        if let Some(ref db) = self.db_manager {
            let _ = db.delete_acp_session(Some(&self.agent_id), key_or_prefix, clear_generation);
        }

        // 异步向底层 ACP 进程发送 session/close，使 Agent 进程释放底层会话资源
        for sid in &removed_sessions {
            self.cancel_pending_permissions_for_session(
                sid,
                "ACP session was cleared before permission was resolved",
            )
            .await;
            let close_req = serde_json::json!({
                "jsonrpc": "2.0",
                "method": "session/close",
                "params": {
                    "sessionId": sid
                }
            });
            let _ = self.stdin_tx.send(close_req.to_string()).await;
        }
    }
}

/// 规范化用于 ACP 会话人设比对的系统提示词：
/// 团队协同公约花名册 (Crew Roster) 会在冷启动第 1 轮动态挂载，
/// 从第 2 轮起变为 warm-session 则遵循 Buzz 规范不再重复挂载花名册。
/// 此处在比对前剥离动态花名册与协同公约块，确保真实 warm-session 不会被误判为人设变更而导致意外重建与上下文丢失。
fn normalize_system_prompt_for_sync(prompt: &str) -> String {
    let mut clean = prompt.to_string();
    if let Some(start) = clean.find("[🛡️ Shadow Crew 平台智能体协同公约") {
        if let Some(end) = clean[start..].find("[当前") {
            clean = format!(
                "{}\n\n{}",
                clean[..start].trim_end(),
                clean[start + end..].trim_start()
            );
        } else {
            clean = clean[..start].trim_end().to_string();
        }
    } else if let Some(start) = clean.find("[👥 可用协同团队成员列表]:") {
        if let Some(end) = clean[start..].find("[当前") {
            clean = format!(
                "{}\n\n{}",
                clean[..start].trim_end(),
                clean[start + end..].trim_start()
            );
        } else {
            clean = clean[..start].trim_end().to_string();
        }
    }
    clean.trim().to_string()
}

struct ResolvedSessionWorkspace {
    cwd: PathBuf,
    artifact_root: PathBuf,
    workspace_binding_id: String,
    session_key_suffix: String,
}

fn build_scoped_session_key(
    agent_id: &str,
    room_id: &str,
    channel_id: Option<&str>,
    discussion_mode: Option<&str>,
    scope_type: Option<&str>,
    workspace_binding_suffix: &str,
    is_dm: bool,
) -> String {
    if is_dm {
        return format!("dm:{}:{}", agent_id, room_id);
    }
    if scope_type.map(|scope| scope.trim() == "dm_topic").unwrap_or(false) {
        let mode = discussion_mode.unwrap_or("standard").trim();
        let effective_mode = if mode.is_empty() { "standard" } else { mode };
        return format!(
            "dmtopic:{}:{}:{}{}",
            agent_id,
            room_id,
            effective_mode,
            workspace_binding_suffix
        );
    }
    let effective_channel_id = channel_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(room_id);
    let is_topic = scope_type
        .map(|scope| scope.trim() == "topic" || scope.trim() == "dm_topic")
        .unwrap_or_else(|| room_id != effective_channel_id && !room_id.starts_with("chan-"));
    if is_topic {
        let mode = discussion_mode.unwrap_or("standard").trim();
        let effective_mode = if mode.is_empty() { "standard" } else { mode };
        format!(
            "topic:{}:{}:{}{}",
            effective_channel_id,
            room_id,
            effective_mode,
            workspace_binding_suffix
        )
    } else {
        format!(
            "channel:{}:{}{}",
            effective_channel_id,
            room_id,
            workspace_binding_suffix
        )
    }
}

fn is_dm_session_scope(
    scope_type: Option<&str>,
    room_id: &str,
    channel_id: Option<&str>,
) -> bool {
    if let Some(scope) = scope_type.map(str::trim) {
        match scope {
            "dm" => return true,
            "dm_topic" | "topic" | "channel" => return false,
            _ => {}
        }
    }

    channel_id
        .map(|c| c.trim().is_empty() || c == "direct-messages" || c.starts_with("dm-"))
        .unwrap_or(true)
        || room_id.starts_with("dm-")
        || room_id.starts_with("thread-dm-")
}

fn resolve_session_workspace(
    db_manager: Option<&Arc<crate::db_manager::DatabaseManager>>,
    agent_id: &str,
    room_id: &str,
    channel_id: Option<&str>,
    workspace_binding_id: Option<&str>,
    requested_cwd: Option<&str>,
    scope_type: Option<&str>,
    is_dm: bool,
) -> Result<ResolvedSessionWorkspace> {
    if is_dm {
        let cwd = crate::db_manager::get_agent_dir(agent_id);
        let artifact_root = cwd.join("artifacts");
        let _ = std::fs::create_dir_all(&artifact_root);
        return Ok(ResolvedSessionWorkspace {
            cwd,
            artifact_root,
            workspace_binding_id: String::new(),
            session_key_suffix: String::new(),
        });
    }

    let effective_channel_id = channel_id
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .unwrap_or(room_id);
    let is_topic = scope_type
        .map(|scope| {
            let scope = scope.trim();
            scope == "topic" || scope == "dm_topic"
        })
        .unwrap_or_else(|| room_id != effective_channel_id && !room_id.starts_with("chan-"));
    let expected_owner_type = if is_topic { "topic" } else { "channel" };
    let expected_owner_id = if is_topic { room_id } else { effective_channel_id };

    let binding = workspace_binding_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|binding_id| {
            let db = db_manager.ok_or_else(|| anyhow::anyhow!(
                "Workspace Binding {} cannot be resolved without database access",
                binding_id
            ))?;
            let binding = db
                .get_workspace_binding(binding_id)?
                .ok_or_else(|| anyhow::anyhow!("Workspace Binding {} does not exist", binding_id))?;
            let owner_type = binding.get("ownerType").and_then(|value| value.as_str()).unwrap_or("");
            let owner_id = binding.get("ownerId").and_then(|value| value.as_str()).unwrap_or("");
            if owner_type != expected_owner_type || owner_id != expected_owner_id {
                anyhow::bail!(
                    "Workspace Binding {} scope mismatch: expected {}:{}, got {}:{}",
                    binding_id,
                    expected_owner_type,
                    expected_owner_id,
                    owner_type,
                    owner_id
                );
            }
            Ok::<serde_json::Value, anyhow::Error>(binding)
        })
        .transpose()?;

    if is_topic && binding.is_none() {
        anyhow::bail!(
            "Topic {} requires a persisted Workspace Binding before creating an ACP session",
            room_id
        );
    }

    let fallback_channel_dir = crate::db_manager::get_channel_dir(effective_channel_id);
    let raw_cwd = binding
        .as_ref()
        .and_then(|value| value.get("cwd"))
        .and_then(|value| value.as_str())
        .or(requested_cwd)
        .map(str::to_string)
        .unwrap_or_else(|| fallback_channel_dir.to_string_lossy().to_string());
    let create_missing = binding
        .as_ref()
        .and_then(|value| value.get("mode"))
        .and_then(|value| value.as_str())
        .map(|mode| mode == "default")
        .unwrap_or(true);
    let cwd_text = crate::db_manager::resolve_workspace_cwd_input(&raw_cwd, create_missing)?;
    let cwd = PathBuf::from(cwd_text);
    let artifact_root_raw = binding
        .as_ref()
        .and_then(|value| value.get("artifactRoot"))
        .and_then(|value| value.as_str())
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| cwd.join("artifacts").to_string_lossy().to_string());
    let artifact_root = PathBuf::from(
        crate::db_manager::resolve_workspace_cwd_input(&artifact_root_raw, true)?,
    );

    let resolved_binding_id = binding
        .as_ref()
        .and_then(|value| value.get("id"))
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .to_string();
    let session_key_suffix = if resolved_binding_id.is_empty() {
        String::new()
    } else {
        format!(":ws-{}", resolved_binding_id)
    };

    Ok(ResolvedSessionWorkspace {
        cwd,
        artifact_root,
        workspace_binding_id: resolved_binding_id,
        session_key_suffix,
    })
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn execute_lazy_initialize_handshake<F>(
    agent_id: &str,
    timeout_duration: Duration,
    initialized: &AtomicBool,
    pending_requests: &TokioMutex<HashMap<u64, oneshot::Sender<serde_json::Value>>>,
    stdin_tx: &mpsc::Sender<String>,
    init_error: &TokioMutex<Option<String>>,
    status_detail: &TokioMutex<Option<String>>,
    supports_load_session: &AtomicBool,
    supports_resume_session: &AtomicBool,
    supports_prompt_image: &AtomicBool,
    supports_embedded_context: &AtomicBool,
    native_memory_capability: &TokioMutex<AcpNativeMemoryCapability>,
    mut on_status_change: F,
) -> Result<()>
where
    F: FnMut(&str, serde_json::Value),
{
    if initialized.load(Ordering::SeqCst) {
        return Ok(());
    }

    let init_id = next_init_request_id();
    let (init_tx, init_rx) = oneshot::channel();
    {
        let mut map = pending_requests.lock().await;
        map.insert(init_id, init_tx);
    }
    let init_req = serde_json::json!({
        "jsonrpc": "2.0",
        "id": init_id,
        "method": "initialize",
        "params": {
            "protocolVersion": 1,
            "clientInfo": {
                "name": "shadow-crew",
                "version": "0.1.0"
            },
            "clientCapabilities": acp_client_capabilities()
        }
    });
    let _ = stdin_tx.send(init_req.to_string()).await;
    match tokio::time::timeout(timeout_duration, init_rx).await {
        Ok(Ok(resp)) => {
            if let Some(err) = resp.get("error") {
                let err_msg = err
                    .get("message")
                    .and_then(|m| m.as_str())
                    .unwrap_or("unknown error");
                let detail = format!("ACP initialize 握手被拒绝: {}", err_msg);
                tracing::error!("[Agent {}] lazy {}", agent_id, detail);
                log_acp_event(agent_id, "INIT_REJECTED", &detail);
                *init_error.lock().await = Some(detail.clone());
                *status_detail.lock().await = Some(detail.clone());
                on_status_change("error", serde_json::Value::String(detail));
                anyhow::bail!("ACP initialize rejected: {}", err_msg);
            } else {
                tracing::info!("[Agent {}] initialize succeeded: {:?}", agent_id, resp);
                initialized.store(true, Ordering::SeqCst);
                if let Some(res) = resp.get("result") {
                    let supported = check_supports_load_session(res);
                    supports_load_session.store(supported, Ordering::SeqCst);
                    let supported_resume = check_supports_resume_session(res);
                    supports_resume_session.store(supported_resume, Ordering::SeqCst);
                    supports_prompt_image
                        .store(check_supports_prompt_image(res), Ordering::SeqCst);
                    supports_embedded_context
                        .store(check_supports_embedded_context(res), Ordering::SeqCst);
                    *native_memory_capability.lock().await =
                        check_native_memory_capability(res);
                    if supported {
                        tracing::info!("[Agent {}] Lazy init: Agent reports support for ACP session/load capability", agent_id);
                    }
                    if supported_resume {
                        tracing::info!("[Agent {}] Lazy init: Agent reports support for ACP session/resume capability", agent_id);
                    }
                }
                if init_error.lock().await.take().is_some() {
                    *status_detail.lock().await = None;
                    on_status_change("running", serde_json::Value::Null);
                }
                Ok(())
            }
        }
        Ok(Err(_)) => {
            pending_requests.lock().await.remove(&init_id);
            tracing::warn!(
                "[Agent {}] initialize response channel closed; keeping initialization retryable",
                agent_id
            );
            anyhow::bail!("ACP initialize response channel closed for agent {}", agent_id);
        }
        Err(_) => {
            pending_requests.lock().await.remove(&init_id);
            tracing::warn!(
                "[Agent {}] lazy initialize timed out after {:?}; keeping initialization retryable",
                agent_id,
                timeout_duration
            );
            anyhow::bail!(
                "ACP initialize timed out after {:?} for agent {}",
                timeout_duration,
                agent_id
            );
        }
    }
}

impl RunningAgent {
    /// 预检并确保指定 Agent 在当前会话下拥有已建立或已恢复的 ACP sessionId (加锁保护)
    pub async fn ensure_session(
        &self,
        agent_id: &str,
        room_id: &str,
        channel_id: Option<&str>,
        workspace_binding_id: Option<&str>,
        workspace_cwd: Option<&str>,
        scope_type: Option<&str>,
        system_prompt: Option<&str>,
        discussion_mode: Option<&str>,
        local_history_intact: Option<bool>,
    ) -> Result<EnsureSessionResult> {
        let _prompt_guard = self.prompt_lock.lock().await;
        self.ensure_session_locked(
            agent_id,
            room_id,
            channel_id,
            workspace_binding_id,
            workspace_cwd,
            scope_type,
            system_prompt,
            discussion_mode,
            local_history_intact,
        )
        .await
    }

    /// 内部已加锁的核心逻辑：确保当前会话绑定了有效的 ACP sessionId (基于本地历史完整度的动态选择)
    pub(crate) async fn ensure_session_locked(
        &self,
        agent_id: &str,
        room_id: &str,
        channel_id: Option<&str>,
        workspace_binding_id: Option<&str>,
        workspace_cwd: Option<&str>,
        scope_type: Option<&str>,
        system_prompt: Option<&str>,
        discussion_mode: Option<&str>,
        local_history_intact: Option<bool>,
    ) -> Result<EnsureSessionResult> {
        if !self.is_alive.load(Ordering::SeqCst) {
            anyhow::bail!("Agent {} process is dead or closed", agent_id);
        }

        // 1. 确保已完成 ACP initialize 握手
        if !self.initialized.load(Ordering::SeqCst) {
            let app_handle = self.app_handle.clone();
            execute_lazy_initialize_handshake(
                agent_id,
                Duration::from_secs(10),
                &self.initialized,
                &self.pending_requests,
                &self.stdin_tx,
                &self.init_error,
                &self.status_detail,
                &self.supports_load_session,
                &self.supports_resume_session,
                &self.supports_prompt_image,
                &self.supports_embedded_context,
                &self.native_memory_capability,
                |status, detail| {
                    let _ = app_handle.emit(
                        "acp:status_change",
                        serde_json::json!({
                            "agent_id": agent_id,
                            "status": status,
                            "status_detail": detail,
                        }),
                    );
                },
            )
            .await?;
        }

        // 2. 区分当前交互场景：是当前 Agent 的 1-on-1 私聊，还是多 Agent 频道研讨
        let is_dm = is_dm_session_scope(scope_type, room_id, channel_id);
        let is_dm_topic = scope_type
            .map(|scope| scope.trim() == "dm_topic")
            .unwrap_or(false);

        let resolved_workspace = resolve_session_workspace(
            self.db_manager.as_ref(),
            agent_id,
            room_id,
            channel_id,
            workspace_binding_id,
            workspace_cwd,
            scope_type,
            is_dm,
        )?;
        let target_workspace_dir = resolved_workspace.cwd.clone();
        let session_key = build_scoped_session_key(
            agent_id,
            room_id,
            channel_id,
            discussion_mode,
            scope_type,
            &resolved_workspace.session_key_suffix,
            is_dm,
        );
        let effective_permission_channel_id = channel_id
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(room_id);
        let permission_scope_type = if is_dm {
            "dm"
        } else if is_dm_topic {
            "dm_topic"
        } else if scope_type
            .map(|scope| scope.trim() == "topic")
            .unwrap_or_else(|| {
                room_id != effective_permission_channel_id && !room_id.starts_with("chan-")
            })
        {
            "topic"
        } else {
            "channel"
        };
        let permission_scope_id = if permission_scope_type == "channel" {
            effective_permission_channel_id
        } else {
            room_id
        };
        self.permission_scopes.lock().await.insert(
            session_key.clone(),
            PermissionScopeContext {
                scope_type: permission_scope_type.to_string(),
                scope_id: permission_scope_id.to_string(),
                workspace_binding_id: resolved_workspace.workspace_binding_id.clone(),
                session_key: session_key.clone(),
                cwd: target_workspace_dir.to_string_lossy().to_string(),
            },
        );
        let workspace_notice = if is_dm {
            let agent_cwd = target_workspace_dir.to_string_lossy().to_string();
            format!(
                "\n\n[当前 Agent 个人专属独立工作空间环境]:\n- Agent ID: {}\n- Agent 独立工作区根目录 (Working Directory / cwd): {}\n- 专属落地产物目录 (Artifacts): {}/artifacts\n- 专属临时调试目录 (Scratch): {}/scratch\n提示: 您当前处于与用户的 1-on-1 私聊中，沉淀的技术推演文档、方案或代码 Patch 将安全保存至您个人的专属产物目录中，与频道(channels)业务及其他 Agent 物理隔离。",
                agent_id, agent_cwd, agent_cwd, agent_cwd
            )
        } else if is_dm_topic {
            let target_cwd = target_workspace_dir.to_string_lossy().to_string();
            format!(
                "\n\n[当前私聊议题专属工作空间环境]:\n- Agent ID: {}\n- 私聊议题 ID: {}\n- Workspace Binding: {}\n- 议题工作区根目录 (cwd): {}\n- 落地产物目录 (Artifacts): {}\n提示: 当前私聊 Topic 使用独立 ACP Session 与 cwd，不得混用私聊主会话或其他 Topic 的工作目录。",
                agent_id,
                room_id,
                resolved_workspace.workspace_binding_id,
                target_cwd,
                resolved_workspace.artifact_root.display()
            )
        } else {
            let effective_chan_id = channel_id
                .map(|c| c.trim())
                .filter(|c| !c.is_empty())
                .unwrap_or(room_id);
            let target_cwd = target_workspace_dir.to_string_lossy().to_string();
            let is_topic = scope_type
                .map(|scope| scope.trim() == "topic")
                .unwrap_or_else(|| room_id != effective_chan_id && !room_id.starts_with("chan-"));
            if is_topic {
                format!(
                    "\n\n[当前议题专属工作空间环境]:\n- 频道 ID: {}\n- 议题 ID: {}\n- Workspace Binding: {}\n- 议题工作区根目录 (cwd): {}\n- 落地产物目录 (Artifacts): {}\n提示: 当前 Topic 与其他 Topic 使用独立 cwd。所有文件操作必须限定在议题工作区内。",
                    effective_chan_id,
                    room_id,
                    resolved_workspace.workspace_binding_id,
                    target_cwd,
                    resolved_workspace.artifact_root.display()
                )
            } else {
                format!(
                    "\n\n[当前频道专属工作空间环境]:\n- 频道 ID: {}\n- Workspace Binding: {}\n- 频道独立工作区根目录 (Working Directory / cwd): {}\n- 落地产物目录 (Artifacts): {}",
                    effective_chan_id,
                    resolved_workspace.workspace_binding_id,
                    target_cwd,
                    resolved_workspace.artifact_root.display()
                )
            }
        };
        let workspace_cwd = target_workspace_dir.to_string_lossy().to_string();
        let enriched_sp = match system_prompt {
            Some(sp) if !sp.trim().is_empty() => format!("{}{}", sp, workspace_notice),
            _ => workspace_notice,
        };

        let normalized_sp = normalize_system_prompt_for_sync(&enriched_sp);
        let cached_sid = {
            let reg = self.session_registry.lock().await;
            if let Some(entry) = reg.get(&session_key) {
                if entry.system_prompt == normalized_sp {
                    Some(entry.session_id.clone())
                } else {
                    tracing::info!(
                        "[Agent {}] Persona/environment prompt changed for session_key {}. Refreshing session to sync updated persona/mode.",
                        agent_id, session_key
                    );
                    None
                }
            } else {
                None
            }
        };

        if let Some(sid) = cached_sid {
            return Ok(EnsureSessionResult {
                session_id: sid,
                is_new: false,
                load_failed: false,
                recovery_mode: None,
            });
        }

        // Layer 1 (协议级恢复优先): 若内存中未命中 session_id，检查 SQLite 持久化记录
        let persisted_opt = if let Some(ref db) = self.db_manager {
            db.get_acp_session(agent_id, &session_key).ok().flatten()
        } else {
            None
        };

        let mut load_failed = false;

        if let Some(persisted) = persisted_opt {
            let persona_matched = persisted.system_prompt == normalized_sp;
            let cwd_matched = persisted.workspace_cwd == workspace_cwd;
            let binding_matched =
                persisted.workspace_binding_id == resolved_workspace.workspace_binding_id;
            let metadata_matched = persona_matched && cwd_matched && binding_matched;
            let supports_resume = self.supports_resume_session.load(Ordering::SeqCst);
            let supports_load = self.supports_load_session.load(Ordering::SeqCst);
            let history_intact = local_history_intact.unwrap_or(true);

            if metadata_matched {
                // 动态选择分支 1: 本地历史完整且元数据对齐 -> 优先选择 session/resume (无需重放历史流)
                if history_intact && supports_resume {
                    tracing::info!(
                        "[Agent {}] Local history intact & metadata aligned. Attempting session/resume for session {}...",
                        agent_id, persisted.session_id
                    );
                    let resume_id = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis() as u64;
                    let (resume_tx, resume_rx) = oneshot::channel();
                    {
                        let mut map = self.pending_requests.lock().await;
                        map.insert(resume_id, resume_tx);
                    }

                    let resume_params = serde_json::json!({
                        "sessionId": &persisted.session_id,
                        "cwd": &workspace_cwd,
                        "workspaceRoot": &workspace_cwd,
                        "workspaceBindingId": &resolved_workspace.workspace_binding_id,
                        "artifactRoot": resolved_workspace.artifact_root.to_string_lossy(),
                        "mcpServers": [],
                    });
                    let resume_req = serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": resume_id,
                        "method": "session/resume",
                        "params": resume_params
                    });
                    let _ = self.stdin_tx.send(resume_req.to_string()).await;

                    let resume_res = tokio::time::timeout(Duration::from_secs(15), resume_rx).await;
                    match resume_res {
                        Ok(Ok(resp)) if resp.get("error").is_none() => {
                            tracing::info!(
                                "[Agent {}] Layer 1 recovery SUCCEEDED: resumed session {} via session/resume",
                                agent_id, persisted.session_id
                            );
                            log_acp_event(
                                agent_id,
                                "SESSION_RESUMED",
                                &format!(
                                    "Resumed session {} via session/resume",
                                    persisted.session_id
                                ),
                            );
                            let restored_gen = {
                                let mut reg = self.session_registry.lock().await;
                                reg.insert(
                                    session_key.clone(),
                                    persisted.session_id.clone(),
                                    normalized_sp.clone(),
                                )
                            };
                            if let Some(ref db) = self.db_manager {
                                let _ = db.save_acp_session(
                                    agent_id,
                                    &session_key,
                                    &persisted.session_id,
                                    &resolved_workspace.workspace_binding_id,
                                    &workspace_cwd,
                                    &normalized_sp,
                                    restored_gen,
                                );
                            }
                            return Ok(EnsureSessionResult {
                                session_id: persisted.session_id,
                                is_new: false,
                                load_failed: false,
                                recovery_mode: Some("resume".to_string()),
                            });
                        }
                        res => {
                            self.pending_requests.lock().await.remove(&resume_id);
                            tracing::warn!(
                                "[Agent {}] Layer 1 session/resume failed or timed out for session {:?} (res: {:?}). Checking load or new...",
                                agent_id, persisted.session_id, res
                            );
                        }
                    }
                }

                // 动态选择分支 2: 本地历史缺失、损坏或需要重建 (或 Agent 不支持 resume 但支持 loadSession / resume 失败)
                // -> 选择 session/load 并挂载专用 Replay Sink 收集回放历史
                if supports_load {
                    tracing::info!(
                        "[Agent {}] Attempting Layer 1 session/load recovery with dedicated Replay Sink for session {}...",
                        agent_id, persisted.session_id
                    );
                    let load_id = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis() as u64;
                    let (load_tx, load_rx) = oneshot::channel();
                    {
                        let mut map = self.pending_requests.lock().await;
                        map.insert(load_id, load_tx);
                    }

                    // 挂载专用 Replay Sink 并标记 session 处于加载阶段
                    let sink_state = Arc::new(TokioMutex::new(ReplaySinkState::new(
                        persisted.session_id.clone(),
                        session_key.clone(),
                        agent_id.to_string(),
                        room_id.to_string(),
                    )));
                    {
                        let mut sinks = self.replay_sinks.lock().await;
                        sinks.insert(persisted.session_id.clone(), sink_state.clone());
                    }
                    {
                        let mut loading = self.loading_sessions.lock().await;
                        loading.insert(persisted.session_id.clone());
                    }

                    let mut load_params = serde_json::json!({
                        "sessionId": &persisted.session_id,
                        "sessionKey": &session_key,
                        "cwd": &workspace_cwd,
                        "workspaceRoot": &workspace_cwd,
                        "workspaceBindingId": &resolved_workspace.workspace_binding_id,
                        "artifactRoot": resolved_workspace.artifact_root.to_string_lossy(),
                        "mcpServers": [],
                    });
                    if is_dm {
                        load_params["agentId"] = serde_json::Value::String(agent_id.to_string());
                    } else if let Some(c) = channel_id {
                        load_params["channelId"] = serde_json::Value::String(c.to_string());
                    }
                    load_params["systemPrompt"] = serde_json::Value::String(enriched_sp.clone());

                    let load_req = serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": load_id,
                        "method": "session/load",
                        "params": load_params
                    });
                    let _ = self.stdin_tx.send(load_req.to_string()).await;

                    let load_res = tokio::time::timeout(Duration::from_secs(30), load_rx).await;

                    // 无论成功还是失败，均从 loading_sessions 与 replay_sinks 移除
                    {
                        let mut loading = self.loading_sessions.lock().await;
                        loading.remove(&persisted.session_id);
                    }
                    let replayed_msgs = {
                        let mut sinks = self.replay_sinks.lock().await;
                        if let Some(sink_arc) = sinks.remove(&persisted.session_id) {
                            let mut sink = sink_arc.lock().await;
                            sink.flush_current_chunk();
                            std::mem::take(&mut sink.messages)
                        } else {
                            Vec::new()
                        }
                    };

                    match load_res {
                        Ok(Ok(resp)) if resp.get("error").is_none() => {
                            tracing::info!(
                                "[Agent {}] Layer 1 session/load SUCCEEDED: restored session {} (replayed {} items)",
                                agent_id, persisted.session_id, replayed_msgs.len()
                            );
                            if !replayed_msgs.is_empty() {
                                let payload = serde_json::json!({
                                    "agent_id": agent_id,
                                    "sessionId": &persisted.session_id,
                                    "session_key": &session_key,
                                    "room_id": room_id,
                                    "messages": replayed_msgs,
                                });
                                let _ = self.app_handle.emit("acp:replay_sink", &payload);
                            }

                            log_acp_event(
                                agent_id,
                                "SESSION_RESTORED",
                                &format!(
                                    "Restored session {} via session/load",
                                    persisted.session_id
                                ),
                            );
                            let restored_gen = {
                                let mut reg = self.session_registry.lock().await;
                                reg.insert(
                                    session_key.clone(),
                                    persisted.session_id.clone(),
                                    normalized_sp.clone(),
                                )
                            };
                            if let Some(ref db) = self.db_manager {
                                let _ = db.save_acp_session(
                                    agent_id,
                                    &session_key,
                                    &persisted.session_id,
                                    &resolved_workspace.workspace_binding_id,
                                    &workspace_cwd,
                                    &normalized_sp,
                                    restored_gen,
                                );
                            }
                            return Ok(EnsureSessionResult {
                                session_id: persisted.session_id,
                                is_new: false,
                                load_failed: false,
                                recovery_mode: Some("load".to_string()),
                            });
                        }
                        res => {
                            self.pending_requests.lock().await.remove(&load_id);
                            load_failed = true;
                            tracing::warn!(
                                "[Agent {}] Layer 1 session/load failed or timed out for session {:?} (res: {:?}). Falling back to Layer 2 (session/new)...",
                                agent_id, persisted.session_id, res
                            );
                            if let Some(ref db) = self.db_manager {
                                let _ =
                                    db.delete_acp_session(Some(agent_id), Some(&session_key), None);
                            }
                        }
                    }
                }
            } else if !persona_matched || !cwd_matched || !binding_matched {
                tracing::info!(
                    "[Agent {}] Persisted session {} invalidated due to persona/cwd change. Purging stale record.",
                    agent_id, persisted.session_id
                );
                if let Some(ref db) = self.db_manager {
                    let _ = db.delete_acp_session(Some(agent_id), Some(&session_key), None);
                }
            }
        }

        // Layer 2 (平台层增量兜底): 若无法原地恢复，则发起 session/new 建立新会话并持久化
        let old_sid = {
            let mut reg = self.session_registry.lock().await;
            reg.remove(&session_key).map(|e| e.session_id)
        };
        if let Some(old_id) = old_sid {
            self.cancel_pending_permissions_for_session(
                &old_id,
                "ACP session was replaced before permission was resolved",
            )
            .await;
            self.session_permission_grants
                .lock()
                .await
                .retain(|grant| grant.session_id != old_id);
            let close_req = serde_json::json!({
                "jsonrpc": "2.0",
                "method": "session/close",
                "params": {
                    "sessionId": old_id
                }
            });
            let _ = self.stdin_tx.send(close_req.to_string()).await;
        }

        let new_sess_id = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        let (sess_tx, sess_rx) = oneshot::channel();
        {
            let mut map = self.pending_requests.lock().await;
            map.insert(new_sess_id, sess_tx);
        }
        let mut params = serde_json::json!({
            "cwd": &workspace_cwd,
            "workspaceRoot": &workspace_cwd,
            "workspaceBindingId": &resolved_workspace.workspace_binding_id,
            "artifactRoot": resolved_workspace.artifact_root.to_string_lossy(),
            "mcpServers": [],
            "sessionKey": &session_key,
        });
        if is_dm || is_dm_topic {
            params["agentId"] = serde_json::Value::String(agent_id.to_string());
        }
        if let Some(c) = channel_id {
            params["channelId"] = serde_json::Value::String(c.to_string());
        }
        if let Some(scope) = scope_type {
            params["scopeType"] = serde_json::Value::String(scope.to_string());
        }
        params["systemPrompt"] = serde_json::Value::String(enriched_sp.clone());
        params["_meta"] = serde_json::json!({
            "systemPrompt": {
                "append": enriched_sp.clone()
            }
        });
        let new_req = serde_json::json!({
            "jsonrpc": "2.0",
            "id": new_sess_id,
            "method": "session/new",
            "params": params
        });
        let _ = self.stdin_tx.send(new_req.to_string()).await;

        let sess_result = tokio::time::timeout(Duration::from_secs(30), sess_rx).await;

        let sid = match sess_result {
            Ok(Ok(resp)) => {
                if let Some(err) = resp.get("error") {
                    anyhow::bail!("ACP session/new error from agent {}: {:?}", agent_id, err);
                }
                resp.get("result")
                    .and_then(|r| r.get("sessionId"))
                    .and_then(|s| s.as_str())
                    .filter(|s| !s.trim().is_empty())
                    .map(|s| s.to_string())
                    .ok_or_else(|| {
                        anyhow::anyhow!(
                            "ACP session/new missing result.sessionId in response: {:?}",
                            resp
                        )
                    })?
            }
            Ok(Err(_)) => {
                anyhow::bail!(
                    "ACP agent channel closed during session/new for agent {}",
                    agent_id
                );
            }
            Err(_) => {
                self.pending_requests.lock().await.remove(&new_sess_id);
                anyhow::bail!("ACP session/new timed out after 30s for agent {}", agent_id);
            }
        };

        tracing::info!(
            "[Agent {}] Created new sessionId for key {} (room {}): {} (cwd: {})",
            agent_id,
            session_key,
            room_id,
            sid,
            workspace_cwd
        );

        let created_gen = {
            let mut reg = self.session_registry.lock().await;
            reg.insert(session_key.clone(), sid.clone(), normalized_sp.clone())
        };
        if let Some(ref db) = self.db_manager {
            if let Err(e) = db.save_acp_session(
                agent_id,
                &session_key,
                &sid,
                &resolved_workspace.workspace_binding_id,
                &workspace_cwd,
                &normalized_sp,
                created_gen,
            ) {
                tracing::warn!(
                    "[Agent {}] Failed to save acp session to sqlite: {}",
                    agent_id,
                    e
                );
            }
        }
        let _ = self.app_handle.emit(
            "acp:session_reset",
            serde_json::json!({
                "agent_id": agent_id,
                "session_key": &session_key
            }),
        );

        Ok(EnsureSessionResult {
            session_id: sid,
            is_new: true,
            load_failed,
            recovery_mode: Some("new".to_string()),
        })
    }

    /// 发送 Prompt 请求并等待当前 Agent 返回 (符合标准 ACP 规范)
    /// 内部持有 self.prompt_lock，保证对同一 Agent 的指令按序下发，杜绝 stdio 管道竞态；
    /// 不同 Agent 拥有独立的 RunningAgent 实例与子进程，完全并发、互不阻塞！
    pub async fn send_session_prompt(
        &self,
        agent_id: &str,
        room_id: &str,
        channel_id: Option<&str>,
        workspace_binding_id: Option<&str>,
        requested_workspace_cwd: Option<&str>,
        scope_type: Option<&str>,
        attachments: &[AcpPromptAttachment],
        prompt: &str,
        system_prompt: Option<&str>,
        discussion_mode: Option<&str>,
        native_memory_enabled: Option<bool>,
        native_memory_auto_generate: Option<bool>,
    ) -> Result<serde_json::Value> {
        let _prompt_guard = self.prompt_lock.lock().await;

        let ensure_res = self
            .ensure_session_locked(
                agent_id,
                room_id,
                channel_id,
                workspace_binding_id,
                requested_workspace_cwd,
                scope_type,
                system_prompt,
                discussion_mode,
                None,
            )
            .await?;
        let current_session_id = ensure_res.session_id;

        let is_dm = is_dm_session_scope(scope_type, room_id, channel_id);
        let is_dm_topic = scope_type
            .map(|scope| scope.trim() == "dm_topic")
            .unwrap_or(false);

        let resolved_workspace = resolve_session_workspace(
            self.db_manager.as_ref(),
            agent_id,
            room_id,
            channel_id,
            workspace_binding_id,
            requested_workspace_cwd,
            scope_type,
            is_dm,
        )?;
        let session_key = build_scoped_session_key(
            agent_id,
            room_id,
            channel_id,
            discussion_mode,
            scope_type,
            &resolved_workspace.session_key_suffix,
            is_dm,
        );
        let workspace_cwd = resolved_workspace.cwd.to_string_lossy().to_string();

        // 若当前 Agent 绑定了 .scpack 专家能力包，执行宿主侧确定性预检索 (Pre-Retrieval) 与只读包裹注入
        let mut effective_prompt = prompt.to_string();
        let mut effective_native_memory_enabled = native_memory_enabled;
        let mut effective_native_memory_auto_generate = native_memory_auto_generate;
        let mut expert_pack_meta: Option<serde_json::Value> = None;

        if let Some(ref pack_id) = self.expert_pack_id {
            let packs_root = crate::db_manager::get_shadow_crew_home_dir().join("packs");
            let retrieval = shadow_crew_protocol::scpack::retrieve_and_build_expertise_prompt(
                &packs_root,
                pack_id,
                prompt,
                0.15,
            )
            .map_err(|e| anyhow::anyhow!("{}", e))?;

            effective_prompt = retrieval.composedPrompt.clone();
            // Fail-Closed: 挂载 .scpack 的便携式专家 Agent 强制关闭底层原生记忆读写，防止外部知识污染 B 端全局 ~/.codex/memories_v2
            effective_native_memory_enabled = Some(false);
            effective_native_memory_auto_generate = Some(false);

            let meta_obj = serde_json::json!({
                "packageId": retrieval.packageId,
                "version": retrieval.packageVersion,
                "matchedPlaybooks": retrieval.matchedPlaybookPaths,
                "topScore": retrieval.topScore,
                "sanitizationWarnings": retrieval.sanitizationWarnings,
                "portableExpertMode": true
            });
            let _ = self.app_handle.emit(
                "acp:expert_pack_retrieved",
                serde_json::json!({
                    "agentId": agent_id,
                    "sessionId": &current_session_id,
                    "expertPack": &meta_obj
                }),
            );
            log_acp_event(
                agent_id,
                "EXPERT_PACK_INJECT",
                &format!(
                    "pack={} matched={:?} score={:.3}",
                    pack_id, retrieval.matchedPlaybookPaths, retrieval.topScore
                ),
            );
            expert_pack_meta = Some(meta_obj);
        }

        let prompt_blocks = build_prompt_content_blocks(
            &effective_prompt,
            attachments,
            self.supports_prompt_image.load(Ordering::SeqCst),
            self.supports_embedded_context.load(Ordering::SeqCst),
        )?;

        // 构造标准 ACP session/prompt 请求 (携带独立工作区 cwd 与 channelId/agentId/sessionKey)
        let req_id = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        let (resp_tx, resp_rx) = oneshot::channel();
        {
            let mut map = self.pending_requests.lock().await;
            map.insert(req_id, resp_tx);
            let mut active_reqs = self.session_active_req.lock().await;
            active_reqs.insert(current_session_id.clone(), req_id);
        }

        let mut meta_val = build_native_memory_prompt_meta(
            effective_native_memory_enabled,
            effective_native_memory_auto_generate,
        );
        if let Some(ep_meta) = expert_pack_meta {
            if let Some(sc_obj) = meta_val
                .get_mut("shadowCrew")
                .and_then(|v| v.as_object_mut())
            {
                sc_obj.insert("expertPack".to_string(), ep_meta);
            }
        }

        let mut prompt_params = serde_json::json!({
            "sessionId": &current_session_id,
            "sessionKey": &session_key,
            "cwd": &workspace_cwd,
            "workspaceRoot": &workspace_cwd,
            "workspaceBindingId": &resolved_workspace.workspace_binding_id,
            "artifactRoot": resolved_workspace.artifact_root.to_string_lossy(),
            "prompt": prompt_blocks,
            "_meta": meta_val
        });
        if is_dm || is_dm_topic {
            prompt_params["agentId"] = serde_json::Value::String(agent_id.to_string());
        }
        if let Some(c) = channel_id {
            prompt_params["channelId"] = serde_json::Value::String(c.to_string());
        }
        if let Some(scope) = scope_type {
            prompt_params["scopeType"] = serde_json::Value::String(scope.to_string());
        }

        let request = serde_json::json!({
            "jsonrpc": "2.0",
            "id": req_id,
            "method": "session/prompt",
            "params": prompt_params
        });

        if let Err(e) = self.stdin_tx.send(request.to_string()).await {
            self.is_alive.store(false, Ordering::SeqCst);
            anyhow::bail!("Failed to write to agent stdin channel: {}", e);
        }

        let prompt_start_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        self.last_activity.store(prompt_start_ms, Ordering::Relaxed);

        // 等待 Agent 响应 (对标 Buzz 架构: 动态空闲超时 300s~1500s + 最大硬上限 1800s)
        let idle_timeout_secs = std::env::var("SHADOW_CREW_ACP_IDLE_TIMEOUT")
            .ok()
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(600);
        let max_duration_secs = std::env::var("SHADOW_CREW_ACP_MAX_DURATION")
            .ok()
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(1800);
        let permission_timeout_secs = std::env::var("SHADOW_CREW_ACP_PERMISSION_TIMEOUT")
            .ok()
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(600);

        let start_time = std::time::Instant::now();
        let idle_timeout = Duration::from_secs(idle_timeout_secs);
        let max_duration = Duration::from_secs(max_duration_secs);
        let permission_timeout = Duration::from_secs(permission_timeout_secs);

        let mut resp_rx = resp_rx;
        let mut last_heartbeat_sec: u64 = 0;
        let wait_result: Result<serde_json::Value, String> = loop {
            let now = std::time::Instant::now();
            let total_elapsed = now.duration_since(start_time);
            if total_elapsed >= max_duration {
                tracing::warn!(
                    "[Agent {}] Prompt reached hard maximum duration limit of {}s",
                    agent_id,
                    max_duration_secs
                );
                break Err(format!(
                    "Agent response exceeded maximum turn duration ({}s)",
                    max_duration_secs
                ));
            }

            let last_act_ms = self.last_activity.load(Ordering::Relaxed);
            let current_ms = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64;
            let idle_elapsed_ms = current_ms.saturating_sub(last_act_ms);
            let pending_permission_count = self.pending_permission_count.load(Ordering::SeqCst);
            if pending_permission_count > 0 {
                self.cancel_expired_permissions(permission_timeout).await;
            }
            let pending_permission_count = self.pending_permission_count.load(Ordering::SeqCst);
            if pending_permission_count == 0
                && idle_elapsed_ms >= idle_timeout.as_millis() as u64
            {
                tracing::warn!(
                    "[Agent {}] Prompt reached idle timeout (no output for {}s)",
                    agent_id,
                    idle_timeout_secs
                );
                break Err(format!(
                    "Agent response idle timeout (no stdout output for {}s)",
                    idle_timeout_secs
                ));
            }

            // 心跳进度通知 (每 4 秒向前端发送一次，避免无 stdout 时前端显示僵死)
            let total_sec = total_elapsed.as_secs();
            if total_sec > last_heartbeat_sec + 3 {
                last_heartbeat_sec = total_sec;
                let _ = self.app_handle.emit(
                    "acp:thinking_heartbeat",
                    serde_json::json!({
                        "agent_id": agent_id,
                        "sessionId": current_session_id,
                        "session_key": &session_key,
                        "elapsed_seconds": total_sec,
                        "idle_elapsed_seconds": idle_elapsed_ms / 1000,
                        "pending_permission_count": pending_permission_count,
                    }),
                );
            }

            // 检查子进程是否已非正常退出
            if !self.is_alive.load(Ordering::SeqCst) {
                match resp_rx.try_recv() {
                    Ok(val) => break Ok(val),
                    Err(oneshot::error::TryRecvError::Empty) => {
                        break Ok(serde_json::json!({
                            "status": "closed",
                            "error": "Agent process exited while waiting for response"
                        }));
                    }
                    Err(oneshot::error::TryRecvError::Closed) => {
                        break Ok(serde_json::json!({
                            "status": "closed",
                            "error": "Agent stdio pipe closed"
                        }));
                    }
                }
            }

            let remaining_idle_ms =
                (idle_timeout.as_millis() as u64).saturating_sub(idle_elapsed_ms);
            let remaining_total_ms =
                (max_duration.as_millis() as u64).saturating_sub(total_elapsed.as_millis() as u64);
            let step_wait_ms = remaining_idle_ms.min(remaining_total_ms).min(1000).max(50);

            tokio::select! {
                res = &mut resp_rx => {
                    match res {
                        Ok(val) => break Ok(val),
                        Err(_) => break Ok(serde_json::json!({
                            "status": "closed",
                            "error": "Agent closed stdio response pipe"
                        })),
                    }
                }
                _ = tokio::time::sleep(Duration::from_millis(step_wait_ms)) => {
                    // 心跳轮询，继续检查空闲倒计时与总时长
                }
            }
        };

        let response = match wait_result {
            Ok(resp) => {
                // 仅当出现明确未找到会话或失效的错误码/提示时，才作废会话缓存与 SQLite 持久化记录
                if let Some(err) = resp.get("error") {
                    let is_session_invalid = is_session_invalid_error(err);

                    if is_session_invalid {
                        tracing::warn!(
                            "[Agent {}] Invalid session detected for session_key {}: {:?}. Evicting.",
                            agent_id, session_key, err
                        );
                        self.session_registry.lock().await.remove(&session_key);
                        self.session_permission_grants
                            .lock()
                            .await
                            .retain(|grant| grant.session_id != current_session_id);
                        if let Some(ref db) = self.db_manager {
                            let _ = db.delete_acp_session(Some(agent_id), Some(&session_key), None);
                        }
                    }

                    let err_msg = err
                        .get("message")
                        .and_then(|m| m.as_str())
                        .unwrap_or_default();
                    if err_msg.contains("Authentication required")
                        || err_msg.to_lowercase().contains("authentication")
                    {
                        *self.auth_state.lock().await = "auth_required".to_string();
                        *self.status_detail.lock().await = Some(err_msg.to_string());
                        let _ = self.app_handle.emit(
                            "acp:status_change",
                            serde_json::json!({
                                "agent_id": agent_id,
                                "status": "auth_required",
                                "auth_state": "auth_required",
                                "status_detail": err_msg,
                                "pid": self.pid
                            }),
                        );
                    }
                }
                if let Some(res) = resp.get("result") {
                    if let Some(refreshed) = maybe_refresh_native_memory_capability(res) {
                        *self.native_memory_capability.lock().await = refreshed;
                    }
                }
                Ok(resp)
            }
            Err(timeout_err_msg) => {
                let mut map = self.pending_requests.lock().await;
                map.remove(&req_id);
                let mut active_reqs = self.session_active_req.lock().await;
                if active_reqs.get(&current_session_id) == Some(&req_id) {
                    active_reqs.remove(&current_session_id);
                }
                Ok(serde_json::json!({
                    "status": "timeout",
                    "error": timeout_err_msg
                }))
            }
        };

        // 清理 session_active_req (仅当本请求依然为该 session 当前绑定的活跃请求时才执行清理，严防覆盖后被早退请求误删)
        {
            let mut active_reqs = self.session_active_req.lock().await;
            if active_reqs.get(&current_session_id) == Some(&req_id) {
                active_reqs.remove(&current_session_id);
            }
        }

        self.cancel_pending_permissions_for_session(
            &current_session_id,
            "session prompt finished before permission was resolved",
        )
        .await;

        response
    }
}

/// 判断 session/prompt 返回的 JSON-RPC 错误是否属于明确的会话失效/不存在。
/// 仅当错误码为 -32001 (Session not found) 或 -32002 (Invalid session)，
/// 或错误提示包含 session not found / invalid session / unknown session / session expired 时，
/// 才认定底层会话已失效并执行作废。瞬态网络、鉴权、限流或工具调用错误绝不作废会话。
pub fn is_session_invalid_error(err: &serde_json::Value) -> bool {
    if let Some(code) = err.get("code").and_then(|c| c.as_i64()) {
        if code == -32001 || code == -32002 {
            return true;
        }
    }
    let msg = err
        .get("message")
        .and_then(|m| m.as_str())
        .unwrap_or_default()
        .to_lowercase();
    msg.contains("session not found")
        || msg.contains("invalid session")
        || msg.contains("unknown session")
        || msg.contains("session expired")
}

/// 由「进程存活 / 鉴权 / ACP 握手」三要素推导对外运行态。
///
/// 关键约束：进程存活但 ACP initialize 被拒绝时（例如适配器后端二进制缺失）必须是 error，
/// 绝不允许上报 running——进程活着只证明适配器在监听，不证明它能承载任何 prompt。
fn derive_runtime_status(is_alive: bool, auth_state: &str, has_init_error: bool) -> &'static str {
    if !is_alive {
        "idle"
    } else if auth_state == "auth_required" {
        "auth_required"
    } else if has_init_error {
        "error"
    } else {
        "running"
    }
}

#[cfg(test)]
mod runtime_status_tests {
    use super::{
        acp_client_capabilities, attachment_file_uri, build_permission_request_view,
        build_prompt_content_blocks_from_root, build_scoped_session_key,
        check_supports_embedded_context, check_supports_prompt_image,
        classify_permission_capability, derive_runtime_status, is_dm_session_scope,
        jsonrpc_id_key, parse_permission_options, partition_permission_paths,
        permission_cancelled_response, permission_selected_response,
        resolve_session_workspace, select_permission_option, AcpPermissionDecision,
        AcpPromptAttachment, PermissionScopeContext,
    };

    #[test]
    fn dead_process_is_idle() {
        assert_eq!(derive_runtime_status(false, "ok", false), "idle");
        assert_eq!(derive_runtime_status(false, "ok", true), "idle");
    }

    #[test]
    fn rejected_handshake_never_reports_running() {
        // 复现 MyCodex 场景：codex-acp 适配器进程存活，但 initialize 因 codex 缺失返回 JSON-RPC error
        assert_eq!(derive_runtime_status(true, "ok", true), "error");
    }

    #[test]
    fn healthy_handshake_is_running() {
        assert_eq!(derive_runtime_status(true, "ok", false), "running");
    }

    #[test]
    fn permission_capabilities_and_options_fail_closed_without_allow_once() {
        let capabilities = acp_client_capabilities();
        assert_eq!(capabilities["fs"]["readTextFile"], false);
        assert_eq!(capabilities["fs"]["writeTextFile"], false);
        assert_eq!(capabilities["terminal"], false);
        let prompt_capabilities = serde_json::json!({
            "agentCapabilities": {
                "promptCapabilities": {
                    "image": true,
                    "embeddedContext": true
                }
            }
        });
        assert!(check_supports_prompt_image(&prompt_capabilities));
        assert!(check_supports_embedded_context(&prompt_capabilities));
        assert_eq!(
            classify_permission_capability(&serde_json::json!({
                "name": "Read",
                "kind": "read"
            })),
            "fs.read"
        );
        assert_eq!(
            classify_permission_capability(&serde_json::json!({
                "name": "MultiEdit",
                "kind": "edit"
            })),
            "fs.write"
        );
        assert_eq!(
            classify_permission_capability(&serde_json::json!({
                "name": "Bash",
                "kind": "execute"
            })),
            "shell.execute"
        );

        let params = serde_json::json!({
            "options": [
                { "optionId": "allow-always", "name": "Always", "kind": "allow_always" },
                { "optionId": "allow-once", "name": "Once", "kind": "allow_once" },
                { "optionId": "reject", "name": "No", "kind": "reject_once" }
            ]
        });
        let options = parse_permission_options(&params);
        assert_eq!(
            select_permission_option(&options, AcpPermissionDecision::AllowOnce),
            Some("allow-once".to_string())
        );
        assert_eq!(
            select_permission_option(&options, AcpPermissionDecision::Deny),
            Some("reject".to_string())
        );

        let always_only = parse_permission_options(&serde_json::json!({
            "options": [
                { "optionId": "allow-always", "name": "Always", "kind": "allow_always" }
            ]
        }));
        assert_eq!(
            select_permission_option(&always_only, AcpPermissionDecision::AllowOnce),
            None,
            "allow_always must not be silently substituted for one-time approval"
        );
    }

    #[test]
    fn permission_request_detects_paths_outside_workspace_and_preserves_jsonrpc_id() {
        let root = std::env::temp_dir().join(format!(
            "shadow_crew_permission_scope_test_{}",
            std::process::id()
        ));
        let inside = root.join("src/app.ts");
        let outside = std::env::temp_dir().join("shadow_crew_permission_outside.ts");
        std::fs::create_dir_all(inside.parent().unwrap()).unwrap();
        std::fs::write(&inside, "inside").unwrap();
        std::fs::write(&outside, "outside").unwrap();

        let params = serde_json::json!({
            "sessionId": "session-1",
            "toolCall": {
                "name": "Write",
                "title": "Write files",
                "kind": "edit",
                "rawInput": { "file_path": outside.to_string_lossy() },
                "locations": [{ "path": inside.to_string_lossy() }]
            },
            "options": [
                { "optionId": "allow-once", "name": "Once", "kind": "allow_once" },
                { "optionId": "reject", "name": "No", "kind": "reject_once" }
            ],
            "_meta": {
                "permission": {
                    "description": "writes source files"
                }
            }
        });
        let scope = PermissionScopeContext {
            scope_type: "topic".to_string(),
            scope_id: "topic-1".to_string(),
            workspace_binding_id: "ws-topic-1".to_string(),
            session_key: "topic:channel-1:topic-1:standard:ws-ws-topic-1".to_string(),
            cwd: root.to_string_lossy().to_string(),
        };
        let view = build_permission_request_view(
            "agent-1",
            "7".to_string(),
            "session-1".to_string(),
            scope,
            &params,
            parse_permission_options(&params),
        );

        assert_eq!(view.capability, "fs.write");
        assert_eq!(view.paths.len(), 1);
        assert_eq!(view.outside_workspace_paths.len(), 1);
        assert!(view.supports_allow_once);
        assert!(view.supports_reject);
        let serialized_view = serde_json::to_value(&view).unwrap();
        assert_eq!(serialized_view["requestId"], "7");
        assert_eq!(serialized_view["workspaceBindingId"], "ws-topic-1");
        assert_eq!(serialized_view["supportsAllowOnce"], true);
        assert_eq!(
            jsonrpc_id_key(&serde_json::json!("string-id")),
            Some("string-id".to_string())
        );
        assert_eq!(
            permission_selected_response(serde_json::json!(7), "allow-once")["result"]["outcome"]
                ["optionId"],
            "allow-once"
        );
        assert_eq!(
            permission_cancelled_response(serde_json::json!(7))["result"]["outcome"]["outcome"],
            "cancelled"
        );

        let traversal = root.join("missing/../../outside.ts");
        let (_, traversal_outside) = partition_permission_paths(
            &[traversal.to_string_lossy().to_string()],
            &root,
        );
        assert_eq!(
            traversal_outside.len(),
            1,
            "lexical '..' traversal must remain outside the workspace"
        );

        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_file(outside);
    }

    #[test]
    fn prompt_content_blocks_include_images_and_embedded_files_without_path_escape() {
        let root = std::env::temp_dir().join(format!(
            "shadow_crew_prompt_attachment_test_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        let attachment_root = root.join("attachments");
        std::fs::create_dir_all(&attachment_root).unwrap();
        let image_path = attachment_root.join("image.png");
        let file_path = attachment_root.join("notes.txt");
        let outside_path = root.join("outside.txt");
        std::fs::write(&image_path, b"\x89PNG\r\n\x1a\nfake-image").unwrap();
        std::fs::write(&file_path, b"hello attachment").unwrap();
        std::fs::write(&outside_path, b"outside").unwrap();

        let image = AcpPromptAttachment {
            id: "img-1".to_string(),
            kind: "image".to_string(),
            name: "image.png".to_string(),
            mime_type: "image/png".to_string(),
            size: std::fs::metadata(&image_path).unwrap().len(),
            path: image_path.to_string_lossy().to_string(),
            uri: attachment_file_uri(&image_path),
        };
        let file = AcpPromptAttachment {
            id: "file-1".to_string(),
            kind: "file".to_string(),
            name: "notes.txt".to_string(),
            mime_type: "text/plain".to_string(),
            size: std::fs::metadata(&file_path).unwrap().len(),
            path: file_path.to_string_lossy().to_string(),
            uri: attachment_file_uri(&file_path),
        };

        let blocks = build_prompt_content_blocks_from_root(
            "review attachments",
            &[image.clone(), file],
            true,
            true,
            &attachment_root,
        )
        .unwrap();
        assert_eq!(blocks.len(), 3);
        assert_eq!(blocks[0]["type"], "text");
        assert_eq!(blocks[1]["type"], "image");
        assert_eq!(blocks[1]["mimeType"], "image/png");
        assert_eq!(blocks[2]["type"], "resource");
        assert_eq!(blocks[2]["resource"]["text"], "hello attachment");

        let linked_file = AcpPromptAttachment {
            id: "file-link".to_string(),
            kind: "file".to_string(),
            name: "linked.txt".to_string(),
            mime_type: "text/plain".to_string(),
            size: std::fs::metadata(&file_path).unwrap().len(),
            path: file_path.to_string_lossy().to_string(),
            uri: attachment_file_uri(&file_path),
        };
        let linked_blocks = build_prompt_content_blocks_from_root(
            "linked file",
            &[linked_file],
            false,
            false,
            &attachment_root,
        )
        .unwrap();
        assert_eq!(linked_blocks[1]["type"], "resource_link");

        assert!(
            build_prompt_content_blocks_from_root(
                "image unsupported",
                &[image],
                false,
                false,
                &attachment_root,
            )
            .is_err()
        );

        let escaped = AcpPromptAttachment {
            id: "bad".to_string(),
            kind: "file".to_string(),
            name: "outside.txt".to_string(),
            mime_type: "text/plain".to_string(),
            size: std::fs::metadata(&outside_path).unwrap().len(),
            path: outside_path.to_string_lossy().to_string(),
            uri: attachment_file_uri(&outside_path),
        };
        assert!(
            build_prompt_content_blocks_from_root(
                "escape",
                &[escaped],
                true,
                true,
                &attachment_root,
            )
            .is_err()
        );

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn auth_required_outranks_init_error() {
        assert_eq!(
            derive_runtime_status(true, "auth_required", false),
            "auth_required"
        );
        assert_eq!(
            derive_runtime_status(true, "auth_required", true),
            "auth_required"
        );
    }

    #[test]
    fn channel_and_agent_workspace_dirs_are_isolated_under_shadow_crew_home() {
        let tmp_root = std::env::temp_dir().join("shadow_crew_channel_workspace_test");
        std::env::set_var("SHADOW_CREW_HOME", &tmp_root);
        let home = crate::db_manager::get_shadow_crew_home_dir();
        let chan_a = crate::db_manager::get_channel_dir("channel-alpha-test");
        let chan_b = crate::db_manager::get_channel_dir("channel-beta-test");
        let agent_1 = crate::db_manager::get_agent_dir("agent-1790582453199");
        let agent_2 = crate::db_manager::get_agent_dir("agent-1792035238590");
        assert!(chan_a.starts_with(home.join("channels")));
        assert!(chan_b.starts_with(home.join("channels")));
        assert!(agent_1.starts_with(home.join("agents")));
        assert!(agent_2.starts_with(home.join("agents")));
        assert_ne!(chan_a, chan_b);
        assert_ne!(agent_1, agent_2);
        assert_ne!(agent_1, chan_a);
        assert!(chan_a.join("artifacts").exists());
        assert!(chan_a.join("scratch").exists());
        assert!(agent_1.join("artifacts").exists());
        assert!(agent_1.join("scratch").exists());
        assert!(agent_2.join("artifacts").exists());
        let _ = std::fs::remove_dir_all(&tmp_root);
        std::env::remove_var("SHADOW_CREW_HOME");
    }

    #[test]
    fn topic_workspace_bindings_resolve_to_distinct_cwds_and_session_suffixes() {
        use crate::db_manager::DatabaseManager;
        use std::sync::Arc;

        let tmp_root = std::env::temp_dir().join(format!(
            "shadow_crew_topic_binding_test_{}",
            std::process::id()
        ));
        let topic_a_dir = tmp_root.join("repo-a");
        let topic_b_dir = tmp_root.join("repo-b");
        std::fs::create_dir_all(&topic_a_dir).unwrap();
        std::fs::create_dir_all(&topic_b_dir).unwrap();

        let db = Arc::new(DatabaseManager::new(":memory:").unwrap());
        db.save_workspace_bindings(&[
            serde_json::json!({
                "id": "ws-channel-1",
                "ownerType": "channel",
                "ownerId": "chan-1",
                "mode": "custom",
                "origin": "created_custom",
                "cwd": topic_a_dir.to_string_lossy(),
                "artifactRoot": topic_a_dir.join(".shadow-crew/channel-artifacts").to_string_lossy(),
                "createdAt": 0
            }),
            serde_json::json!({
                "id": "ws-topic-a",
                "ownerType": "topic",
                "ownerId": "topic-a",
                "mode": "custom",
                "origin": "created_custom",
                "cwd": topic_a_dir.to_string_lossy(),
                "artifactRoot": topic_a_dir.join(".shadow-crew/artifacts").to_string_lossy(),
                "createdAt": 1
            }),
            serde_json::json!({
                "id": "ws-topic-b",
                "ownerType": "topic",
                "ownerId": "topic-b",
                "mode": "custom",
                "origin": "created_custom",
                "cwd": topic_b_dir.to_string_lossy(),
                "artifactRoot": topic_b_dir.join(".shadow-crew/artifacts").to_string_lossy(),
                "createdAt": 2
            }),
        ]).unwrap();

        let topic_a = resolve_session_workspace(
            Some(&db),
            "agent-1",
            "topic-a",
            Some("chan-1"),
            Some("ws-topic-a"),
            None,
            Some("topic"),
            false,
        ).unwrap();
        let topic_b = resolve_session_workspace(
            Some(&db),
            "agent-1",
            "topic-b",
            Some("chan-1"),
            Some("ws-topic-b"),
            None,
            Some("topic"),
            false,
        ).unwrap();
        let channel = resolve_session_workspace(
            Some(&db),
            "agent-1",
            "thread-1",
            Some("chan-1"),
            Some("ws-channel-1"),
            None,
            Some("channel"),
            false,
        ).unwrap();

        assert_eq!(topic_a.cwd, std::fs::canonicalize(&topic_a_dir).unwrap());
        assert_eq!(topic_b.cwd, std::fs::canonicalize(&topic_b_dir).unwrap());
        assert_ne!(topic_a.cwd, topic_b.cwd);
        assert_eq!(topic_a.session_key_suffix, ":ws-ws-topic-a");
        assert_eq!(topic_b.session_key_suffix, ":ws-ws-topic-b");
        assert_eq!(topic_a.workspace_binding_id, "ws-topic-a");
        assert_eq!(channel.workspace_binding_id, "ws-channel-1");
        assert_eq!(channel.cwd, std::fs::canonicalize(&topic_a_dir).unwrap());

        let missing = resolve_session_workspace(
            Some(&db),
            "agent-1",
            "topic-missing",
            Some("chan-1"),
            None,
            None,
            Some("topic"),
            false,
        );
        assert!(missing.is_err(), "Topic without a Binding must fail closed");

        let _ = std::fs::remove_dir_all(&tmp_root);
    }

    #[test]
    fn explicit_scope_prevents_channel_threads_from_becoming_topics() {
        assert_eq!(
            build_scoped_session_key(
                "agent-1",
                "thread-1",
                Some("channel-1"),
                None,
                Some("channel"),
                ":ws-channel-1",
                false,
            ),
            "channel:channel-1:thread-1:ws-channel-1"
        );
        assert_eq!(
            build_scoped_session_key(
                "agent-1",
                "topic-1",
                Some("channel-1"),
                Some("standard"),
                Some("topic"),
                ":ws-topic-1",
                false,
            ),
            "topic:channel-1:topic-1:standard:ws-topic-1"
        );
        assert_eq!(
            build_scoped_session_key(
                "agent-1",
                "dm-topic-1",
                None,
                Some("game_theoretic"),
                Some("dm_topic"),
                ":ws-topic-1",
                false,
            ),
            "dmtopic:agent-1:dm-topic-1:game_theoretic:ws-topic-1"
        );
    }

    #[tokio::test]
    async fn test_multi_agent_concurrent_prompt_dispatch_isolation() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::sync::Arc;
        use std::time::Duration;
        use tokio::sync::Mutex as TokioMutex;

        // 模拟两个独立的 Agent 运行句柄 (持有独立的 prompt_lock)
        let agent1_lock = Arc::new(TokioMutex::new(()));
        let agent2_lock = Arc::new(TokioMutex::new(()));

        let concurrent_counter = Arc::new(AtomicUsize::new(0));
        let max_concurrent = Arc::new(AtomicUsize::new(0));

        let c1 = concurrent_counter.clone();
        let m1 = max_concurrent.clone();
        let l1 = agent1_lock.clone();
        let task1 = tokio::spawn(async move {
            let _guard = l1.lock().await;
            let current = c1.fetch_add(1, Ordering::SeqCst) + 1;
            m1.fetch_max(current, Ordering::SeqCst);
            tokio::time::sleep(Duration::from_millis(50)).await;
            c1.fetch_sub(1, Ordering::SeqCst);
        });

        let c2 = concurrent_counter.clone();
        let m2 = max_concurrent.clone();
        let l2 = agent2_lock.clone();
        let task2 = tokio::spawn(async move {
            let _guard = l2.lock().await;
            let current = c2.fetch_add(1, Ordering::SeqCst) + 1;
            m2.fetch_max(current, Ordering::SeqCst);
            tokio::time::sleep(Duration::from_millis(50)).await;
            c2.fetch_sub(1, Ordering::SeqCst);
        });

        let (r1, r2) = tokio::join!(task1, task2);
        assert!(r1.is_ok());
        assert!(r2.is_ok());

        // 核心断言：两个独立 Agent 的 prompt 派发是完全并发并行的 (max_concurrent 达到 2)
        assert_eq!(max_concurrent.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn test_normalize_system_prompt_for_sync() {
        use super::normalize_system_prompt_for_sync;

        let base_persona = "[🤖 智能体专属专精人设与认知规范]:\n• 你的代号：Coder (技术专家)\n• 核心职责：负责代码实现";
        let roster_v1 = "\n\n[🛡️ Shadow Crew 平台智能体协同公约 (Agent Collaboration Directive)]:\n[👥 可用协同团队成员列表]:\n• @alice (Alice · 架构师)\n• @bob (Bob · 审查员)";
        let roster_v2 = "\n\n[🛡️ Shadow Crew 平台智能体协同公约 (Agent Collaboration Directive)]:\n[👥 可用协同团队成员列表]:\n• @alice (Alice · 架构师)\n• @bob (Bob · 审查员)\n• @carol (Carol · 测试专家)";
        let workspace_env = "\n\n[当前频道专属工作空间环境]:\n- 频道 ID: chan-1\n- 根目录: ~/.shadow-crew/channels/chan-1";

        let cold_prompt_v1 = format!("{}{}{}", base_persona, roster_v1, workspace_env);
        let warm_prompt = format!("{}{}", base_persona, workspace_env);
        let cold_prompt_v2 = format!("{}{}{}", base_persona, roster_v2, workspace_env);

        let norm_cold_v1 = normalize_system_prompt_for_sync(&cold_prompt_v1);
        let norm_warm = normalize_system_prompt_for_sync(&warm_prompt);
        let norm_cold_v2 = normalize_system_prompt_for_sync(&cold_prompt_v2);

        // 核心断言 1：冷启动（带团队花名册）与第二轮热会话（剥离花名册），规范化后严格一致
        assert_eq!(norm_cold_v1, norm_warm);
        // 核心断言 2：新成员加入后花名册更新，基础人设依然规范化一致，不触发 session 误杀
        assert_eq!(norm_cold_v2, norm_warm);

        // 核心断言 3：当用户真正修改了 Agent 自身的人设（如代号或职责变化）时，规范化后严格不同
        let changed_persona =
            "[🤖 智能体专属专精人设与认知规范]:\n• 你的代号：Reviewer (安全架构师)";
        let changed_prompt = format!("{}{}", changed_persona, workspace_env);
        let norm_changed = normalize_system_prompt_for_sync(&changed_prompt);
        assert_ne!(norm_changed, norm_warm);
    }

    #[test]
    fn test_clear_sessions_with_generation_ignores_stale_and_preserves_newer_sessions() {
        use super::{SessionEntry, SessionRegistry};

        let mut reg = SessionRegistry::new();

        // 1. 初始会话 (created at gen = 0)
        reg.entries.insert(
            "channel:ch-1:thread-1".to_string(),
            SessionEntry {
                session_id: "sid-old-1".to_string(),
                system_prompt: "sp-1".to_string(),
                created_gen: 0,
            },
        );

        // 2. 重试的清理请求 (gen = 2) 先一步执行完成，清理了旧会话并将 latest_clear_generation 推进到 2
        let removed_by_retry = reg.prune_with_generation(Some("channel:ch-1"), Some(2));
        assert_eq!(removed_by_retry, vec!["sid-old-1".to_string()]);
        assert_eq!(reg.latest_clear_generation, 2);
        assert!(reg.entries.is_empty());

        // 3. 清理成功后，用户发起新 Prompt，创建了代际为 3 (latest_clear_generation + 1) 的新会话 sid-new-2
        reg.insert(
            "channel:ch-1:thread-1".to_string(),
            "sid-new-2".to_string(),
            "sp-2".to_string(),
        );
        assert_eq!(reg.get("channel:ch-1:thread-1").unwrap().created_gen, 3);

        // 4. 此前超时的旧清理请求 (gen = 1 < latest_gen = 2) 迟到到达 -> 必须被直接忽略，不得删除 sid-new-2！
        let removed_by_late_clear = reg.prune_with_generation(Some("channel:ch-1"), Some(1));
        assert!(
            removed_by_late_clear.is_empty(),
            "迟到的旧清理请求 (gen=1 < latest=2) 严禁删除已新建的会话"
        );
        assert_eq!(
            reg.get("channel:ch-1:thread-1")
                .map(|e| e.session_id.as_str()),
            Some("sid-new-2"),
            "新建的会话 sid-new-2 必须完好保留"
        );
    }

    #[tokio::test]
    async fn test_concurrent_session_registry_insert_and_clear_atomicity() {
        use super::SessionRegistry;
        use std::sync::Arc;
        use tokio::sync::Mutex as TokioMutex;

        let registry = Arc::new(TokioMutex::new(SessionRegistry::new()));

        let mut handles = Vec::new();
        // 1. 并发注册 20 个会话
        for i in 0..20 {
            let reg_clone = registry.clone();
            handles.push(tokio::spawn(async move {
                let mut reg = reg_clone.lock().await;
                reg.insert(
                    format!("channel:ch-{}:thread-1", i % 4),
                    format!("sid-{}", i),
                    format!("sp-{}", i),
                );
            }));
        }

        // 2. 并发对特定频道按代际进行裁剪清理
        for gen in 1..=5 {
            let reg_clone = registry.clone();
            handles.push(tokio::spawn(async move {
                let mut reg = reg_clone.lock().await;
                reg.prune_with_generation(Some("channel:ch-0"), Some(gen));
            }));
        }

        for h in handles {
            h.await.unwrap();
        }

        let reg = registry.lock().await;
        // 验证原子性不变量：条目要么不存在，要么三要素完全对齐，绝无孤立 prompt 或丢失代际
        for (k, entry) in &reg.entries {
            assert!(!entry.session_id.is_empty(), "session_id 不能为空");
            assert!(!entry.system_prompt.is_empty(), "system_prompt 不能为空");
            assert!(entry.created_gen > 0, "created_gen 必须为正代际");
            assert!(
                k.starts_with("channel:ch-"),
                "session_key 必须保留有效前缀: {}",
                k
            );
        }
    }

    #[test]
    fn dm_topic_uses_topic_binding_and_never_falls_back_to_dm_cwd() {
        use crate::db_manager::DatabaseManager;
        use std::sync::Arc;

        let tmp_root = std::env::temp_dir().join(format!(
            "shadow_crew_dm_topic_binding_test_{}",
            std::process::id()
        ));
        let dm_topic_dir = tmp_root.join("agent-1/topics/topic-dm-a");
        std::fs::create_dir_all(&dm_topic_dir).unwrap();

        let db = Arc::new(DatabaseManager::new(":memory:").unwrap());
        db.save_workspace_bindings(&[serde_json::json!({
            "id": "ws-dm-topic-a",
            "ownerType": "topic",
            "ownerId": "topic-dm-a",
            "mode": "default",
            "origin": "created_default",
            "cwd": dm_topic_dir.to_string_lossy(),
            "artifactRoot": dm_topic_dir.join("artifacts").to_string_lossy(),
            "createdAt": 1
        })])
        .unwrap();

        assert!(!is_dm_session_scope(
            Some("dm_topic"),
            "topic-dm-a",
            None
        ));
        assert!(is_dm_session_scope(Some("dm"), "thread-dm-agent-1", None));
        assert!(!is_dm_session_scope(
            Some("topic"),
            "topic-channel-1",
            Some("dm-like-channel")
        ));

        let resolved = resolve_session_workspace(
            Some(&db),
            "agent-1",
            "topic-dm-a",
            None,
            Some("ws-dm-topic-a"),
            None,
            Some("dm_topic"),
            false,
        )
        .unwrap();
        assert_eq!(resolved.cwd, std::fs::canonicalize(&dm_topic_dir).unwrap());
        assert_eq!(resolved.workspace_binding_id, "ws-dm-topic-a");
        assert_eq!(resolved.session_key_suffix, ":ws-ws-dm-topic-a");

        let missing = resolve_session_workspace(
            Some(&db),
            "agent-1",
            "topic-dm-missing",
            None,
            None,
            None,
            Some("dm_topic"),
            false,
        );
        assert!(
            missing.is_err(),
            "DM Topic without Workspace Binding must fail closed"
        );

        let _ = std::fs::remove_dir_all(&tmp_root);
    }

    #[test]
    fn test_check_supports_load_session() {
        use super::check_supports_load_session;

        let with_capabilities = serde_json::json!({
            "capabilities": {
                "loadSession": true
            }
        });
        assert!(check_supports_load_session(&with_capabilities));

        let with_agent_capabilities = serde_json::json!({
            "agentCapabilities": {
                "loadSession": true
            }
        });
        assert!(check_supports_load_session(&with_agent_capabilities));

        let with_nested_sessions = serde_json::json!({
            "capabilities": {
                "sessions": {
                    "load": true
                }
            }
        });
        assert!(check_supports_load_session(&with_nested_sessions));

        let without_support = serde_json::json!({
            "capabilities": {
                "prompts": { "listChanged": true }
            }
        });
        assert!(!check_supports_load_session(&without_support));
    }

    #[test]
    fn test_check_native_memory_capability_contract() {
        use super::check_native_memory_capability;

        let enabled = serde_json::json!({
            "agentCapabilities": {
                "nativeMemory": {
                    "supported": true,
                    "enabled": true,
                    "persistent": true,
                    "crossThread": true,
                    "scope": "runtime",
                    "provider": "codex-memories"
                }
            }
        });
        let capability = check_native_memory_capability(&enabled);
        assert_eq!(capability.status, "enabled");
        assert_eq!(capability.persistent, Some(true));
        assert_eq!(capability.cross_thread, Some(true));
        assert_eq!(capability.provider.as_deref(), Some("codex-memories"));
        assert_eq!(capability.scope.as_deref(), Some("runtime"));

        let disabled = serde_json::json!({
            "agentCapabilities": {
                "nativeMemory": {
                    "supported": true,
                    "enabled": false,
                    "persistent": true,
                    "crossThread": true
                }
            }
        });
        assert_eq!(
            check_native_memory_capability(&disabled).status,
            "disabled"
        );

        let unsupported = serde_json::json!({
            "agentCapabilities": {
                "nativeMemory": {
                    "supported": false
                }
            }
        });
        assert_eq!(
            check_native_memory_capability(&unsupported).status,
            "unsupported"
        );

        let undeclared = serde_json::json!({
            "agentCapabilities": {
                "loadSession": true
            }
        });
        let unknown = check_native_memory_capability(&undeclared);
        assert_eq!(unknown.status, "unknown");
        assert!(unknown.persistent.is_none());
        assert!(unknown.cross_thread.is_none());
        assert_eq!(unknown.scope.as_deref(), Some("unknown"));

        let missing_enabled = serde_json::json!({
            "agentCapabilities": {
                "nativeMemory": {
                    "supported": true
                }
            }
        });
        assert_eq!(
            check_native_memory_capability(&missing_enabled).status,
            "unknown"
        );
    }

    #[test]
    fn test_native_memory_prompt_meta_contract() {
        use super::build_native_memory_prompt_meta;

        let enabled = build_native_memory_prompt_meta(Some(true), Some(false));
        assert_eq!(
            enabled["shadowCrew"]["nativeMemory"]["enabled"],
            serde_json::Value::Bool(true)
        );
        assert_eq!(
            enabled["shadowCrew"]["nativeMemory"]["autoGenerate"],
            serde_json::Value::Bool(false)
        );

        let disabled = build_native_memory_prompt_meta(Some(false), Some(true));
        assert_eq!(
            disabled["shadowCrew"]["nativeMemory"]["enabled"],
            serde_json::Value::Bool(false)
        );
        assert_eq!(
            disabled["shadowCrew"]["nativeMemory"]["autoGenerate"],
            serde_json::Value::Bool(false)
        );

        let defaults = build_native_memory_prompt_meta(None, None);
        assert_eq!(
            defaults["shadowCrew"]["nativeMemory"]["enabled"],
            serde_json::Value::Bool(false)
        );
        assert_eq!(
            defaults["shadowCrew"]["nativeMemory"]["autoGenerate"],
            serde_json::Value::Bool(false)
        );
    }

    #[test]
    fn test_initialize_request_ids_are_unique() {
        use super::next_init_request_id;

        let first = next_init_request_id();
        let second = next_init_request_id();
        assert_ne!(first, second);
        assert!(second > first);
    }

    #[tokio::test]
    async fn test_initialize_twice_timeout_remains_retryable_and_recovers_capabilities() {
        use super::{execute_lazy_initialize_handshake, AcpNativeMemoryCapability};
        use std::collections::HashMap;
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::time::Duration;
        use tokio::sync::{mpsc, oneshot, Mutex as TokioMutex};

        let initialized = AtomicBool::new(false);
        let pending_requests: TokioMutex<HashMap<u64, oneshot::Sender<serde_json::Value>>> =
            TokioMutex::new(HashMap::new());
        let (stdin_tx, mut stdin_rx) = mpsc::channel::<String>(16);
        let init_error = TokioMutex::new(None::<String>);
        let status_detail = TokioMutex::new(None::<String>);
        let supports_load_session = AtomicBool::new(false);
        let supports_resume_session = AtomicBool::new(false);
        let supports_prompt_image = AtomicBool::new(false);
        let supports_embedded_context = AtomicBool::new(false);
        let native_memory_capability =
            TokioMutex::new(AcpNativeMemoryCapability::default());

        // Attempt 1 (timeout): simulates first initialize timeout
        let first_attempt = execute_lazy_initialize_handshake(
            "agent-retry-test",
            Duration::from_millis(20),
            &initialized,
            &pending_requests,
            &stdin_tx,
            &init_error,
            &status_detail,
            &supports_load_session,
            &supports_resume_session,
            &supports_prompt_image,
            &supports_embedded_context,
            &native_memory_capability,
            |_, _| {},
        )
        .await;
        assert!(first_attempt.is_err());
        assert!(!initialized.load(Ordering::SeqCst));
        assert!(pending_requests.lock().await.is_empty());
        assert_eq!(native_memory_capability.lock().await.status, "unknown");
        let first_req: serde_json::Value =
            serde_json::from_str(&stdin_rx.recv().await.unwrap()).unwrap();
        let first_id = first_req["id"].as_u64().unwrap();

        // Attempt 2 (second timeout): simulates lazy initialize timing out again
        let second_attempt = execute_lazy_initialize_handshake(
            "agent-retry-test",
            Duration::from_millis(20),
            &initialized,
            &pending_requests,
            &stdin_tx,
            &init_error,
            &status_detail,
            &supports_load_session,
            &supports_resume_session,
            &supports_prompt_image,
            &supports_embedded_context,
            &native_memory_capability,
            |_, _| {},
        )
        .await;
        assert!(second_attempt.is_err());
        assert!(
            !initialized.load(Ordering::SeqCst),
            "second initialize timeout must NOT lock initialized=true"
        );
        assert!(pending_requests.lock().await.is_empty());
        assert_eq!(native_memory_capability.lock().await.status, "unknown");
        let second_req: serde_json::Value =
            serde_json::from_str(&stdin_rx.recv().await.unwrap()).unwrap();
        let second_id = second_req["id"].as_u64().unwrap();
        assert_ne!(first_id, second_id);

        // Attempt 3 (succeeds): responds with nativeMemory enabled
        let handshake_fut = execute_lazy_initialize_handshake(
            "agent-retry-test",
            Duration::from_millis(500),
            &initialized,
            &pending_requests,
            &stdin_tx,
            &init_error,
            &status_detail,
            &supports_load_session,
            &supports_resume_session,
            &supports_prompt_image,
            &supports_embedded_context,
            &native_memory_capability,
            |_, _| {},
        );
        let responder_fut = async {
            let third_raw = stdin_rx.recv().await.unwrap();
            let third_req: serde_json::Value = serde_json::from_str(&third_raw).unwrap();
            let third_id = third_req["id"].as_u64().unwrap();
            assert_ne!(third_id, second_id);
            let tx = pending_requests.lock().await.remove(&third_id).unwrap();
            tx.send(serde_json::json!({
                "jsonrpc": "2.0",
                "id": third_id,
                "result": {
                    "agentCapabilities": {
                        "loadSession": true,
                        "nativeMemory": {
                            "supported": true,
                            "enabled": true,
                            "persistent": true,
                            "crossThread": true,
                            "provider": "codex-memories",
                            "scope": "runtime"
                        }
                    },
                    "sessionCapabilities": {
                        "resume": {}
                    }
                }
            }))
            .unwrap();
        };
        let (third_res, _) = tokio::join!(handshake_fut, responder_fut);
        assert!(third_res.is_ok());
        assert!(initialized.load(Ordering::SeqCst));
        assert!(supports_load_session.load(Ordering::SeqCst));
        assert!(supports_resume_session.load(Ordering::SeqCst));
        let cap = native_memory_capability.lock().await.clone();
        assert_eq!(cap.status, "enabled");
        assert_eq!(cap.provider.as_deref(), Some("codex-memories"));
    }

    #[test]
    fn test_is_session_invalid_error_detection() {
        use super::is_session_invalid_error;

        // 1. 标准错误码 -32001 (Session not found)
        let err_32001 = serde_json::json!({
            "code": -32001,
            "message": "Session not found: session-abc"
        });
        assert!(is_session_invalid_error(&err_32001));

        // 2. 标准错误码 -32002 (Invalid session)
        let err_32002 = serde_json::json!({
            "code": -32002,
            "message": "Session invalid or closed"
        });
        assert!(is_session_invalid_error(&err_32002));

        // 3. 错误码为通用错误，但文案明确提示 session unknown / expired
        let err_msg_unknown = serde_json::json!({
            "code": -32603,
            "message": "Unknown session identifier session-123"
        });
        assert!(is_session_invalid_error(&err_msg_unknown));

        let err_msg_expired = serde_json::json!({
            "code": -32000,
            "message": "The session expired due to timeout"
        });
        assert!(is_session_invalid_error(&err_msg_expired));

        // 4. 瞬态错误（限流、鉴权、工具失败、语法错误等）绝不误判为会话失效
        let err_rate_limit = serde_json::json!({
            "code": 429,
            "message": "Rate limit exceeded, please retry later"
        });
        assert!(!is_session_invalid_error(&err_rate_limit));

        let err_auth = serde_json::json!({
            "code": -32000,
            "message": "Authentication required: missing ANTHROPIC_API_KEY"
        });
        assert!(!is_session_invalid_error(&err_auth));

        let err_tool = serde_json::json!({
            "code": -32603,
            "message": "Tool execution failed: cargo check failed"
        });
        assert!(!is_session_invalid_error(&err_tool));
    }

    #[tokio::test]
    async fn test_clear_agent_sessions_with_generation_deletes_db_even_if_memory_empty() {
        use super::AcpProcessManager;
        use crate::db_manager::DatabaseManager;
        use std::sync::Arc;

        let db = Arc::new(DatabaseManager::new(":memory:").expect("in-memory db init"));
        db.save_acp_session(
            "agent-offline",
            "topic:chan-1:thread-1:standard",
            "sid-persisted-1",
            "",
            "/tmp/fake-cwd",
            "sp-test",
            1,
        )
        .expect("save session");

        // 验证 SQLite 中已写入该持久化记录
        let loaded = db
            .get_acp_session("agent-offline", "topic:chan-1:thread-1:standard")
            .unwrap();
        assert!(loaded.is_some());

        // 构造 AcpProcessManager，内存中无任何运行中 Agent 实例
        let manager = AcpProcessManager::with_db(db.clone());

        // 执行清理：针对指定离线 Agent
        manager
            .clear_agent_sessions_with_generation(Some("agent-offline"), Some("topic:chan-1"), None)
            .await
            .expect("clear sessions should succeed");

        // 核心断言：即使内存中无任何 Agent 实例，SQLite 记录也必须被成功清理！
        let after_clear = db
            .get_acp_session("agent-offline", "topic:chan-1:thread-1:standard")
            .unwrap();
        assert!(
            after_clear.is_none(),
            "离线 Agent 的持久化 Session 必须被无条件删除"
        );
    }

    #[test]
    fn test_check_supports_resume_session() {
        use super::check_supports_resume_session;

        let with_standard_agent_capabilities = serde_json::json!({
            "agentCapabilities": {
                "sessionCapabilities": {
                    "resume": {}
                }
            }
        });
        assert!(check_supports_resume_session(&with_standard_agent_capabilities));

        let with_session_capabilities = serde_json::json!({
            "sessionCapabilities": {
                "resume": {}
            }
        });
        assert!(check_supports_resume_session(&with_session_capabilities));

        let with_session_capabilities_bool = serde_json::json!({
            "sessionCapabilities": {
                "resume": true
            }
        });
        assert!(check_supports_resume_session(
            &with_session_capabilities_bool
        ));

        let with_capabilities_nested = serde_json::json!({
            "capabilities": {
                "sessionCapabilities": {
                    "resume": {}
                }
            }
        });
        assert!(check_supports_resume_session(&with_capabilities_nested));

        let with_capabilities_resume = serde_json::json!({
            "capabilities": {
                "resume": true
            }
        });
        assert!(check_supports_resume_session(&with_capabilities_resume));

        let without_support = serde_json::json!({
            "capabilities": {
                "prompts": { "listChanged": true }
            }
        });
        assert!(!check_supports_resume_session(&without_support));
    }

    #[test]
    fn test_ensure_session_result_serialization() {
        use super::EnsureSessionResult;

        let res = EnsureSessionResult {
            session_id: "sid-123".to_string(),
            is_new: true,
            load_failed: false,
            recovery_mode: Some("resume".to_string()),
        };
        let json_val = serde_json::to_value(&res).unwrap();
        assert_eq!(json_val["sessionId"], "sid-123");
        assert_eq!(json_val["isNew"], true);
        assert_eq!(json_val["loadFailed"], false);
        assert_eq!(json_val["recoveryMode"], "resume");
    }

    #[test]
    fn test_maybe_refresh_native_memory_capability_on_prompt_result() {
        use super::maybe_refresh_native_memory_capability;

        let plain_prompt_result = serde_json::json!({
            "text_response": "OK",
            "stopReason": "completed"
        });
        assert!(maybe_refresh_native_memory_capability(&plain_prompt_result).is_none());

        let recovered_prompt_result = serde_json::json!({
            "text_response": "OK",
            "stopReason": "completed",
            "agentCapabilities": {
                "nativeMemory": {
                    "supported": true,
                    "enabled": true,
                    "persistent": true,
                    "crossThread": true,
                    "provider": "codex-memories",
                    "scope": "runtime"
                }
            }
        });
        let refreshed =
            maybe_refresh_native_memory_capability(&recovered_prompt_result).unwrap();
        assert_eq!(refreshed.status, "enabled");
        assert_eq!(refreshed.provider.as_deref(), Some("codex-memories"));
    }
}
