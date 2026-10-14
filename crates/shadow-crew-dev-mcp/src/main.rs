mod tools;

use anyhow::Result;
use serde_json::json;
use std::io::{self, BufRead, Write};

/// Shinobi 原生内置开发工具 MCP 服务 (支持 shell / read_file / write_file / str_replace / search_code / list_dir)
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
            let id = val.get("id").cloned();

            // 若为通知消息 (Notification, 无 id)，处理后不回复
            if id.is_none() {
                continue;
            }
            let req_id = id.unwrap();

            match method {
                "initialize" => {
                    let resp = json!({
                        "jsonrpc": "2.0",
                        "id": req_id,
                        "result": {
                            "protocolVersion": "2024-11-05",
                            "serverInfo": {
                                "name": "shinobi-dev-mcp",
                                "version": "0.1.0"
                            },
                            "capabilities": {
                                "tools": {
                                    "listChanged": false
                                }
                            }
                        }
                    });
                    writeln!(stdout, "{}", resp)?;
                    stdout.flush()?;
                }
                "tools/list" => {
                    let resp = json!({
                        "jsonrpc": "2.0",
                        "id": req_id,
                        "result": {
                            "tools": tools::get_tools_list()
                        }
                    });
                    writeln!(stdout, "{}", resp)?;
                    stdout.flush()?;
                }
                "tools/call" => {
                    let params = &val["params"];
                    let tool_name = params["name"].as_str().unwrap_or_default();
                    let arguments = &params["arguments"];

                    let call_result = tools::dispatch_tool_call(tool_name, arguments).await;

                    let resp = match call_result {
                        Ok(output_text) => json!({
                            "jsonrpc": "2.0",
                            "id": req_id,
                            "result": {
                                "content": [
                                    {
                                        "type": "text",
                                        "text": output_text
                                    }
                                ],
                                "isError": false
                            }
                        }),
                        Err(e) => json!({
                            "jsonrpc": "2.0",
                            "id": req_id,
                            "result": {
                                "content": [
                                    {
                                        "type": "text",
                                        "text": format!("执行工具 [{}] 出错: {:#}", tool_name, e)
                                    }
                                ],
                                "isError": true
                            }
                        }),
                    };

                    writeln!(stdout, "{}", resp)?;
                    stdout.flush()?;
                }
                "ping" => {
                    let resp = json!({
                        "jsonrpc": "2.0",
                        "id": req_id,
                        "result": {}
                    });
                    writeln!(stdout, "{}", resp)?;
                    stdout.flush()?;
                }
                _ => {
                    let resp = json!({
                        "jsonrpc": "2.0",
                        "id": req_id,
                        "error": {
                            "code": -32601,
                            "message": format!("未支持的 MCP 方法: {}", method)
                        }
                    });
                    writeln!(stdout, "{}", resp)?;
                    stdout.flush()?;
                }
            }
        }
    }

    Ok(())
}
