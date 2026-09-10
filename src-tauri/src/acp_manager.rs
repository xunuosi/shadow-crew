use anyhow::{Context, Result};
use std::collections::HashMap;
use std::process::Stdio;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::mpsc;

pub struct RunningAgent {
    pub pid: u32,
    pub stdin_tx: mpsc::Sender<String>,
}

pub struct AcpProcessManager {
    agents: HashMap<String, RunningAgent>,
}

impl AcpProcessManager {
    pub fn new() -> Self {
        Self {
            agents: HashMap::new(),
        }
    }

    pub async fn spawn_agent(
        &mut self,
        agent_id: &str,
        command_line: &str,
        cwd: &str,
        app_handle: AppHandle,
    ) -> Result<u32> {
        let parts: Vec<&str> = command_line.split_whitespace().collect();
        if parts.is_empty() {
            anyhow::bail!("Command line cannot be empty");
        }
        let program = parts[0];
        let args = &parts[1..];

        let mut child: Child = Command::new(program)
            .args(args)
            .current_dir(cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .with_context(|| format!("Failed to spawn {}", command_line))?;

        let pid = child.id().unwrap_or(0);
        let stdin = child.stdin.take().expect("Failed to open stdin");
        let stdout = child.stdout.take().expect("Failed to open stdout");

        let (stdin_tx, mut stdin_rx) = mpsc::channel::<String>(32);

        let mut async_stdin = stdin;
        tokio::spawn(async move {
            while let Some(msg) = stdin_rx.recv().await {
                if let Err(e) = async_stdin.write_all(msg.as_bytes()).await {
                    eprintln!("Error writing to agent stdin: {}", e);
                    break;
                }
                let _ = async_stdin.write_all(b"\n").await;
                let _ = async_stdin.flush().await;
            }
        });

        let agent_id_clone = agent_id.to_string();
        let app_handle_clone = app_handle.clone();
        tokio::spawn(async move {
            let mut reader = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                let event_name = format!("acp:stream:{}", agent_id_clone);
                let _ = app_handle_clone.emit(&event_name, serde_json::json!({
                    "agent_id": agent_id_clone,
                    "line": line
                }));
            }
        });

        self.agents.insert(
            agent_id.to_string(),
            RunningAgent { pid, stdin_tx },
        );

        Ok(pid)
    }

    pub async fn send_session_prompt(
        &self,
        agent_id: &str,
        room_id: &str,
        prompt: &str,
    ) -> Result<serde_json::Value> {
        let agent = self.agents.get(agent_id)
            .with_context(|| format!("Agent {} not running", agent_id))?;

        let request = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1001,
            "method": "session/prompt",
            "params": {
                "room_id": room_id,
                "user_query": prompt
            }
        });

        agent.stdin_tx.send(request.to_string()).await?;

        Ok(serde_json::json!({ "status": "sent" }))
    }
}
