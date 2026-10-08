mod llm;
mod mcp_client;
mod memory;

use anyhow::Result;
use memory::AgentMemoryStore;
use shinobi_protocol::{AcpPromptResult, MemoryTrace};
use std::io::{self, BufRead, Write};
use std::sync::Arc;

#[tokio::main]
async fn main() -> Result<()> {
    // 实例化私有持久化 SQLite 记忆引擎 (每个开发者的影替身独立持有一份，支持通过环境变量沙盒化隔离)
    let db_path = std::env::var("SHINOBI_MEMORY_DB").unwrap_or_else(|_| "shinobi_agent_memory.db".to_string());
    let memory_store = AgentMemoryStore::new(&db_path)?;

    // 若使用的是默认主数据库，写入初始替身认知
    if db_path == "shinobi_agent_memory.db" {
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

    let stdin = io::stdin();
    let stdout_shared = Arc::new(std::sync::Mutex::new(io::stdout()));
    let reader = stdin.lock();

    // 底座模型配置由宿主通过 SHADOW_CREW_LLM_* 环境变量注入
    let llm_config = llm::LlmConfig::from_env();
    let mut session_system_prompt: Option<String> = None;
    let mut mcp_client: Option<mcp_client::SharedMcpClient> = None;
    let mut session_cwd: Option<String> = None;

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
                        "agentInfo": { "name": "shinobi-agent", "version": "0.1.0" },
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
                session_system_prompt = params
                    .get("systemPrompt")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());

                if let Some(cwd_str) = params.get("cwd").and_then(|v| v.as_str()) {
                    session_cwd = Some(cwd_str.to_string());
                }

                // 连接 Shinobi 原生内置 MCP 工具服务 (shinobi-dev-mcp)
                if mcp_client.is_none() {
                    match mcp_client::NativeMcpClient::spawn_and_connect(session_cwd.as_deref()).await {
                        Ok(client) => {
                            let tool_names: Vec<String> = client
                                .get_tools()
                                .iter()
                                .filter_map(|t| t["name"].as_str().map(|s| s.to_string()))
                                .collect();
                            eprintln!(
                                "[Shinobi Agent] 原生内置 MCP (shinobi-dev-mcp) 挂载成功，可用工具: {:?}",
                                tool_names
                            );
                            mcp_client = Some(Arc::new(tokio::sync::Mutex::new(client)));
                        }
                        Err(e) => {
                            eprintln!(
                                "[Shinobi Agent] 挂载内置原生 MCP 工具失败 (自动降级为纯文本推演): {:#}",
                                e
                            );
                        }
                    }
                }

                let resp = serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "result": {
                        "sessionId": "shinobi-session-default"
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

                // 若此前未能启动 MCP，在 prompt 接收时尝试二次懒加载挂载
                if mcp_client.is_none() {
                    if let Ok(client) = mcp_client::NativeMcpClient::spawn_and_connect(session_cwd.as_deref()).await {
                        mcp_client = Some(Arc::new(tokio::sync::Mutex::new(client)));
                    }
                }
                
                // 1. 从私有记忆库召回关键知识
                let recalled = memory_store.recall_relevant(query).unwrap_or_default();
                let mut memory_traces = Vec::new();
                for r in &recalled {
                    memory_traces.push(MemoryTrace {
                        action: "recall".to_string(),
                        key: r.key.clone(),
                        detail: r.content.clone(),
                    });
                }

                // 2. 以人设 + 召回记忆为上下文，调用底座模型进行真实推演与 MCP 工具执行
                let mut system_prompt = session_system_prompt.clone().unwrap_or_else(|| {
                    "你是 Shinobi，用户的 AI 影替身，代表主人参与技术架构推演与代码审查。请给出专业、严谨、可落地的回答。".to_string()
                });
                if !recalled.is_empty() {
                    system_prompt.push_str("\n\n[私有记忆库召回的专属规范，推演时必须遵循]:\n");
                    for r in &recalled {
                        system_prompt.push_str(&format!("- ({}) {}\n", r.key, r.content));
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

                        match llm::complete_with_tools(cfg, &system_prompt, query, mcp_client.clone(), on_tool_step).await {
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
