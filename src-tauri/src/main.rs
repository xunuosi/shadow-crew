// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod acp_manager;
mod agent_discovery;
mod db_manager;

use acp_manager::AcpProcessManager;
use db_manager::{DatabaseManager, StorageStatsDto};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::Mutex;

// 共享的全局状态
struct AppState {
    acp_manager: Arc<Mutex<AcpProcessManager>>,
    db_manager: Arc<DatabaseManager>,
    #[allow(dead_code)]
    nostr_relay_url: String,
}

/// Tauri Command: 探测本地预设 ACP Agents 状态 (Available / Not Adapted / Not Installed)
#[tauri::command]
async fn discover_local_acp_runtimes() -> Result<Vec<agent_discovery::AcpRuntimeCatalogEntry>, String> {
    Ok(agent_discovery::discover_presets())
}

/// Tauri Command: 启动指定 ACP 本地子进程 (stdio 管道绑定)
#[tauri::command]
async fn spawn_acp_agent(
    agent_id: String,
    command: String,
    cwd: String,
    env_vars: Option<Vec<acp_manager::AcpEnvVar>>,
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<u32, String> {
    tracing::info!("Spawning ACP agent: {} with cmd: {}", agent_id, command);
    let mut manager = state.acp_manager.lock().await;
    
    let pid = manager
        .spawn_agent(&agent_id, &command, &cwd, env_vars, app_handle)
        .await
        .map_err(|e| format!("Failed to spawn agent: {}", e))?;
        
    Ok(pid)
}

/// Tauri Command: 终止指定 ACP 本地子进程
#[tauri::command]
async fn stop_acp_agent(
    agent_id: String,
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    tracing::info!("Stopping ACP agent: {}", agent_id);
    let mut manager = state.acp_manager.lock().await;
    manager
        .stop_agent(&agent_id)
        .await
        .map_err(|e| format!("Failed to stop agent: {}", e))?;

    let _ = app_handle.emit("acp:status_change", serde_json::json!({
        "agent_id": agent_id,
        "status": "stopped"
    }));

    Ok(())
}

/// Tauri Command: 获取当前存活运行的 ACP Agent ID 列表
#[tauri::command]
async fn get_running_agent_ids(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let manager = state.acp_manager.lock().await;
    Ok(manager.get_running_agent_ids())
}

/// Tauri Command: 获取当前所有 ACP Agent 的细粒度运行时状态 (包括握手与鉴权)
#[tauri::command]
async fn get_agents_runtime_status(state: State<'_, AppState>) -> Result<Vec<acp_manager::AgentRuntimeStatus>, String> {
    let manager = state.acp_manager.lock().await;
    Ok(manager.get_agents_runtime_status().await)
}

/// Tauri Command: 发送指令到 ACP Agent (带流式回调与自动拉起)
#[tauri::command]
async fn send_prompt_to_agent(
    agent_id: String,
    room_id: String,
    prompt: String,
    _command: Option<String>,
    _cwd: Option<String>,
    _env_vars: Option<Vec<acp_manager::AcpEnvVar>>,
    system_prompt: Option<String>,
    _app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let manager = state.acp_manager.lock().await;

    // 严格检查 Agent 进程是否已由用户手动启动，禁止程序自发静默自动拉起
    if !manager.is_agent_running(&agent_id) {
        return Err(format!(
            "Agent '{}' 尚未开启通信。请先在 Agent 控制面板点击「Start」启动进程并建立 ACP 握手连接。",
            agent_id
        ));
    }

    let response = manager
        .send_session_prompt(&agent_id, &room_id, &prompt, system_prompt.as_deref())
        .await
        .map_err(|e| format!("ACP Prompt Error: {}", e))?;
        
    Ok(response)
}

/// Tauri Command: 安全沙盒文件读取
#[tauri::command]
async fn read_workspace_file_sandboxed(
    path: String,
    allowed_root: String,
) -> Result<String, String> {
    let canonical_root = std::fs::canonicalize(&allowed_root)
        .map_err(|e| format!("Invalid root: {}", e))?;
    let canonical_path = std::fs::canonicalize(&path)
        .map_err(|e| format!("Invalid file path: {}", e))?;

    // 路径逃逸安全校验：确保目标在允许的根工作区下
    if !canonical_path.starts_with(&canonical_root) {
        return Err("Security Violation: Path traversal outside workspace denied".into());
    }

    tokio::fs::read_to_string(canonical_path)
        .await
        .map_err(|e| format!("Failed to read file: {}", e))
}

/// Tauri Command: 获取 ACP 本地持久化日志文件绝对路径
#[tauri::command]
fn get_acp_log_path() -> String {
    acp_manager::get_acp_log_path()
}

/// Tauri Command: 读取最近的本地 ACP 日志
#[tauri::command]
fn read_recent_acp_logs(lines: Option<usize>) -> String {
    acp_manager::read_recent_acp_logs(lines.unwrap_or(200))
}

/// Tauri Command: 保存单条消息到 SQLite (方案 3: 消除 5MB 配额限制)
#[tauri::command]
fn db_save_message(message: serde_json::Value, state: State<'_, AppState>) -> Result<(), String> {
    state.db_manager.save_message(&message).map_err(|e| e.to_string())
}

/// Tauri Command: 批量事务保存消息 (用于首次从 localStorage 迁移)
#[tauri::command]
fn db_save_messages_batch(messages: Vec<serde_json::Value>, state: State<'_, AppState>) -> Result<usize, String> {
    state.db_manager.save_messages_batch(&messages).map_err(|e| e.to_string())
}

/// Tauri Command: 查询消息
#[tauri::command]
fn db_get_messages(
    thread_id: Option<String>,
    channel_id: Option<String>,
    limit: Option<usize>,
    offset: Option<usize>,
    state: State<'_, AppState>,
) -> Result<Vec<serde_json::Value>, String> {
    state.db_manager.get_messages(thread_id, channel_id, limit, offset).map_err(|e| e.to_string())
}

/// Tauri Command: 删除指定范围历史消息
#[tauri::command]
fn db_delete_messages(
    thread_id: Option<String>,
    channel_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<usize, String> {
    state.db_manager.delete_messages(thread_id, channel_id).map_err(|e| e.to_string())
}

/// Tauri Command: 清空所有历史消息 (保留 acp_memories 核心记忆)
#[tauri::command]
fn db_clear_all_messages(state: State<'_, AppState>) -> Result<usize, String> {
    state.db_manager.clear_all_messages().map_err(|e| e.to_string())
}

/// Tauri Command: 获取存储用量与分级统计
#[tauri::command]
fn db_get_storage_stats(state: State<'_, AppState>) -> Result<StorageStatsDto, String> {
    let log_path = acp_manager::get_acp_log_path();
    state.db_manager.get_storage_stats(&log_path).map_err(|e| e.to_string())
}

/// Tauri Command: 一键清理安全缓存 (清空 acp.log 并压缩 WAL)
#[tauri::command]
fn db_clear_safe_cache(state: State<'_, AppState>) -> Result<u64, String> {
    let log_path = acp_manager::get_acp_log_path();
    state.db_manager.clear_safe_cache(&log_path).map_err(|e| e.to_string())
}

#[derive(serde::Deserialize)]
pub struct HttpPostRequest {
    pub url: String,
    pub headers: std::collections::HashMap<String, String>,
    pub body: Option<serde_json::Value>,
    pub method: Option<String>,
    pub timeout_secs: Option<u64>,
}

#[derive(serde::Serialize)]
pub struct HttpResponsePayload {
    pub status: u16,
    pub ok: bool,
    pub body: serde_json::Value,
    pub raw_text: String,
}

/// Tauri Command: 原生无跨域 HTTP 请求转发 (彻底消除前端 WebView CORS 限制与企业内网证书拦截)
#[tauri::command]
async fn native_http_post(req: HttpPostRequest) -> Result<HttpResponsePayload, String> {
    let timeout = req.timeout_secs.unwrap_or(20).to_string();
    let method = req.method.unwrap_or_else(|| "POST".to_string()).to_uppercase();
    let is_post = method == "POST";
    let body_str = if is_post {
        serde_json::to_string(&req.body.unwrap_or(serde_json::Value::Null)).map_err(|e| e.to_string())?
    } else {
        String::new()
    };

    // 探测系统 curl 路径
    let curl_bin = if std::path::Path::new("/usr/bin/curl").exists() {
        "/usr/bin/curl"
    } else {
        "curl"
    };

    let mut cmd = tokio::process::Command::new(curl_bin);
    cmd.arg("-s")
       .arg("-S")
       .arg("-X").arg(&method)
       .arg("--connect-timeout").arg(&timeout)
       .arg("--max-time").arg(&timeout)
       .arg("-k"); // 支持企业内网自签/局域网证书

    for (k, v) in &req.headers {
        cmd.arg("-H").arg(format!("{}: {}", k, v));
    }

    if is_post && !body_str.is_empty() && body_str != "null" {
        cmd.arg("-d").arg(&body_str);
    }
    cmd.arg("-w").arg("\n__SHADOW_HTTP_CODE__:%{http_code}");
    cmd.arg(&req.url);

    let mut output = cmd.output().await.map_err(|e| format!("执行系统 curl 失败: {}", e))?;
    let mut raw_output = String::from_utf8_lossy(&output.stdout).to_string();
    let mut err_output = String::from_utf8_lossy(&output.stderr).to_string();

    // 检查首次直连响应是否已经包含合法的大模型输出数据或模型列表
    let initial_has_payload = raw_output.contains("\"choices\"")
        || raw_output.contains("\"id\"")
        || raw_output.contains("\"content\"")
        || raw_output.contains("\"data\"")
        || raw_output.contains("\"models\"");

    // 如果直连失败且未获取到任何有效数据，自动尝试通过代理重试
    if !initial_has_payload && (!output.status.success() || raw_output.is_empty()) && !req.url.contains("127.0.0.1") {
        let proxy_addr = std::env::var("https_proxy")
            .or_else(|_| std::env::var("http_proxy"))
            .or_else(|_| std::env::var("ALL_PROXY"))
            .unwrap_or_else(|_| "http://127.0.0.1:7897".to_string());

        let mut retry_cmd = tokio::process::Command::new(curl_bin);
        retry_cmd.arg("-s")
            .arg("-S")
            .arg("-X").arg(&method)
            .arg("--connect-timeout").arg("5")
            .arg("--max-time").arg(&timeout)
            .arg("-k")
            .arg("-x").arg(&proxy_addr);

        for (k, v) in &req.headers {
            retry_cmd.arg("-H").arg(format!("{}: {}", k, v));
        }

        if is_post && !body_str.is_empty() && body_str != "null" {
            retry_cmd.arg("-d").arg(&body_str);
        }
        retry_cmd.arg("-w").arg("\n__SHADOW_HTTP_CODE__:%{http_code}");
        retry_cmd.arg(&req.url);

        if let Ok(retry_out) = retry_cmd.output().await {
            let retry_str = String::from_utf8_lossy(&retry_out.stdout).to_string();
            if !retry_str.is_empty() {
                output = retry_out;
                raw_output = retry_str;
                err_output = String::from_utf8_lossy(&output.stderr).to_string();
            }
        }
    }

    let mut status_code: u16 = 200;
    let mut response_text = raw_output;

    if let Some(pos) = response_text.rfind("\n__SHADOW_HTTP_CODE__:") {
        let code_part = response_text[pos + 23..].trim();
        if let Ok(c) = code_part.parse::<u16>() {
            status_code = c;
        }
        response_text.truncate(pos);
    }

    let parsed_json: serde_json::Value = serde_json::from_str(&response_text).unwrap_or(serde_json::Value::Null);

    // 容错判定：若响应 JSON 中已包含 choices/id/content/data/models 等标准 LLM 响应体，说明请求已成功被服务端处理完毕，
    // 即使企业内网网关在传输末尾提前断开 TCP 连接导致系统 curl 产生非 0 退出码，也视为成功响应
    let has_valid_llm_payload = parsed_json.get("choices").is_some()
        || parsed_json.get("id").is_some()
        || parsed_json.get("content").is_some()
        || parsed_json.get("data").is_some()
        || parsed_json.get("models").is_some();

    if !output.status.success() && status_code == 200 && !has_valid_llm_payload {
        status_code = 500;
        if response_text.is_empty() {
            response_text = format!("网络请求异常: {}", err_output.trim());
        }
    }

    let is_ok = (status_code >= 200 && status_code < 300) || has_valid_llm_payload;

    Ok(HttpResponsePayload {
        status: status_code,
        ok: is_ok,
        body: parsed_json,
        raw_text: response_text,
    })
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let db_path = db_manager::get_default_db_path();
    tracing::info!("Initializing SQLite database at {}", db_path);
    let db_manager = match DatabaseManager::new(&db_path) {
        Ok(m) => Arc::new(m),
        Err(e) => {
            tracing::error!("Failed to open database at {}: {}, fallback to in-memory", db_path, e);
            Arc::new(DatabaseManager::new(":memory:").expect("in-memory db fallback failed"))
        }
    };

    let state = AppState {
        acp_manager: Arc::new(Mutex::new(AcpProcessManager::new())),
        db_manager,
        nostr_relay_url: "ws://127.0.0.1:8080/relay".to_string(),
    };

    tauri::Builder::default()
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            discover_local_acp_runtimes,
            spawn_acp_agent,
            stop_acp_agent,
            get_running_agent_ids,
            get_agents_runtime_status,
            send_prompt_to_agent,
            read_workspace_file_sandboxed,
            get_acp_log_path,
            read_recent_acp_logs,
            db_save_message,
            db_save_messages_batch,
            db_get_messages,
            db_delete_messages,
            db_clear_all_messages,
            db_get_storage_stats,
            db_clear_safe_cache,
            native_http_post,
        ])
        .run(tauri::generate_context!())
        .expect("error while running shinobi tauri desktop application");
}
