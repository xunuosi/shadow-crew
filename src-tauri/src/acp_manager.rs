use anyhow::{Context, Result};
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, oneshot, Mutex as TokioMutex};

/// 格式化并写入本地持久化日志文件 (~/.shadow-crew/logs/acp.log)
pub fn log_acp_event(agent_id: &str, direction: &str, line: &str) {
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
    let formatted = format!("[{}] [{}] [{}] {}\n", now, agent_id, direction, line);

    let logs_dir = crate::db_manager::get_shadow_crew_home_dir().join("logs");
    let _ = std::fs::create_dir_all(&logs_dir);
    let log_file = logs_dir.join("acp.log");

    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_file)
    {
        use std::io::Write;
        let _ = file.write_all(formatted.as_bytes());
    }
}

pub fn get_acp_log_path() -> String {
    let logs_dir = crate::db_manager::get_shinobi_home_dir().join("logs");
    let _ = std::fs::create_dir_all(&logs_dir);
    let log_file = logs_dir.join("acp.log");
    log_file.to_string_lossy().to_string()
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
    /// ACP 握手被 Agent 明确拒绝时的根因。存在即代表本进程不可用，运行态必须报 error。
    pub init_error: Arc<TokioMutex<Option<String>>>,
    pub auth_state: Arc<TokioMutex<String>>,
    pub status_detail: Arc<TokioMutex<Option<String>>>,
    pub session_ids: Arc<TokioMutex<HashMap<String, String>>>,
    #[allow(dead_code)]
    pub cwd: String,
    pub app_handle: AppHandle,
    pub last_activity: Arc<AtomicU64>,
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
            let init_error = agent.init_error.lock().await.clone();
            let status_detail = match init_error.clone() {
                Some(err) => Some(err),
                None => agent.status_detail.lock().await.clone(),
            };

            let status = derive_runtime_status(is_alive, &auth_state, init_error.is_some()).to_string();

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
        let host_cwd = std::env::current_dir()
            .ok()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| ".".to_string());

        // 智能路径探测: 若是 shadow-crew-agent 或 shinobi-agent 命令，优先直接运行编译后的原生二进制
        if command_line.contains("shadow-crew-agent") || command_line.contains("shinobi-agent") {
            let possible_bins = [
                format!("{}/target/debug/shadow-crew-agent", cwd),
                format!("{}/target/release/shadow-crew-agent", cwd),
                format!("{}/target/debug/shadow-crew-agent", host_cwd),
                format!("{}/target/release/shadow-crew-agent", host_cwd),
                "target/debug/shadow-crew-agent".to_string(),
                "target/release/shadow-crew-agent".to_string(),
                "../target/debug/shadow-crew-agent".to_string(),
                "../../target/debug/shadow-crew-agent".to_string(),
                format!("{}/target/debug/shinobi-agent", cwd),
                format!("{}/target/release/shinobi-agent", cwd),
                format!("{}/target/debug/shinobi-agent", host_cwd),
                format!("{}/target/release/shinobi-agent", host_cwd),
                "target/debug/shinobi-agent".to_string(),
                "target/release/shinobi-agent".to_string(),
                "../target/debug/shinobi-agent".to_string(),
                "../../target/debug/shinobi-agent".to_string(),
            ];
            for bin in &possible_bins {
                if let Ok(canonical) = std::fs::canonicalize(bin) {
                    if canonical.is_file() {
                        actual_cmd = canonical.to_string_lossy().to_string();
                        tracing::info!("Discovered compiled native agent binary at: {}", actual_cmd);
                        break;
                    }
                }
            }
            if actual_cmd == command_line {
                if command_line.contains("--bin shadow-crew-agent") {
                    actual_cmd = command_line.replace("--bin shadow-crew-agent", "-p shadow-crew-agent");
                } else if command_line.contains("--bin shinobi-agent") {
                    actual_cmd = command_line.replace("--bin shinobi-agent", "-p shadow-crew-agent");
                }
            }
        }

        // 预先解析 shadow-crew-dev-mcp (及 shinobi-dev-mcp) 绝对路径，防止切换 current_dir 到 ~/.shadow-crew 后相对路径失效
        let mut resolved_dev_mcp: Option<String> = None;
        let possible_mcp_bins = [
            format!("{}/target/debug/shadow-crew-dev-mcp", cwd),
            format!("{}/target/release/shadow-crew-dev-mcp", cwd),
            format!("{}/target/debug/shadow-crew-dev-mcp", host_cwd),
            format!("{}/target/release/shadow-crew-dev-mcp", host_cwd),
            "target/debug/shadow-crew-dev-mcp".to_string(),
            "target/release/shadow-crew-dev-mcp".to_string(),
            "../target/debug/shadow-crew-dev-mcp".to_string(),
            "../../target/debug/shadow-crew-dev-mcp".to_string(),
            format!("{}/target/debug/shinobi-dev-mcp", cwd),
            format!("{}/target/release/shinobi-dev-mcp", cwd),
            format!("{}/target/debug/shinobi-dev-mcp", host_cwd),
            format!("{}/target/release/shinobi-dev-mcp", host_cwd),
            "target/debug/shinobi-dev-mcp".to_string(),
            "target/release/shinobi-dev-mcp".to_string(),
            "../target/debug/shinobi-dev-mcp".to_string(),
            "../../target/debug/shinobi-dev-mcp".to_string(),
        ];
        for mcp_bin in &possible_mcp_bins {
            if let Ok(canonical) = std::fs::canonicalize(mcp_bin) {
                if canonical.is_file() {
                    resolved_dev_mcp = Some(canonical.to_string_lossy().to_string());
                    break;
                }
            }
        }

        // 智能路径探测: codex-acp 适配器命令
        let home = std::env::var("HOME").unwrap_or_default();
        if command_line.contains("codex-acp") {
            let possible_bins = [
                format!("{}/bin/codex-acp", cwd),
                format!("{}/bin/codex-acp", host_cwd),
                "bin/codex-acp".to_string(),
                "../bin/codex-acp".to_string(),
                format!("{}/.local/bin/codex-acp", home),
            ];
            for b in &possible_bins {
                if let Ok(canonical) = std::fs::canonicalize(b) {
                    if canonical.is_file() {
                        actual_cmd = canonical.to_string_lossy().to_string();
                        break;
                    }
                }
            }
        }

        // 注入常见环境 PATH，保障 macOS GUI 模式下能正常执行 cargo/openclaw/codex 等 CLI
        let current_path = std::env::var("PATH").unwrap_or_default();
        let extra_paths = format!("{}/.local/bin:{}/.cargo/bin:{}/.codex/plugins/.plugin-appserver:/opt/homebrew/bin:/usr/local/bin:{}", home, home, home, current_path);

        let parts: Vec<&str> = actual_cmd.split_whitespace().collect();
        if parts.is_empty() {
            anyhow::bail!("Command line cannot be empty");
        }
        let program = parts[0];
        let args = &parts[1..];

        // 统一将所有 Agent 底层进程的默认根工作目录收敛至用户级全局 ~/.shadow-crew，彻底脱离项目源码仓目录
        let shadow_crew_home = crate::db_manager::get_shadow_crew_home_dir();
        let shadow_crew_home_str = shadow_crew_home.to_string_lossy().to_string();
        let default_db = crate::db_manager::get_default_db_path();

        let mut cmd = Command::new(program);
        cmd.args(args)
            .current_dir(&shadow_crew_home)
            .env("PATH", &extra_paths)
            .env("SHADOW_CREW_HOME", &shadow_crew_home)
            .env("SHINOBI_HOME", &shadow_crew_home)
            .env("SHADOW_CREW_MEMORY_DB", &default_db)
            .env("SHINOBI_MEMORY_DB", &default_db)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);

        if let Some(ref mcp_path) = resolved_dev_mcp {
            cmd.env("SHADOW_CREW_DEV_MCP_PATH", mcp_path);
            cmd.env("SHINOBI_DEV_MCP_PATH", mcp_path);
        }

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
        let init_error = Arc::new(TokioMutex::new(None::<String>));
        let auth_state = Arc::new(TokioMutex::new("ok".to_string()));
        let status_detail = Arc::new(TokioMutex::new(None::<String>));
        let session_ids = Arc::new(TokioMutex::new(HashMap::new()));
        let now_millis = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        let last_activity = Arc::new(AtomicU64::new(now_millis));

        // 异步任务 1: 处理写往 Agent 的指令
        let agent_id_in = agent_id.to_string();
        let mut async_stdin = stdin;
        let last_activity_stdin = last_activity.clone();
        tokio::spawn(async move {
            while let Some(msg) = stdin_rx.recv().await {
                let current_ts = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as u64;
                last_activity_stdin.store(current_ts, Ordering::Relaxed);
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
        let last_activity_clone = last_activity.clone();

        tokio::spawn(async move {
            let mut reader = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                let current_ts = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as u64;
                last_activity_clone.store(current_ts, Ordering::Relaxed);
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
                                            let target_req_id = if let Some(req_id) = active_req_id {
                                                Some(req_id)
                                            } else {
                                                let pending = pending_requests_clone.lock().await;
                                                pending.keys().cloned().max()
                                            };

                                            if let Some(req_id) = target_req_id {
                                                let mut chunks = active_chunks_clone.lock().await;
                                                chunks.entry(req_id).or_default().push_str(&text);
                                            }
                                            // 触发前端细粒度 chunk 事件与全局通用 chunk 事件
                                            let chunk_event = format!("acp:chunk:{}", agent_id_clone);
                                            let payload = serde_json::json!({
                                                "agent_id": &agent_id_clone,
                                                "sessionId": sess_id,
                                                "chunk": text
                                            });
                                            let _ = app_handle_clone.emit(&chunk_event, &payload);
                                            let _ = app_handle_clone.emit("acp:chunk", &payload);
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
                init_error: init_error.clone(),
                auth_state: auth_state.clone(),
                status_detail: status_detail.clone(),
                session_ids,
                cwd: shadow_crew_home_str,
                app_handle: app_handle.clone(),
                last_activity: last_activity.clone(),
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
                if let Some(err) = resp.get("error") {
                    // ACP initialize 返回 JSON-RPC error = Agent 明确拒绝握手，绝不可视为可用
                    let err_code = err.get("code").and_then(|c| c.as_i64()).unwrap_or(0);
                    let err_msg = err
                        .get("message")
                        .and_then(|m| m.as_str())
                        .unwrap_or("unknown error");
                    let detail = format!("ACP initialize 握手被拒绝 (code {}): {}", err_code, err_msg);
                    tracing::error!("[Agent {}] {}", agent_id, detail);
                    log_acp_event(agent_id, "INIT_REJECTED", &detail);
                    initial_status = "error".to_string();
                    detail_msg = Some(detail.clone());
                    *init_error.lock().await = Some(detail);
                } else {
                    tracing::info!("[Agent {}] Immediate initialize succeeded: {:?}", agent_id, resp);
                    log_acp_event(agent_id, "INIT_OK", &format!("ACP initialize handshake confirmed: {:?}", resp.get("result")));
                    initialized.store(true, Ordering::SeqCst);
                }
            }
            Ok(Err(_)) => {
                let detail = "Agent 在 ACP initialize 期间关闭了连接".to_string();
                tracing::warn!("[Agent {}] Initialize channel closed immediately", agent_id);
                log_acp_event(agent_id, "INIT_FAILED", &detail);
                initial_status = "error".to_string();
                detail_msg = Some(detail.clone());
                *init_error.lock().await = Some(detail);
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
        channel_id: Option<&str>,
        prompt: &str,
        system_prompt: Option<&str>,
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
                    if let Some(err) = resp.get("error") {
                        let err_msg = err
                            .get("message")
                            .and_then(|m| m.as_str())
                            .unwrap_or("unknown error");
                        let detail = format!("ACP initialize 握手被拒绝: {}", err_msg);
                        tracing::error!("[Agent {}] lazy {}", agent_id, detail);
                        log_acp_event(agent_id, "INIT_REJECTED", &detail);
                        *agent.init_error.lock().await = Some(detail.clone());
                        *agent.status_detail.lock().await = Some(detail.clone());
                        let _ = agent.app_handle.emit(
                            "acp:status_change",
                            serde_json::json!({
                                "agent_id": agent_id,
                                "status": "error",
                                "status_detail": detail,
                            }),
                        );
                    } else {
                        tracing::info!("[Agent {}] initialize succeeded: {:?}", agent_id, resp);
                        agent.initialized.store(true, Ordering::SeqCst);
                        // 握手恢复成功，清除历史错误态并回正运行态
                        if agent.init_error.lock().await.take().is_some() {
                            *agent.status_detail.lock().await = None;
                            let _ = agent.app_handle.emit(
                                "acp:status_change",
                                serde_json::json!({
                                    "agent_id": agent_id,
                                    "status": "running",
                                    "status_detail": serde_json::Value::Null,
                                }),
                            );
                        }
                    }
                }
                _ => {
                    tracing::warn!("[Agent {}] initialize timed out or skipped, marking initialized", agent_id);
                    agent.initialized.store(true, Ordering::SeqCst);
                }
            }
        }

        // 2. 解析当前频道的专属独立工作空间路径 ~/.shadow-crew/channels/<channel_id>
        let effective_channel_id = channel_id
            .map(|c| c.trim())
            .filter(|c| !c.is_empty())
            .unwrap_or(room_id);
        let channel_workspace_dir = crate::db_manager::get_channel_dir(effective_channel_id);
        let channel_cwd = channel_workspace_dir.to_string_lossy().to_string();
        let session_key = format!("{}:{}", effective_channel_id, room_id);

        // 3. 确保当前频道/房间绑定了有效的 ACP sessionId (通过 session/new 创建，并将 cwd 绑定至频道独立工作区)
        let mut session_id = {
            let map = agent.session_ids.lock().await;
            map.get(&session_key).cloned()
        };

        if session_id.is_none() {
            let new_sess_id = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64;
            let (sess_tx, sess_rx) = oneshot::channel();
            {
                let mut map = agent.pending_requests.lock().await;
                map.insert(new_sess_id, sess_tx);
            }
            let mut params = serde_json::json!({
                "cwd": &channel_cwd,
                "mcpServers": [],
                "channelId": effective_channel_id
            });
            // 对标 Buzz: 在 session/new 时将系统公约、人设以及频道/私聊专属独立工作空间路径注入底层
            let is_dm = effective_channel_id.starts_with("dm-");
            let workspace_notice = if is_dm {
                format!(
                    "\n\n[当前 Agent 私聊专属独立工作空间环境]:\n- 私聊隔离通道 ID: {}\n- 私聊独立工作区根目录 (Working Directory / cwd): {}\n- 专属落地产物目录 (Artifacts): {}/artifacts\n- 专属临时调试目录 (Scratch): {}/scratch\n提示: 您当前处于与用户的 1-on-1 私聊中，沉淀的技术推演文档、方案或代码 Patch 将安全保存至您个人的专属产物目录中，与其他 Agent 物理隔离。",
                    effective_channel_id, channel_cwd, channel_cwd, channel_cwd
                )
            } else {
                format!(
                    "\n\n[当前频道专属工作空间环境]:\n- 频道 ID: {}\n- 频道独立工作区根目录 (Working Directory / cwd): {}\n- 落地产物目录 (Artifacts): {}/artifacts\n- 临时调试目录 (Scratch): {}/scratch",
                    effective_channel_id, channel_cwd, channel_cwd, channel_cwd
                )
            };
            let enriched_sp = match system_prompt {
                Some(sp) if !sp.trim().is_empty() => format!("{}{}", sp, workspace_notice),
                _ => workspace_notice,
            };
            params["systemPrompt"] = serde_json::Value::String(enriched_sp.clone());
            params["_meta"] = serde_json::json!({
                "systemPrompt": {
                    "append": enriched_sp
                }
            });
            let new_req = serde_json::json!({
                "jsonrpc": "2.0",
                "id": new_sess_id,
                "method": "session/new",
                "params": params
            });
            let _ = agent.stdin_tx.send(new_req.to_string()).await;
            let sid = match tokio::time::timeout(Duration::from_secs(5), sess_rx).await {
                Ok(Ok(resp)) => {
                    let sid_val = resp.get("result")
                        .and_then(|r| r.get("sessionId"))
                        .and_then(|s| s.as_str())
                        .map(|s| s.to_string());
                    sid_val.unwrap_or_else(|| format!("session-{}", session_key))
                }
                _ => {
                    format!("session-{}", session_key)
                }
            };
            tracing::info!(
                "[Agent {}] Obtained sessionId for channel {} (room {}): {} (cwd: {})",
                agent_id,
                effective_channel_id,
                room_id,
                sid,
                channel_cwd
            );
            agent.session_ids.lock().await.insert(session_key.clone(), sid.clone());
            session_id = Some(sid);
        }

        let current_session_id = session_id.unwrap_or_else(|| format!("session-{}", session_key));

        // 4. 构造标准 ACP session/prompt 请求 (携带频道专属 cwd 与 channelId)
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

        let mut prompt_params = serde_json::json!({
            "sessionId": current_session_id,
            "channelId": effective_channel_id,
            "cwd": &channel_cwd,
            "prompt": [
                {
                    "type": "text",
                    "text": prompt
                }
            ]
        });

        if let Some(sp) = system_prompt {
            if !sp.trim().is_empty() {
                prompt_params["systemPrompt"] = serde_json::Value::String(sp.to_string());
                prompt_params["_meta"] = serde_json::json!({
                    "systemPrompt": {
                        "append": sp
                    }
                });
            }
        }

        let request = serde_json::json!({
            "jsonrpc": "2.0",
            "id": req_id,
            "method": "session/prompt",
            "params": prompt_params
        });

        if let Err(e) = agent.stdin_tx.send(request.to_string()).await {
            agent.is_alive.store(false, Ordering::SeqCst);
            anyhow::bail!("Failed to write to agent stdin channel: {}", e);
        }

        // 关键修复：重置 agent.last_activity 为当前发送时间戳！
        // 只有在当前轮次发出 prompt 之后、Agent 没有任何 stdout 吐字/日志的持续空闲时间，
        // 才能被计入空闲超时。若不重置，当 Agent 两次对话之间停顿超过 idle_timeout (默认 300s) 时，
        // 等待循环在第 1 帧就会把“两轮对话之间的用户/系统静默时间”误判为“当前轮次响应超时”，导致毫秒级闪退假告警。
        let prompt_start_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        agent.last_activity.store(prompt_start_ms, Ordering::Relaxed);

        // 4. 等待 Agent 响应 (对标 Buzz 架构: 动态空闲超时 300s~1500s + 最大硬上限 1800s)
        // 允许通过环境变量 SHADOW_CREW_ACP_IDLE_TIMEOUT 与 SHADOW_CREW_ACP_MAX_DURATION 动态配置
        let idle_timeout_secs = std::env::var("SHADOW_CREW_ACP_IDLE_TIMEOUT")
            .ok()
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(600);
        let max_duration_secs = std::env::var("SHADOW_CREW_ACP_MAX_DURATION")
            .ok()
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(1800);

        let start_time = std::time::Instant::now();
        let idle_timeout = Duration::from_secs(idle_timeout_secs);
        let max_duration = Duration::from_secs(max_duration_secs);

        let mut resp_rx = resp_rx;
        let mut last_heartbeat_sec: u64 = 0;
        let wait_result: Result<serde_json::Value, String> = loop {
            let now = std::time::Instant::now();
            let total_elapsed = now.duration_since(start_time);
            if total_elapsed >= max_duration {
                tracing::warn!("[Agent {}] Prompt reached hard maximum duration limit of {}s", agent_id, max_duration_secs);
                break Err(format!("Agent response exceeded maximum turn duration ({}s)", max_duration_secs));
            }

            let last_act_ms = agent.last_activity.load(Ordering::Relaxed);
            let current_ms = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64;
            let idle_elapsed_ms = current_ms.saturating_sub(last_act_ms);
            if idle_elapsed_ms >= idle_timeout.as_millis() as u64 {
                tracing::warn!("[Agent {}] Prompt reached idle timeout (no output for {}s)", agent_id, idle_timeout_secs);
                break Err(format!("Agent response idle timeout (no stdout output for {}s)", idle_timeout_secs));
            }

            // 心跳进度通知 (每 4 秒向前端发送一次，避免无 stdout 时前端显示僵死)
            let total_sec = total_elapsed.as_secs();
            if total_sec > last_heartbeat_sec + 3 {
                last_heartbeat_sec = total_sec;
                let _ = agent.app_handle.emit("acp:thinking_heartbeat", serde_json::json!({
                    "agent_id": agent_id,
                    "sessionId": current_session_id,
                    "elapsed_seconds": total_sec,
                    "idle_elapsed_seconds": idle_elapsed_ms / 1000,
                }));
            }

            // 检查子进程是否已非正常退出
            if !agent.is_alive.load(Ordering::SeqCst) {
                match resp_rx.try_recv() {
                    Ok(val) => break Ok(val),
                    Err(oneshot::error::TryRecvError::Empty) => {
                        break Ok(serde_json::json!({
                            "status": "closed",
                            "error": "Agent process exited while waiting for response"
                        }));
                    }
                    Err(oneshot::error::TryRecvError::Closed) => {
                        break Ok(serde_json::json!({
                            "status": "closed",
                            "error": "Agent stdio pipe closed"
                        }));
                    }
                }
            }

            let remaining_idle_ms = (idle_timeout.as_millis() as u64).saturating_sub(idle_elapsed_ms);
            let remaining_total_ms = (max_duration.as_millis() as u64).saturating_sub(total_elapsed.as_millis() as u64);
            let step_wait_ms = remaining_idle_ms.min(remaining_total_ms).min(1000).max(50);

            tokio::select! {
                res = &mut resp_rx => {
                    match res {
                        Ok(val) => break Ok(val),
                        Err(_) => break Ok(serde_json::json!({
                            "status": "closed",
                            "error": "Agent closed stdio response pipe"
                        })),
                    }
                }
                _ = tokio::time::sleep(Duration::from_millis(step_wait_ms)) => {
                    // 心跳轮询，继续检查空闲倒计时与总时长
                }
            }
        };

        let response = match wait_result {
            Ok(resp) => {
                // 若出现特定 session 错误，清除缓存触发重新 session/new
                if let Some(err) = resp.get("error") {
                    let mut map = agent.session_ids.lock().await;
                    map.remove(&session_key);

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
            Err(timeout_err_msg) => {
                let mut map = agent.pending_requests.lock().await;
                map.remove(&req_id);
                let mut active_reqs = agent.session_active_req.lock().await;
                if active_reqs.get(&current_session_id) == Some(&req_id) {
                    active_reqs.remove(&current_session_id);
                }
                Ok(serde_json::json!({
                    "status": "timeout",
                    "error": timeout_err_msg
                }))
            }
        };

        // 清理 session_active_req (仅当本请求依然为该 session 当前绑定的活跃请求时才执行清理，严防覆盖后被早退请求误删)
        {
            let mut active_reqs = agent.session_active_req.lock().await;
            if active_reqs.get(&current_session_id) == Some(&req_id) {
                active_reqs.remove(&current_session_id);
            }
        }

        response
    }
}

/// 由「进程存活 / 鉴权 / ACP 握手」三要素推导对外运行态。
///
/// 关键约束：进程存活但 ACP initialize 被拒绝时（例如适配器后端二进制缺失）必须是 error，
/// 绝不允许上报 running——进程活着只证明适配器在监听，不证明它能承载任何 prompt。
fn derive_runtime_status(is_alive: bool, auth_state: &str, has_init_error: bool) -> &'static str {
    if !is_alive {
        "idle"
    } else if auth_state == "auth_required" {
        "auth_required"
    } else if has_init_error {
        "error"
    } else {
        "running"
    }
}

#[cfg(test)]
mod runtime_status_tests {
    use super::derive_runtime_status;

    #[test]
    fn dead_process_is_idle() {
        assert_eq!(derive_runtime_status(false, "ok", false), "idle");
        assert_eq!(derive_runtime_status(false, "ok", true), "idle");
    }

    #[test]
    fn rejected_handshake_never_reports_running() {
        // 复现 MyCodex 场景：codex-acp 适配器进程存活，但 initialize 因 codex 缺失返回 JSON-RPC error
        assert_eq!(derive_runtime_status(true, "ok", true), "error");
    }

    #[test]
    fn healthy_handshake_is_running() {
        assert_eq!(derive_runtime_status(true, "ok", false), "running");
    }

    #[test]
    fn auth_required_outranks_init_error() {
        assert_eq!(derive_runtime_status(true, "auth_required", false), "auth_required");
        assert_eq!(derive_runtime_status(true, "auth_required", true), "auth_required");
    }

    #[test]
    fn channel_workspace_dirs_are_isolated_under_shadow_crew_home() {
        let tmp_root = std::env::temp_dir().join("shadow_crew_channel_workspace_test");
        std::env::set_var("SHADOW_CREW_HOME", &tmp_root);
        let home = crate::db_manager::get_shadow_crew_home_dir();
        let chan_a = crate::db_manager::get_channel_dir("channel-alpha-test");
        let chan_b = crate::db_manager::get_channel_dir("channel-beta-test");
        let dm_agent_1 = crate::db_manager::get_channel_dir("dm-agent-1790582453199");
        let dm_agent_2 = crate::db_manager::get_channel_dir("dm-agent-1792035238590");
        assert!(chan_a.starts_with(&home));
        assert!(chan_b.starts_with(&home));
        assert!(dm_agent_1.starts_with(&home));
        assert!(dm_agent_2.starts_with(&home));
        assert_ne!(chan_a, chan_b);
        assert_ne!(dm_agent_1, dm_agent_2);
        assert_ne!(dm_agent_1, chan_a);
        assert!(chan_a.join("artifacts").exists());
        assert!(chan_a.join("scratch").exists());
        assert!(dm_agent_1.join("artifacts").exists());
        assert!(dm_agent_1.join("scratch").exists());
        assert!(dm_agent_2.join("artifacts").exists());
        let _ = std::fs::remove_dir_all(&tmp_root);
        std::env::remove_var("SHADOW_CREW_HOME");
    }
}
