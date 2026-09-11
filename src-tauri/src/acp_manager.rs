use anyhow::{Context, Result};
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, oneshot, Mutex as TokioMutex};

/// 格式化并写入本地持久化日志文件 (logs/acp.log)
pub fn log_acp_event(agent_id: &str, direction: &str, line: &str) {
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
    let formatted = format!("[{}] [{}] [{}] {}\n", now, agent_id, direction, line);

    // 写入当前工作区 logs/acp.log
    let _ = std::fs::create_dir_all("logs");
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open("logs/acp.log")
    {
        use std::io::Write;
        let _ = file.write_all(formatted.as_bytes());
    }
}

pub fn get_acp_log_path() -> String {
    std::env::current_dir()
        .map(|p| p.join("logs/acp.log").to_string_lossy().to_string())
        .unwrap_or_else(|_| "logs/acp.log".to_string())
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

pub struct RunningAgent {
    #[allow(dead_code)]
    pub pid: u32,
    pub stdin_tx: mpsc::Sender<String>,
    pub pending_requests: Arc<TokioMutex<HashMap<u64, oneshot::Sender<serde_json::Value>>>>,
    #[allow(dead_code)]
    pub active_chunks: Arc<TokioMutex<HashMap<u64, String>>>,
    pub session_active_req: Arc<TokioMutex<HashMap<String, u64>>>,
    pub is_alive: Arc<AtomicBool>,
    pub initialized: Arc<AtomicBool>,
    pub session_ids: Arc<TokioMutex<HashMap<String, String>>>,
    pub cwd: String,
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

    /// 检查指定 Agent 进程是否真正存活运行
    pub fn is_agent_running(&self, agent_id: &str) -> bool {
        self.agents
            .get(agent_id)
            .map(|a| a.is_alive.load(Ordering::SeqCst))
            .unwrap_or(false)
    }

    /// 启动子进程并接管 stdin/stdout
    pub async fn spawn_agent(
        &mut self,
        agent_id: &str,
        command_line: &str,
        cwd: &str,
        app_handle: AppHandle,
    ) -> Result<u32> {
        let mut actual_cmd = command_line.to_string();

        // 智能路径探测: 若是 shinobi-agent 命令，优先直接运行编译后的原生二进制
        if command_line.contains("shinobi-agent") {
            let possible_bins = [
                format!("{}/target/debug/shinobi-agent", cwd),
                format!("{}/target/release/shinobi-agent", cwd),
                "target/debug/shinobi-agent".to_string(),
                "target/release/shinobi-agent".to_string(),
                "../target/debug/shinobi-agent".to_string(),
                "../../target/debug/shinobi-agent".to_string(),
            ];
            for bin in &possible_bins {
                if let Ok(canonical) = std::fs::canonicalize(bin) {
                    if canonical.is_file() {
                        actual_cmd = canonical.to_string_lossy().to_string();
                        tracing::info!("Discovered compiled native shinobi-agent binary at: {}", actual_cmd);
                        break;
                    }
                }
            }
            if actual_cmd == command_line && command_line.contains("--bin shinobi-agent") {
                // 如果没有找到二进制，改用 -p shinobi-agent 避免 cargo workspace 目标未匹配
                actual_cmd = command_line.replace("--bin shinobi-agent", "-p shinobi-agent");
            }
        }

        // 注入常见环境 PATH，保障 macOS GUI 模式下能正常执行 cargo/openclaw 等 CLI
        let current_path = std::env::var("PATH").unwrap_or_default();
        let home = std::env::var("HOME").unwrap_or_default();
        let extra_paths = format!("{}/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:{}", home, current_path);

        let parts: Vec<&str> = actual_cmd.split_whitespace().collect();
        if parts.is_empty() {
            anyhow::bail!("Command line cannot be empty");
        }
        let program = parts[0];
        let args = &parts[1..];

        let mut child: Child = Command::new(program)
            .args(args)
            .current_dir(cwd)
            .env("PATH", &extra_paths)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .with_context(|| format!("Failed to spawn command '{}' (resolved from '{}')", actual_cmd, command_line))?;

        let pid = child.id().unwrap_or(0);
        let stdin = child.stdin.take().expect("Failed to open stdin");
        let stdout = child.stdout.take().expect("Failed to open stdout");

        log_acp_event(
            agent_id,
            "SPAWNED",
            &format!("Process spawned successfully with PID: {}", pid),
        );

        // 异步任务: 监听并排空 stderr 避免管道缓冲区阻塞，并落盘
        if let Some(stderr) = child.stderr.take() {
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
        let is_alive = Arc::new(AtomicBool::new(true));
        let initialized = Arc::new(AtomicBool::new(false));
        let session_ids = Arc::new(TokioMutex::new(HashMap::new()));

        // 异步任务 1: 处理写往 Agent 的指令
        let agent_id_in = agent_id.to_string();
        let mut async_stdin = stdin;
        tokio::spawn(async move {
            while let Some(msg) = stdin_rx.recv().await {
                log_acp_event(&agent_id_in, "STDIN >>>", &msg);
                if let Err(e) = async_stdin.write_all(msg.as_bytes()).await {
                    log_acp_event(&agent_id_in, "STDIN_ERR", &format!("Error writing to agent stdin: {}", e));
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
        let is_alive_clone = is_alive.clone();

        tokio::spawn(async move {
            let mut reader = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = reader.next_line().await {
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

                    // 判断是否为 ACP 通知 (Notification 没有 id，但有 method，例如 session/update)
                    if let Some(method) = json_val.get("method").and_then(|m| m.as_str()) {
                        if method == "session/update" {
                            if let Some(params) = json_val.get("params") {
                                let sess_id = params.get("sessionId").and_then(|s| s.as_str()).unwrap_or_default();
                                let session_active = session_active_req_clone.lock().await;
                                let active_req_id = session_active.get(sess_id).cloned();
                                drop(session_active);

                                if let Some(update) = params.get("update") {
                                    let update_type = update.get("sessionUpdate").and_then(|u| u.as_str()).unwrap_or_default();
                                    if update_type == "agent_message_chunk" {
                                        if let Some(text) = update.get("content").and_then(|c| c.get("text")).and_then(|t| t.as_str()) {
                                            if let Some(req_id) = active_req_id {
                                                let mut chunks = active_chunks_clone.lock().await;
                                                chunks.entry(req_id).or_default().push_str(text);
                                            }
                                            // 触发前端细粒度 chunk 事件
                                            let chunk_event = format!("acp:chunk:{}", agent_id_clone);
                                            let _ = app_handle_clone.emit(
                                                &chunk_event,
                                                serde_json::json!({
                                                    "agent_id": &agent_id_clone,
                                                    "sessionId": sess_id,
                                                    "chunk": text
                                                }),
                                            );
                                        }
                                    }
                                }
                            }
                        }
                        // 如果是通知或方法请求，不要作为 request 响应消费
                        continue;
                    }

                    // 如果是带有 id 的响应，匹配并唤醒 oneshot channel
                    let matched_id = json_val.get("id").and_then(|v| {
                        v.as_u64().or_else(|| v.as_str().and_then(|s| s.parse::<u64>().ok()))
                    });

                    if let Some(id) = matched_id {
                        let mut map = pending_requests_clone.lock().await;
                        if let Some(tx) = map.remove(&id) {
                            // 如果此请求累积了流式 chunk 文本，回填进 result.text_response
                            let accumulated = active_chunks_clone.lock().await.remove(&id).unwrap_or_default();
                            if !accumulated.is_empty() {
                                if let Some(res_obj) = json_val.get_mut("result").and_then(|r| r.as_object_mut()) {
                                    let needs_fill = res_obj.get("text_response")
                                        .and_then(|t| t.as_str())
                                        .map(|s| s.is_empty())
                                        .unwrap_or(true);
                                    if needs_fill {
                                        res_obj.insert("text_response".to_string(), serde_json::Value::String(accumulated));
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
                pid,
                stdin_tx,
                pending_requests,
                active_chunks,
                session_active_req,
                is_alive,
                initialized,
                session_ids,
                cwd: cwd.to_string(),
            },
        );

        Ok(pid)
    }

    /// 发送 Prompt 请求并等待 Agent 返回 (符合标准 ACP 规范)
    pub async fn send_session_prompt(
        &self,
        agent_id: &str,
        room_id: &str,
        prompt: &str,
    ) -> Result<serde_json::Value> {
        let agent = self
            .agents
            .get(agent_id)
            .with_context(|| format!("Agent {} not running", agent_id))?;

        if !agent.is_alive.load(Ordering::SeqCst) {
            anyhow::bail!("Agent {} process is dead or closed", agent_id);
        }

        // 1. 确保已完成 ACP initialize 握手
        if !agent.initialized.load(Ordering::SeqCst) {
            let init_id = 1001u64;
            let (init_tx, init_rx) = oneshot::channel();
            {
                let mut map = agent.pending_requests.lock().await;
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
                    "clientCapabilities": {
                        "fs": { "readTextFile": true, "writeTextFile": true },
                        "terminal": true
                    }
                }
            });
            let _ = agent.stdin_tx.send(init_req.to_string()).await;
            match tokio::time::timeout(Duration::from_secs(5), init_rx).await {
                Ok(Ok(resp)) => {
                    tracing::info!("[Agent {}] initialize succeeded: {:?}", agent_id, resp);
                    agent.initialized.store(true, Ordering::SeqCst);
                }
                _ => {
                    tracing::warn!("[Agent {}] initialize timed out or skipped, marking initialized", agent_id);
                    agent.initialized.store(true, Ordering::SeqCst);
                }
            }
        }

        // 2. 确保当前房间绑定了有效的 ACP sessionId (通过 session/new 创建)
        let mut session_id = {
            let map = agent.session_ids.lock().await;
            map.get(room_id).cloned()
        };

        if session_id.is_none() {
            let new_sess_id = 2001u64;
            let (sess_tx, sess_rx) = oneshot::channel();
            {
                let mut map = agent.pending_requests.lock().await;
                map.insert(new_sess_id, sess_tx);
            }
            let new_req = serde_json::json!({
                "jsonrpc": "2.0",
                "id": new_sess_id,
                "method": "session/new",
                "params": {
                    "cwd": &agent.cwd,
                    "mcpServers": []
                }
            });
            let _ = agent.stdin_tx.send(new_req.to_string()).await;
            let sid = match tokio::time::timeout(Duration::from_secs(5), sess_rx).await {
                Ok(Ok(resp)) => {
                    let sid_val = resp.get("result")
                        .and_then(|r| r.get("sessionId"))
                        .and_then(|s| s.as_str())
                        .map(|s| s.to_string());
                    sid_val.unwrap_or_else(|| format!("session-{}", room_id))
                }
                _ => {
                    format!("session-{}", room_id)
                }
            };
            tracing::info!("[Agent {}] Obtained sessionId for room {}: {}", agent_id, room_id, sid);
            agent.session_ids.lock().await.insert(room_id.to_string(), sid.clone());
            session_id = Some(sid);
        }

        let current_session_id = session_id.unwrap_or_else(|| format!("session-{}", room_id));

        // 3. 构造标准 ACP session/prompt 请求 (格式: sessionId + prompt: [ { type: "text", text: ... } ])
        let req_id = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        let (resp_tx, resp_rx) = oneshot::channel();
        {
            let mut map = agent.pending_requests.lock().await;
            map.insert(req_id, resp_tx);
            let mut active_reqs = agent.session_active_req.lock().await;
            active_reqs.insert(current_session_id.clone(), req_id);
        }

        let request = serde_json::json!({
            "jsonrpc": "2.0",
            "id": req_id,
            "method": "session/prompt",
            "params": {
                "sessionId": current_session_id,
                "prompt": [
                    {
                        "type": "text",
                        "text": prompt
                    }
                ]
            }
        });

        if let Err(e) = agent.stdin_tx.send(request.to_string()).await {
            agent.is_alive.store(false, Ordering::SeqCst);
            anyhow::bail!("Failed to write to agent stdin channel: {}", e);
        }

        // 4. 等待 Agent 响应 (最长等待 90 秒适配大模型推理)
        let response = match tokio::time::timeout(Duration::from_secs(90), resp_rx).await {
            Ok(Ok(resp)) => {
                // 若出现特定 session 错误，清除缓存触发重新 session/new
                if resp.get("error").is_some() {
                    let mut map = agent.session_ids.lock().await;
                    map.remove(room_id);
                }
                Ok(resp)
            }
            Ok(Err(_)) => Ok(serde_json::json!({
                "status": "closed",
                "error": "Agent closed stdio response pipe"
            })),
            Err(_) => {
                let mut map = agent.pending_requests.lock().await;
                map.remove(&req_id);
                let mut active_reqs = agent.session_active_req.lock().await;
                active_reqs.remove(&current_session_id);
                Ok(serde_json::json!({
                    "status": "timeout",
                    "error": "Agent response timed out after 90s"
                }))
            }
        };

        // 清理 session_active_req
        {
            let mut active_reqs = agent.session_active_req.lock().await;
            active_reqs.remove(&current_session_id);
        }

        response
    }
}
