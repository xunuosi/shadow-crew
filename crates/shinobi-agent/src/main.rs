mod memory;

use anyhow::Result;
use memory::AgentMemoryStore;
use shinobi_protocol::{AcpPromptResult, MemoryTrace};
use std::io::{self, BufRead, Write};

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
    let mut stdout = io::stdout();
    let reader = stdin.lock();

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
                writeln!(stdout, "{}", resp.to_string())?;
                stdout.flush()?;
            } else if method == "session/new" {
                let resp = serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "result": {
                        "sessionId": "shinobi-session-default"
                    }
                });
                writeln!(stdout, "{}", resp.to_string())?;
                stdout.flush()?;
            } else if method == "memory/all" {
                let all_records = memory_store.get_all().unwrap_or_default();
                let resp = serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "result": {
                        "memories": all_records
                    }
                });
                writeln!(stdout, "{}", resp.to_string())?;
                stdout.flush()?;
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

                // 2. 生成结构化响应
                let display_query = if query.chars().count() > 30 {
                    format!("{}...", query.chars().take(30).collect::<String>())
                } else if query.is_empty() {
                    "ACP 连通性测试".to_string()
                } else {
                    query.to_string()
                };

                let response_text = format!(
                    "【Shinobi 替身响应】已从私有记忆库召回 {} 条专属规范，针对「{}」推演完成：\n\n• **链路状态**：本地 ACP Stdio JSON-RPC 2.0 管道运行正常，通信端对端畅通。\n• **工作区挂载**：已就绪，随时可执行架构分析、任务推演与代码评审。",
                    recalled.len(),
                    display_query
                );

                let session_id = params.get("sessionId").and_then(|v| v.as_str()).unwrap_or("shinobi-session-default");
                let chunk_notification = serde_json::json!({
                    "jsonrpc": "2.0",
                    "method": "session/update",
                    "params": {
                        "sessionId": session_id,
                        "update": {
                            "sessionUpdate": "agent_message_chunk",
                            "content": {
                                "type": "text",
                                "text": &response_text
                            }
                        }
                    }
                });
                let _ = writeln!(stdout, "{}", chunk_notification.to_string());
                let _ = stdout.flush();

                let result = AcpPromptResult {
                    text_response: response_text,
                    memory_actions: memory_traces,
                    workspace_diffs: vec![],
                    mcp_tool_calls: vec![],
                };

                let resp = serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "result": result
                });

                writeln!(stdout, "{}", resp.to_string())?;
                stdout.flush()?;
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
                writeln!(stdout, "{}", resp.to_string())?;
                stdout.flush()?;
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
            writeln!(stdout, "{}", resp.to_string())?;
            stdout.flush()?;
        }
    }

    Ok(())
}
