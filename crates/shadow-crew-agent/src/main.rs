mod llm;
mod mcp_client;
mod memory;

use anyhow::Result;
use memory::AgentMemoryStore;
use shadow_crew_protocol::{AcpPromptResult, MemoryTrace};
use std::collections::HashMap;
use std::io::{self, BufRead, Write};
use std::path::PathBuf;
use std::sync::Arc;

struct SessionState {
    #[allow(dead_code)]
    session_id: String,
    #[allow(dead_code)]
    session_key: String,
    #[allow(dead_code)]
    channel_id: String,
    workspace_dir: PathBuf,
    system_prompt: Option<String>,
    mcp_client: Option<mcp_client::SharedMcpClient>,
}

/// 纯粹基于路径组件的规范化函数，消除 . 与 .. 相对段，不依赖底层文件系统实际存在
pub fn normalize_path(path: &std::path::Path) -> PathBuf {
    use std::path::Component;
    let mut out = PathBuf::new();
    for comp in path.components() {
        match comp {
            Component::Prefix(p) => out.push(Component::Prefix(p)),
            Component::RootDir => out.push(Component::RootDir),
            Component::CurDir => {},
            Component::ParentDir => {
                out.pop();
            },
            Component::Normal(c) => out.push(c),
        }
    }
    out
}

/// 解析用户级全局 Shadow Crew 根目录 (~/.shadow-crew)
fn get_shadow_crew_home_dir() -> std::path::PathBuf {
    let base = std::env::var("SHADOW_CREW_HOME")
        .or_else(|_| std::env::var("SHINOBI_HOME"))
        .ok()
        .map(std::path::PathBuf::from)
        .or_else(|| {
            if cfg!(target_os = "windows") {
                std::env::var("USERPROFILE").ok().map(std::path::PathBuf::from)
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

/// 解析并创建指定频道的独立私有工作区 (~/.shadow-crew/channels/<channel_id>)
fn get_channel_dir(channel_id: &str) -> std::path::PathBuf {
    let clean_id = if channel_id.trim().is_empty() {
        "chan-default"
    } else {
        channel_id.trim()
    };
    let channels_dir = get_shadow_crew_home_dir().join("channels").join(clean_id);
    let _ = std::fs::create_dir_all(&channels_dir);
    let _ = std::fs::create_dir_all(channels_dir.join("artifacts"));
    let _ = std::fs::create_dir_all(channels_dir.join("scratch"));
    channels_dir
}

/// 解析并创建指定 Agent 的独立私有工作区 (~/.shadow-crew/agents/<agent_id>)
fn get_agent_dir(agent_id: &str) -> std::path::PathBuf {
    let clean_id = if agent_id.trim().is_empty() {
        "agent-default"
    } else {
        agent_id.trim()
    };
    let agents_dir = get_shadow_crew_home_dir().join("agents").join(clean_id);
    let _ = std::fs::create_dir_all(&agents_dir);
    let _ = std::fs::create_dir_all(agents_dir.join("artifacts"));
    let _ = std::fs::create_dir_all(agents_dir.join("scratch"));
    agents_dir
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
            home.join("global_memory.sqlite").to_string_lossy().to_string()
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

    let stdin = io::stdin();
    let stdout_shared = Arc::new(std::sync::Mutex::new(io::stdout()));
    let reader = stdin.lock();

    // 底座模型配置由宿主通过 SHADOW_CREW_LLM_* 环境变量注入
    let llm_config = llm::LlmConfig::from_env();
    let mut active_sessions: HashMap<String, SessionState> = HashMap::new();

    // 持续监听来自 Tauri 宿主或父进程的 stdio JSON-RPC 2.0 请求
    for line in reader.lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }

        if let Ok(json_req) = serde_json::from_str::<serde_json::Value>(&line) {
            let id = json_req.get("id").cloned().unwrap_or(serde_json::json!(1));
            let method = json_req.get("method").and_then(|v| v.as_str()).unwrap_or("session/prompt");
            let params = json_req.get("params").cloned().unwrap_or(serde_json::json!({}));

            if method == "initialize" {
                let resp = serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "result": {
                        "protocolVersion": "2025-01-01",
                        "agentInfo": { "name": "shadow-crew-agent", "version": "0.1.0" },
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
                let session_key = params.get("sessionKey").and_then(|v| v.as_str()).map(|s| s.to_string());
                let cid = params.get("channelId").and_then(|v| v.as_str()).filter(|s| !s.trim().is_empty()).map(|s| s.trim().to_string());
                let session_channel_id = cid.unwrap_or_else(|| "chan-default".to_string());

                let env_agent_id = std::env::var("SHADOW_CREW_AGENT_ID").ok();
                let maybe_agent_id = params
                    .get("agentId")
                    .and_then(|v| v.as_str())
                    .or(env_agent_id.as_deref());

                let is_dm = maybe_agent_id.is_some()
                    || session_channel_id.starts_with("dm-")
                    || session_channel_id == "direct-messages";

                // 沙箱归属校验与路径规范化：杜绝绝对路径越界或 .. 路径穿越攻击
                let target_workspace_dir = {
                    let candidate = if let Some(cwd) = params.get("cwd").and_then(|v| v.as_str()) {
                        let trimmed = cwd.trim();
                        let expanded = if trimmed.starts_with("~/") || trimmed == "~" {
                            let user_home = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).unwrap_or_default();
                            trimmed.replacen('~', &user_home, 1)
                        } else {
                            trimmed.to_string()
                        };
                        let p = PathBuf::from(expanded);
                        if p.is_relative() { shadow_crew_home.join(p) } else { p }
                    } else if is_dm {
                        let aid = maybe_agent_id.unwrap_or("agent-default");
                        get_agent_dir(aid)
                    } else {
                        get_channel_dir(&session_channel_id)
                    };

                    let norm_candidate = normalize_path(&candidate);
                    let norm_home = normalize_path(&shadow_crew_home);

                    if norm_candidate.starts_with(&norm_home) {
                        candidate
                    } else {
                        eprintln!(
                            "[Shinobi Agent] ⚠️ 检测到非法工作区路径尝试越界 (cwd: {:?})，已强制收敛至安全沙箱目录",
                            candidate
                        );
                        if is_dm {
                            let aid = maybe_agent_id.unwrap_or("agent-default");
                            get_agent_dir(aid)
                        } else {
                            get_channel_dir(&session_channel_id)
                        }
                    }
                };

                let channel_cwd_str = target_workspace_dir.to_string_lossy().to_string();
                let _ = std::fs::create_dir_all(&target_workspace_dir);
                let _ = std::fs::create_dir_all(target_workspace_dir.join("artifacts"));
                let _ = std::fs::create_dir_all(target_workspace_dir.join("scratch"));
                let _ = std::env::set_current_dir(&target_workspace_dir);

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

                // 专属会话级 MCP 工具隔离挂载：独立绑定当前会话工作区，绝不跨会话或全局复用
                let mcp_key = if is_dm {
                    let aid = maybe_agent_id.unwrap_or("agent-default");
                    format!("agent:{}", aid)
                } else {
                    session_channel_id.clone()
                };

                let chan_param = if is_dm { None } else { Some(session_channel_id.as_str()) };
                let session_mcp = match mcp_client::NativeMcpClient::spawn_and_connect(Some(&channel_cwd_str), chan_param).await {
                    Ok(client) => {
                        let tool_names: Vec<String> = client
                            .get_tools()
                            .iter()
                            .filter_map(|t| t["name"].as_str().map(|s| s.to_string()))
                            .collect();
                        eprintln!(
                            "[Shinobi Agent] 原生内置 MCP (shinobi-dev-mcp) 挂载成功 (key={}, cwd={})，可用工具: {:?}",
                            mcp_key,
                            channel_cwd_str,
                            tool_names
                        );
                        Some(Arc::new(tokio::sync::Mutex::new(client)))
                    }
                    Err(e) => {
                        eprintln!(
                            "[Shinobi Agent] 挂载内置原生 MCP 工具失败 (当前会话降级为纯文本推演，绝不串用其他工作区 MCP): {:#}",
                            e
                        );
                        None
                    }
                };

                let effective_key = session_key.unwrap_or_else(|| {
                    if is_dm {
                        let aid = maybe_agent_id.unwrap_or("agent-default");
                        format!("dm:{}:thread", aid)
                    } else {
                        format!("topic:{}:chan:standard", session_channel_id)
                    }
                });
                let unique_session_id = format!("shinobi-session-{}", effective_key);

                active_sessions.insert(
                    unique_session_id.clone(),
                    SessionState {
                        session_id: unique_session_id.clone(),
                        session_key: effective_key,
                        channel_id: session_channel_id.clone(),
                        workspace_dir: target_workspace_dir,
                        system_prompt: sp,
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
            } else if method == "session/close" {
                if let Some(close_sid) = params.get("sessionId").and_then(|v| v.as_str()) {
                    active_sessions.remove(close_sid);
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
                let prompt_sid = match params.get("sessionId").and_then(|v| v.as_str()).filter(|s| !s.trim().is_empty()) {
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
                let session_state = match active_sessions.get_mut(&prompt_sid) {
                    Some(st) => st,
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

                let query = if let Some(prompt_arr) = params.get("prompt").and_then(|v| v.as_array()) {
                    prompt_arr.iter()
                        .find_map(|b| b.get("text").and_then(|t| t.as_str()))
                        .unwrap_or_default()
                } else {
                    params.get("user_query")
                        .or_else(|| params.get("prompt"))
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                };

                if let Some(prompt_sp) = params.get("systemPrompt").and_then(|v| v.as_str()) {
                    if !prompt_sp.trim().is_empty() {
                        session_state.system_prompt = Some(prompt_sp.to_string());
                    }
                }

                let current_workspace_dir = session_state.workspace_dir.clone();
                let current_workspace_cwd = current_workspace_dir.to_string_lossy().to_string();
                let _ = std::env::set_current_dir(&current_workspace_dir);

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

                // 严格会话物理隔离：仅使用该 Session 专属的 MCP 客户端，绝不跨会话或全局复用
                let current_mcp_client = session_state.mcp_client.clone();
                
                // 1. 从私有记忆库召回关键知识 (全局核心认知 + 本地私有知识)
                let mut recalled = memory_store.recall_relevant(query).unwrap_or_default();
                let local_mem_path = current_workspace_dir.join("memory.sqlite").to_string_lossy().to_string();
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
                let mut system_prompt = active_sp.unwrap_or_else(|| {
                    "你是 Shinobi，用户的 AI 影替身，代表主人参与技术架构推演与代码审查。请给出专业、严谨、可落地的回答。".to_string()
                });
                if !recalled.is_empty() {
                    system_prompt.push_str("\n\n[私有记忆库召回的专属规范，推演时必须遵循]:\n");
                    for r in &recalled {
                        system_prompt.push_str(&format!("- ({}) {}\n", r.key, r.content));
                    }
                }

                let is_dm_session = session_state.session_key.starts_with("dm:") || session_state.channel_id.starts_with("dm-");
                let artifacts_dir = current_workspace_dir.join("artifacts").to_string_lossy().to_string();
                let scratch_dir = current_workspace_dir.join("scratch").to_string_lossy().to_string();
                if !system_prompt.contains("[当前频道专属工作空间环境]") && !system_prompt.contains("[当前 Agent 个人专属独立工作空间环境]") {
                    if is_dm_session {
                        system_prompt.push_str(&format!(
                            "\n\n[当前 Agent 个人专属独立工作空间环境]:\n- Session Key: {}\n- Agent 独立工作区根目录 (Working Directory / cwd): {}\n- 专属落地产物目录 (Artifacts): {}\n- 专属临时调试目录 (Scratch): {}\n提示: 您当前处于与用户的 1-on-1 私聊中，沉淀的正式技术推演文档、方案或代码 Patch 将安全保存至您个人的专属产物目录中，与频道(channels)业务及其他 Agent 物理隔离。\n",
                            session_state.session_key,
                            current_workspace_cwd,
                            artifacts_dir,
                            scratch_dir
                        ));
                    } else {
                        system_prompt.push_str(&format!(
                            "\n\n[当前频道专属工作空间环境]:\n- 频道 ID: {}\n- 频道独立工作区根目录 (Working Directory / cwd): {}\n- 落地产物目录 (Artifacts): {}\n- 临时调试目录 (Scratch): {}\n提示: 如需沉淀正式技术推演文档、ADR 架构决策或代码 Patch，请优先调用 `write_channel_artifact` 工具安全保存至频道专属产物目录。\n",
                            session_state.channel_id,
                            current_workspace_cwd,
                            artifacts_dir,
                            scratch_dir
                        ));
                    }
                }

                let session_id_owned = prompt_sid.clone();
                let sid_for_tool = prompt_sid.clone();
                let stdout_clone = stdout_shared.clone();

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

                        match llm::complete_with_tools(cfg, &system_prompt, query, current_mcp_client.clone(), on_tool_step).await {
                            Ok(res) => res,
                            Err(e) => llm::LlmExecutionResult {
                                text_response: format!("⚠️ Shinobi 底座模型推演失败：{:#}", e),
                                mcp_tool_calls: vec![],
                            },
                        }
                    }
                };

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
}
