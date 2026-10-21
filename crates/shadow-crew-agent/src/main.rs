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
    let mut session_system_prompt: Option<String> = None;
    let mut mcp_client: Option<mcp_client::SharedMcpClient> = None;
    let mut mcp_client_channel: Option<String> = None;
    let mut session_channel_id = "chan-default".to_string();
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
                if let Some(cid) = params.get("channelId").and_then(|v| v.as_str()) {
                    if !cid.trim().is_empty() {
                        session_channel_id = cid.trim().to_string();
                    }
                }

                let env_agent_id = std::env::var("SHADOW_CREW_AGENT_ID").ok();
                let maybe_agent_id = params
                    .get("agentId")
                    .and_then(|v| v.as_str())
                    .or(env_agent_id.as_deref());

                let is_dm = maybe_agent_id.is_some()
                    || session_channel_id.starts_with("dm-")
                    || session_channel_id == "direct-messages";

                let target_workspace_dir = if let Some(cwd) = params.get("cwd").and_then(|v| v.as_str()) {
                    let p = PathBuf::from(cwd);
                    if p.is_relative() { shadow_crew_home.join(p) } else { p }
                } else if is_dm {
                    let aid = maybe_agent_id.unwrap_or("agent-default");
                    get_agent_dir(aid)
                } else {
                    get_channel_dir(&session_channel_id)
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

                session_system_prompt = params
                    .get("systemPrompt")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());

                // 连接或切换 Shinobi 原生内置 MCP 工具服务 (shinobi-dev-mcp)，将其工作目录严格锚定在当前频道独立工作空间
                let mcp_key = if is_dm {
                    let aid = maybe_agent_id.unwrap_or("agent-default");
                    format!("agent:{}", aid)
                } else {
                    session_channel_id.clone()
                };

                if mcp_client.is_none() || mcp_client_channel.as_deref() != Some(mcp_key.as_str()) {
                    let chan_param = if is_dm { None } else { Some(session_channel_id.as_str()) };
                    match mcp_client::NativeMcpClient::spawn_and_connect(Some(&channel_cwd_str), chan_param).await {
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
                            mcp_client = Some(Arc::new(tokio::sync::Mutex::new(client)));
                            mcp_client_channel = Some(mcp_key);
                        }
                        Err(e) => {
                            eprintln!(
                                "[Shinobi Agent] 挂载内置原生 MCP 工具失败 (自动降级为纯文本推演): {:#}",
                                e
                            );
                        }
                    }
                }

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
                        system_prompt: session_system_prompt.clone(),
                        mcp_client: mcp_client.clone(),
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

                let prompt_sid = params.get("sessionId").and_then(|v| v.as_str()).unwrap_or("shinobi-session-default");
                let prompt_channel_id = params
                    .get("channelId")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.trim().is_empty())
                    .map(|s| s.trim().to_string())
                    .unwrap_or_else(|| session_channel_id.clone());

                if let Some(prompt_sp) = params.get("systemPrompt").and_then(|v| v.as_str()) {
                    if !prompt_sp.trim().is_empty() {
                        session_system_prompt = Some(prompt_sp.to_string());
                        if let Some(st) = active_sessions.get_mut(prompt_sid) {
                            st.system_prompt = Some(prompt_sp.to_string());
                        }
                    }
                }

                let env_agent_id = std::env::var("SHADOW_CREW_AGENT_ID").ok();
                let maybe_agent_id = params
                    .get("agentId")
                    .and_then(|v| v.as_str())
                    .or(env_agent_id.as_deref());

                let is_dm = maybe_agent_id.is_some()
                    || prompt_channel_id.starts_with("dm-")
                    || prompt_channel_id == "direct-messages"
                    || prompt_channel_id.is_empty();

                let (current_workspace_dir, is_dm_session, current_agent_id) = if let Some(st) = active_sessions.get(prompt_sid) {
                    (st.workspace_dir.clone(), is_dm, maybe_agent_id.unwrap_or("agent-default").to_string())
                } else if is_dm {
                    let agent_id = maybe_agent_id.unwrap_or_else(|| {
                        if prompt_channel_id.starts_with("dm-") {
                            prompt_channel_id.trim_start_matches("dm-")
                        } else {
                            "agent-default"
                        }
                    });
                    (get_agent_dir(agent_id), true, agent_id.to_string())
                } else {
                    (get_channel_dir(&prompt_channel_id), false, String::new())
                };
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

                // 若此前未能启动 MCP 或切换了活跃工作区，重新绑定当前专属工作空间
                let current_mcp_client = if let Some(st) = active_sessions.get(prompt_sid) {
                    if st.mcp_client.is_some() {
                        st.mcp_client.clone()
                    } else {
                        mcp_client.clone()
                    }
                } else {
                    let mcp_key = if is_dm_session { format!("agent:{}", current_agent_id) } else { prompt_channel_id.clone() };
                    if mcp_client.is_none() || mcp_client_channel.as_deref() != Some(mcp_key.as_str()) {
                        let chan_param = if is_dm_session { None } else { Some(prompt_channel_id.as_str()) };
                        if let Ok(client) = mcp_client::NativeMcpClient::spawn_and_connect(Some(&current_workspace_cwd), chan_param).await {
                            mcp_client = Some(Arc::new(tokio::sync::Mutex::new(client)));
                            mcp_client_channel = Some(mcp_key);
                        }
                    }
                    mcp_client.clone()
                };
                
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
                let active_sp = active_sessions.get(prompt_sid).and_then(|s| s.system_prompt.clone()).or_else(|| session_system_prompt.clone());
                let mut system_prompt = active_sp.unwrap_or_else(|| {
                    "你是 Shinobi，用户的 AI 影替身，代表主人参与技术架构推演与代码审查。请给出专业、严谨、可落地的回答。".to_string()
                });
                if !recalled.is_empty() {
                    system_prompt.push_str("\n\n[私有记忆库召回的专属规范，推演时必须遵循]:\n");
                    for r in &recalled {
                        system_prompt.push_str(&format!("- ({}) {}\n", r.key, r.content));
                    }
                }

                let artifacts_dir = current_workspace_dir.join("artifacts").to_string_lossy().to_string();
                let scratch_dir = current_workspace_dir.join("scratch").to_string_lossy().to_string();
                if !system_prompt.contains("[当前频道专属工作空间环境]") && !system_prompt.contains("[当前 Agent 个人专属独立工作空间环境]") {
                    if is_dm_session {
                        system_prompt.push_str(&format!(
                            "\n\n[当前 Agent 个人专属独立工作空间环境]:\n- Agent ID: {}\n- Agent 独立工作区根目录 (Working Directory / cwd): {}\n- 专属落地产物目录 (Artifacts): {}\n- 专属临时调试目录 (Scratch): {}\n提示: 您当前处于与用户的 1-on-1 私聊中，沉淀的正式技术推演文档、方案或代码 Patch 将安全保存至您个人的专属产物目录中，与频道(channels)业务及其他 Agent 物理隔离。\n",
                            current_agent_id,
                            current_workspace_cwd,
                            artifacts_dir,
                            scratch_dir
                        ));
                    } else {
                        system_prompt.push_str(&format!(
                            "\n\n[当前频道专属工作空间环境]:\n- 频道 ID: {}\n- 频道独立工作区根目录 (Working Directory / cwd): {}\n- 落地产物目录 (Artifacts): {}\n- 临时调试目录 (Scratch): {}\n提示: 如需沉淀正式技术推演文档、ADR 架构决策或代码 Patch，请优先调用 `write_channel_artifact` 工具安全保存至频道专属产物目录。\n",
                            prompt_channel_id,
                            current_workspace_cwd,
                            artifacts_dir,
                            scratch_dir
                        ));
                    }
                }

                let session_id = params.get("sessionId").and_then(|v| v.as_str()).unwrap_or("shinobi-session-default");
                let session_id_owned = session_id.to_string();
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
                                    "sessionId": &session_id_owned,
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
                        "sessionId": session_id,
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
