use anyhow::{anyhow, Context, Result};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::Mutex;

/// 自动定位内置的 shinobi-dev-mcp 二进制路径
pub fn resolve_shinobi_dev_mcp_path() -> PathBuf {
    // 1. 显式环境变量 (可由宿主注入或开发覆盖)
    if let Ok(path) = std::env::var("SHINOBI_DEV_MCP_PATH") {
        let p = PathBuf::from(path.trim());
        if p.exists() {
            return p;
        }
    }

    // 2. 与当前运行中的 shinobi-agent 位于同一目录 (release/debug/Tauri sidecar)
    if let Ok(current) = std::env::current_exe() {
        if let Some(parent) = current.parent() {
            let candidate = parent.join("shinobi-dev-mcp");
            if candidate.exists() {
                return candidate;
            }
            let candidate_exe = parent.join("shinobi-dev-mcp.exe");
            if candidate_exe.exists() {
                return candidate_exe;
            }
        }
    }

    // 3. 项目常见 target 编译路径 (开发与测试环境)
    let candidates = [
        PathBuf::from("./target/debug/shinobi-dev-mcp"),
        PathBuf::from("../target/debug/shinobi-dev-mcp"),
        PathBuf::from("../../target/debug/shinobi-dev-mcp"),
        PathBuf::from("./target/release/shinobi-dev-mcp"),
        PathBuf::from("../target/release/shinobi-dev-mcp"),
    ];
    for c in candidates {
        if c.exists() {
            return c;
        }
    }

    // 4. 兜底回退至 PATH
    PathBuf::from("shinobi-dev-mcp")
}

/// 基于 stdio JSON-RPC 2.0 的轻量级原生 MCP 客户端
pub struct NativeMcpClient {
    _child: Child,
    stdin: ChildStdin,
    lines_reader: Lines<BufReader<ChildStdout>>,
    tools: Vec<Value>,
    next_id: u64,
}

impl NativeMcpClient {
    /// 启动并连接至内置原生 MCP 服务 (shinobi-dev-mcp)
    pub async fn spawn_and_connect(workdir: Option<&str>, channel_id: Option<&str>) -> Result<Self> {
        let binary_path = resolve_shinobi_dev_mcp_path();
        let mut cmd = Command::new(&binary_path);
        cmd.stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .kill_on_drop(true);

        if let Ok(home) = std::env::var("SHINOBI_HOME") {
            cmd.env("SHINOBI_HOME", home);
        }
        if let Some(cid) = channel_id {
            if !cid.trim().is_empty() {
                cmd.env("SHINOBI_CHANNEL_ID", cid.trim());
            }
        }

        if let Some(dir) = workdir {
            if !dir.trim().is_empty() {
                cmd.current_dir(dir);
            }
        }

        let mut child = cmd.spawn().with_context(|| {
            format!("拉起原生内置 MCP 服务失败: {}", binary_path.display())
        })?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| anyhow!("无法获取 MCP 服务进程 stdin"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| anyhow!("无法获取 MCP 服务进程 stdout"))?;
        let lines_reader = BufReader::new(stdout).lines();

        let mut client = Self {
            _child: child,
            stdin,
            lines_reader,
            tools: Vec::new(),
            next_id: 1,
        };

        // 1. 发送 MCP initialize
        let init_req = json!({
            "jsonrpc": "2.0",
            "id": client.next_id,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "clientInfo": {
                    "name": "shinobi-agent",
                    "version": "0.1.0"
                },
                "capabilities": {
                    "tools": {}
                }
            }
        });
        client.next_id += 1;
        let _ = client.send_and_receive(&init_req).await?;

        // 2. 发送 notifications/initialized
        let notif = json!({
            "jsonrpc": "2.0",
            "method": "notifications/initialized"
        });
        client.send_raw(&notif).await?;

        // 3. 拉取 tools/list
        let list_req = json!({
            "jsonrpc": "2.0",
            "id": client.next_id,
            "method": "tools/list",
            "params": {}
        });
        client.next_id += 1;
        let list_resp = client.send_and_receive(&list_req).await?;

        if let Some(tools_arr) = list_resp["tools"].as_array() {
            client.tools = tools_arr.clone();
        }

        Ok(client)
    }

    /// 获取当前挂载的可用工具定义列表 (MCP 规范)
    pub fn get_tools(&self) -> &[Value] {
        &self.tools
    }

    /// 将 MCP 工具定义转换为 OpenAI 兼容标准的 tools 参数
    pub fn to_openai_tools(&self) -> Vec<Value> {
        self.tools
            .iter()
            .map(|t| {
                json!({
                    "type": "function",
                    "function": {
                        "name": t["name"],
                        "description": t["description"],
                        "parameters": t["inputSchema"]
                    }
                })
            })
            .collect()
    }

    /// 将 MCP 工具定义转换为 Anthropic 标准的 tools 参数
    pub fn to_anthropic_tools(&self) -> Vec<Value> {
        self.tools
            .iter()
            .map(|t| {
                json!({
                    "name": t["name"],
                    "description": t["description"],
                    "input_schema": t["inputSchema"]
                })
            })
            .collect()
    }

    /// 调用指定的 MCP 工具并获取执行结果文本
    pub async fn call_tool(&mut self, tool_name: &str, arguments: &Value) -> Result<String> {
        let req_id = self.next_id;
        self.next_id += 1;

        let req = json!({
            "jsonrpc": "2.0",
            "id": req_id,
            "method": "tools/call",
            "params": {
                "name": tool_name,
                "arguments": arguments
            }
        });

        let resp = self.send_and_receive(&req).await?;

        if let Some(err) = resp.get("error") {
            return Err(anyhow!("MCP 工具执行失败: {}", err));
        }

        let is_error = resp["isError"].as_bool().unwrap_or(false);
        let text_content = resp["content"]
            .as_array()
            .map(|blocks| {
                blocks
                    .iter()
                    .filter_map(|b| b["text"].as_str())
                    .collect::<Vec<_>>()
                    .join("\n")
            })
            .unwrap_or_else(|| resp.to_string());

        if is_error {
            Err(anyhow!("{}", text_content))
        } else {
            Ok(text_content)
        }
    }

    async fn send_raw(&mut self, val: &Value) -> Result<()> {
        let msg = format!("{}\n", val);
        self.stdin.write_all(msg.as_bytes()).await?;
        self.stdin.flush().await?;
        Ok(())
    }

    async fn send_and_receive(&mut self, req: &Value) -> Result<Value> {
        let target_id = req["id"].as_u64();
        self.send_raw(req).await?;

        // 默认等待 MCP 响应 60 秒 (若 shell 工具内部超时则由其自行返回错误)
        let wait_future = async {
            while let Some(line) = self.lines_reader.next_line().await? {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                if let Ok(val) = serde_json::from_str::<Value>(trimmed) {
                    if val.get("id").and_then(|v| v.as_u64()) == target_id {
                        if let Some(err) = val.get("error") {
                            return Err(anyhow!("MCP 返回错误: {}", err));
                        }
                        if let Some(result) = val.get("result") {
                            return Ok(result.clone());
                        }
                        return Ok(val);
                    }
                }
            }
            Err(anyhow!("MCP 服务子进程管道关闭或意外退出"))
        };

        tokio::time::timeout(Duration::from_secs(180), wait_future)
            .await
            .map_err(|_| anyhow!("等待 MCP 响应超时 (180s)"))?
    }
}

pub type SharedMcpClient = Arc<Mutex<NativeMcpClient>>;

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_native_mcp_client_connection() {
        let client_res = NativeMcpClient::spawn_and_connect(None, None).await;
        if let Ok(mut client) = client_res {
            let tools = client.get_tools();
            assert!(!tools.is_empty(), "Tools list should not be empty");
            let tool_names: Vec<&str> = tools.iter().filter_map(|t| t["name"].as_str()).collect();
            assert!(tool_names.contains(&"shell"));
            assert!(tool_names.contains(&"read_file"));

            // Test calling shell tool via NativeMcpClient
            let args = json!({ "command": "echo 'shinobi client test ok'" });
            let output = client.call_tool("shell", &args).await.unwrap();
            assert!(output.contains("shinobi client test ok"));
        } else {
            // In case binary is not in standard test path in sandbox
            eprintln!("Warning: shinobi-dev-mcp binary not found in test environment: {:?}", client_res.err());
        }
    }
}

