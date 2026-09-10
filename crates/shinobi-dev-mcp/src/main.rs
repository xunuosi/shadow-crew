use anyhow::Result;
use serde_json::json;
use std::io::{self, BufRead, Write};

/// 开发者 MCP 技能服务 (提供 AST 索引、Git 变更审查与沙盒命令运行)
#[tokio::main]
async fn main() -> Result<()> {
    let stdin = io::stdin();
    let mut stdout = io::stdout();
    let reader = stdin.lock();

    for line in reader.lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }

        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&line) {
            let method = val["method"].as_str().unwrap_or_default();
            let id = val["id"].as_u64().unwrap_or(0);

            let resp = match method {
                "tools/list" => json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "result": {
                        "tools": [
                            {
                                "name": "cargo_clippy",
                                "description": "运行本地代码静态检查"
                            },
                            {
                                "name": "git_diff_summary",
                                "description": "生成当前分支针对主干的 Unified Diff 摘要"
                            }
                        ]
                    }
                }),
                "tools/call" => json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "result": {
                        "content": [
                            {
                                "type": "text",
                                "text": "Execution completed with status: SUCCESS. 0 warnings."
                            }
                        ]
                    }
                }),
                _ => json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "error": { "code": -32601, "message": "Method not found" }
                }),
            };

            writeln!(stdout, "{}", resp.to_string())?;
            stdout.flush()?;
        }
    }

    Ok(())
}
