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

    // 若当前工作目录为 src-tauri，同时同步落盘至项目根目录 logs/acp.log
    if let Ok(curr) = std::env::current_dir() {
        if curr.ends_with("src-tauri") {
            let _ = std::fs::create_dir_all("../logs");
            if let Ok(mut root_file) = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open("../logs/acp.log")
            {
                use std::io::Write;
                let _ = root_file.write_all(formatted.as_bytes());
            }
        }
    }
}

pub fn get_acp_log_path() -> String {
    if let Ok(curr) = std::env::current_dir() {
        let direct = curr.join("logs/acp.log");
        if direct.exists() {
            return direct.to_string_lossy().to_string();
        }
        if curr.ends_with("src-tauri") {
            let parent_log = curr.join("../logs/acp.log");
            if parent_log.exists() {
                return parent_log.to_string_lossy().to_string();
            }
        }
        direct.to_string_lossy().to_string()
    } else {
        "logs/acp.log".to_string()
    }
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

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
#[serde(untagged)]
pub enum AcpEnvVar {
    Pair(String, String),
    Object { key: String, value: String },
}

impl AcpEnvVar {
    pub fn into_pair(self) -> (String, String) {
        match self {
            AcpEnvVar::Pair(k, v) => (k, v),
            AcpEnvVar::Object { key, value } => (key, value),
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AgentRuntimeStatus {
    pub agent_id: String,
    pub pid: u32,
    pub is_alive: bool,
    pub is_initialized: bool,
    pub auth_state: String, // "ok" | "auth_required" | "missing_key" | "unknown"
    pub status: String,     // "running" | "auth_required" | "starting" | "error" | "idle"
    pub status_detail: Option<String>,
}

pub struct RunningAgent {
    #[allow(dead_code)]
    pub pid: u32,
    pub child: Arc<TokioMutex<Option<Child>>>,
    pub stdin_tx: mpsc::Sender<String>,
    pub pending_requests: Arc<TokioMutex<HashMap<u64, oneshot::Sender<serde_json::Value>>>>,
    #[allow(dead_code)]
    pub active_chunks: Arc<TokioMutex<HashMap<u64, String>>>,
    pub session_active_req: Arc<TokioMutex<HashMap<String, u64>>>,
    pub is_alive: Arc<AtomicBool>,
    pub initialized: Arc<AtomicBool>,
    pub auth_state: Arc<TokioMutex<String>>,
    pub status_detail: Arc<TokioMutex<Option<String>>>,
    pub session_ids: Arc<TokioMutex<HashMap<String, String>>>,
    pub cwd: String,
    pub app_handle: AppHandle,
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

    /// 获取当前所有正在运行的 Agent ID 列表
    pub fn get_running_agent_ids(&self) -> Vec<String> {
        self.agents
            .iter()
            .filter(|(_, a)| a.is_alive.load(Ordering::SeqCst))
            .map(|(id, _)| id.clone())
            .collect()
    }

    /// 获取当前所有 Agent 的细粒度运行时状态 (包括握手与鉴权)
    pub async fn get_agents_runtime_status(&self) -> Vec<AgentRuntimeStatus> {
        let mut statuses = Vec::new();
        for (id, agent) in &self.agents {
            let is_alive = agent.is_alive.load(Ordering::SeqCst);
            let is_initialized = agent.initialized.load(Ordering::SeqCst);
            let auth_state = agent.auth_state.lock().await.clone();
            let status_detail = agent.status_detail.lock().await.clone();

            let status = if !is_alive {
                "idle".to_string()
            } else if auth_state == "auth_required" {
                "auth_required".to_string()
            } else {
                "running".to_string()
            };

            statuses.push(AgentRuntimeStatus {
                agent_id: id.clone(),
                pid: agent.pid,
                is_alive,
                is_initialized,
                auth_state,
                status,
                status_detail,
            });
        }
        statuses
    }

    /// 终止指定 Agent 进程并释放资源
    pub async fn stop_agent(&mut self, agent_id: &str) -> Result<()> {
        if let Some(agent) = self.agents.remove(agent_id) {
            agent.is_alive.store(false, Ordering::SeqCst);
            drop(agent.stdin_tx);
            if let Some(mut child) = agent.child.lock().await.take() {
                let _ = child.kill().await;
            }
            log_acp_event(agent_id, "STOPPED", "Agent process terminated by user");
        }
        Ok(())
    }

    /// 启动子进程并接管 stdin/stdout
    pub async fn spawn_agent(
        &mut self,
        agent_id: &str,
        command_line: &str,
        cwd: &str,
        env_vars: Option<Vec<AcpEnvVar>>,
        app_handle: AppHandle,
    ) -> Result<u32> {
        // 若该 Agent 之前已在运行，先行安全清理旧进程
        if let Some(old_agent) = self.agents.remove(agent_id) {
            old_agent.is_alive.store(false, Ordering::SeqCst);
            drop(old_agent.stdin_tx);
            if let Some(mut old_child) = old_agent.child.lock().await.take() {
                let _ = old_child.kill().await;
            }
            log_acp_event(agent_id, "REPLACED", "Killed previous instance before respawning");
        }

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

        let mut cmd = Command::new(program);
        cmd.args(args)
            .current_dir(cwd)
            .env("PATH", &extra_paths)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);

        // 注入用户配置的环境变量 (如 ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL 等)
        if let Some(ref vars) = env_vars {
            for item in vars {
                let (k, v) = item.clone().into_pair();
                let trimmed_k = k.trim();
                let trimmed_v = v.trim();
                if !trimmed_k.is_empty() && !trimmed_v.is_empty() {
                    cmd.env(trimmed_k, trimmed_v);
                    let display_val = if trimmed_k.to_uppercase().contains("KEY")
                        || trimmed_k.to_uppercase().contains("TOKEN")
                        || trimmed_k.to_uppercase().contains("SECRET")
                    {
                        "***"
                    } else {
                        trimmed_v
                    };
                    tracing::info!("[Agent {}] Injected ENV: {} = {}", agent_id, trimmed_k, display_val);
                    log_acp_event(agent_id, "ENV", &format!("Injected: {} = {}", trimmed_k, display_val));
                }
            }
        }

        let mut child: Child = cmd
            .spawn()
            .with_context(|| format!("Failed to spawn command '{}' (resolved from '{}')", actual_cmd, command_line))?;

        let pid = child.id().unwrap_or(0);
        let stdin = child.stdin.take().expect("Failed to open stdin");
        let stdout = child.stdout.take().expect("Failed to open stdout");
        let stderr_opt = child.stderr.take();
        let child_arc = Arc::new(TokioMutex::new(Some(child)));

        log_acp_event(
            agent_id,
            "SPAWNED",
            &format!("Process spawned successfully with PID: {}", pid),
        );

        // 异步任务: 监听并排空 stderr 避免管道缓冲区阻塞，并落盘
        if let Some(stderr) = stderr_opt {
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
        let auth_state = Arc::new(TokioMutex::new("ok".to_string()));
        let status_detail = Arc::new(TokioMutex::new(None::<String>));
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
        let stdin_tx_reader = stdin_tx.clone();

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

                    // 判断是否为 ACP 通知或来自 Agent 端的主动请求 (带 method)
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
                                        // 智能提取文本内容，兼容 string / object / array 多种结构
                                        let text_opt = if let Some(text) = update.get("content").and_then(|c| c.get("text")).and_then(|t| t.as_str()) {
                                            Some(text.to_string())
                                        } else if let Some(s) = update.get("content").and_then(|c| c.as_str()) {
                                            Some(s.to_string())
                                        } else if let Some(arr) = update.get("content").and_then(|c| c.as_array()) {
                                            let mut combined = String::new();
                                            for item in arr {
                                                if let Some(t) = item.get("text").and_then(|t| t.as_str()) {
                                                    combined.push_str(t);
                                                } else if let Some(s) = item.as_str() {
                                                    combined.push_str(s);
                                                }
                                            }
                                            if !combined.is_empty() { Some(combined) } else { None }
                                        } else {
                                            None
                                        };

                                        if let Some(text) = text_opt {
                                            if let Some(req_id) = active_req_id {
                                                let mut chunks = active_chunks_clone.lock().await;
                                                chunks.entry(req_id).or_default().push_str(&text);
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
                        } else if method == "session/request_permission" {
                            // Agent 发起工具授权申请 (如 Claude Code 执行 bash 检查或写文件)
                            if let Some(req_id) = json_val.get("id").cloned() {
                                let mut chosen_option_id = "allow-once".to_string();
                                let mut tool_name = "unknown".to_string();

                                if let Some(params) = json_val.get("params") {
                                    if let Some(tool_call) = params.get("toolCall") {
                                        if let Some(name) = tool_call.get("name").and_then(|n| n.as_str()) {
                                            tool_name = name.to_string();
                                        }
                                    }

                                    if let Some(options) = params.get("options").and_then(|o| o.as_array()) {
                                        let mut found = false;
                                        for opt in options {
                                            let kind = opt.get("kind").and_then(|k| k.as_str()).unwrap_or_default();
                                            let opt_id = opt.get("optionId").and_then(|i| i.as_str()).unwrap_or_default();
                                            if kind == "allow_once" || kind == "allow_always" || opt_id.contains("allow") {
                                                chosen_option_id = opt_id.to_string();
                                                found = true;
                                                break;
                                            }
                                        }
                                        if !found && !options.is_empty() {
                                            if let Some(first_id) = options[0].get("optionId").and_then(|i| i.as_str()) {
                                                chosen_option_id = first_id.to_string();
                                            }
                                        }
                                    }
                                }

                                log_acp_event(
                                    &agent_id_clone,
                                    "PERM_APPROVAL",
                                    &format!("Auto-approving permission for tool '{}' with option '{}' (id: {:?})", tool_name, chosen_option_id, req_id),
                                );

                                // 构造符合标准 ACP 规范的权限响应
                                let permission_resp = serde_json::json!({
                                    "jsonrpc": "2.0",
                                    "id": req_id,
                                    "result": {
                                        "outcome": {
                                            "outcome": "selected",
                                            "optionId": chosen_option_id
                                        }
                                    }
                                });

                                let _ = stdin_tx_reader.send(permission_resp.to_string()).await;
                            }
                        } else if let Some(req_id) = json_val.get("id").cloned() {
                            // Agent 发起了其它未支持的客户端调用，按 JSON-RPC 2.0 规范返回 MethodNotFound 避免 Agent 挂起死等
                            log_acp_event(
                                &agent_id_clone,
                                "UNHANDLED_METHOD",
                                &format!("Agent sent unsupported method '{}' with id {:?}, responding with MethodNotFound", method, req_id),
                            );
                            let not_found_resp = serde_json::json!({
                                "jsonrpc": "2.0",
                                "id": req_id,
                                "error": {
                                    "code": -32601,
                                    "message": format!("Method '{}' is not supported by client", method)
                                }
                            });
                            let _ = stdin_tx_reader.send(not_found_resp.to_string()).await;
                        }

                        // 如果是通知或方法请求，不要作为对 client request 的响应消费
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
            let _ = app_handle_clone.emit(
                "acp:status_change",
                serde_json::json!({
                    "agent_id": &agent_id_clone,
                    "status": "stopped"
                }),
            );
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
                child: child_arc,
                stdin_tx: stdin_tx.clone(),
                pending_requests: pending_requests.clone(),
                active_chunks,
                session_active_req,
                is_alive: is_alive.clone(),
                initialized: initialized.clone(),
                auth_state: auth_state.clone(),
                status_detail: status_detail.clone(),
                session_ids,
                cwd: cwd.to_string(),
                app_handle: app_handle.clone(),
            },
        );

        // 1. 立即发起 ACP initialize 握手 (超时 3 秒)
        let init_id = 1001u64;
        let (init_tx, init_rx) = oneshot::channel();
        {
            let mut map = pending_requests.lock().await;
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
        let _ = stdin_tx.send(init_req.to_string()).await;

        let mut initial_status = "running".to_string();
        let mut initial_auth_state = "ok".to_string();
        let mut detail_msg: Option<String> = None;

        match tokio::time::timeout(Duration::from_millis(3000), init_rx).await {
            Ok(Ok(resp)) => {
                tracing::info!("[Agent {}] Immediate initialize succeeded: {:?}", agent_id, resp);
                log_acp_event(agent_id, "INIT_OK", &format!("ACP initialize handshake confirmed: {:?}", resp.get("result")));
                initialized.store(true, Ordering::SeqCst);
            }
            Ok(Err(_)) => {
                tracing::warn!("[Agent {}] Initialize channel closed immediately", agent_id);
                detail_msg = Some("Agent closed connection during ACP initialize".to_string());
            }
            Err(_) => {
                tracing::warn!("[Agent {}] Immediate initialize timed out, marking initialized for backward compat", agent_id);
                initialized.store(true, Ordering::SeqCst);
            }
        }

        // 2. 检查特定 Agent 的 API Key 凭证 (如 Claude Code 需要 ANTHROPIC_API_KEY)
        let is_claude = command_line.contains("claude") || agent_id.contains("claude");
        if is_claude {
            let has_key = env_vars.as_ref().map(|vars| {
                vars.iter().any(|item| {
                    let (k, v) = item.clone().into_pair();
                    k.trim() == "ANTHROPIC_API_KEY" && !v.trim().is_empty()
                })
            }).unwrap_or(false) || std::env::var("ANTHROPIC_API_KEY").map(|k| !k.trim().is_empty()).unwrap_or(false);

            if !has_key {
                initial_status = "auth_required".to_string();
                initial_auth_state = "auth_required".to_string();
                detail_msg = Some("缺少 ANTHROPIC_API_KEY，点击编辑配置".to_string());
                *auth_state.lock().await = "auth_required".to_string();
                *status_detail.lock().await = detail_msg.clone();
                log_acp_event(agent_id, "WARN", "Missing ANTHROPIC_API_KEY for Claude Code ACP");
            }
        }

        let _ = app_handle.emit(
            "acp:status_change",
            serde_json::json!({
                "agent_id": agent_id,
                "status": initial_status,
                "auth_state": initial_auth_state,
                "status_detail": detail_msg,
                "pid": pid
            }),
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

        // 4. 等待 Agent 响应 (最长等待 180 秒适配多轮工具调用与大模型深度思考)
        let response = match tokio::time::timeout(Duration::from_secs(180), resp_rx).await {
            Ok(Ok(resp)) => {
                // 若出现特定 session 错误，清除缓存触发重新 session/new
                if let Some(err) = resp.get("error") {
                    let mut map = agent.session_ids.lock().await;
                    map.remove(room_id);

                    let err_msg = err.get("message").and_then(|m| m.as_str()).unwrap_or_default();
                    if err_msg.contains("Authentication required") || err_msg.to_lowercase().contains("authentication") {
                        *agent.auth_state.lock().await = "auth_required".to_string();
                        *agent.status_detail.lock().await = Some(err_msg.to_string());
                        let _ = agent.app_handle.emit("acp:status_change", serde_json::json!({
                            "agent_id": agent_id,
                            "status": "auth_required",
                            "auth_state": "auth_required",
                            "status_detail": err_msg,
                            "pid": agent.pid
                        }));
                    }
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
                    "error": "Agent response timed out after 180s"
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
