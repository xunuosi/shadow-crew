mod memory;

use anyhow::Result;
use memory::AgentMemoryStore;
use shinobi_protocol::{AcpPromptResult, JsonRpcRequest, MemoryTrace};
use std::io::{self, BufRead, Write};

#[tokio::main]
async fn main() -> Result<()> {
    // 实例化私有持久化 SQLite 记忆引擎 (每个开发者的影替身独立持有一份)
    let memory_store = AgentMemoryStore::new("shinobi_agent_memory.db")?;

    // 默认写入初始替身认知
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

    let stdin = io::stdin();
    let mut stdout = io::stdout();
    let reader = stdin.lock();

    // 持续监听来自 Tauri 宿主或父进程的 stdio JSON-RPC 2.0 请求
    for line in reader.lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }

        if let Ok(req) = serde_json::from_str::<JsonRpcRequest<serde_json::Value>>(&line) {
            if req.method == "session/prompt" {
                let query = req.params["user_query"].as_str().unwrap_or_default();
                
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

                // 2. 模拟逐字流式返回
                let response_text = format!(
                    "【Shinobi 替身响应】已从私有记忆库召回 {} 条专属规范，针对当前问题推演完成。",
                    recalled.len()
                );

                let result = AcpPromptResult {
                    text_response: response_text,
                    memory_actions: memory_traces,
                    workspace_diffs: vec![],
                    mcp_tool_calls: vec![],
                };

                let resp = serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": req.id,
                    "result": result
                });

                writeln!(stdout, "{}", resp.to_string())?;
                stdout.flush()?;
            }
        }
    }

    Ok(())
}
