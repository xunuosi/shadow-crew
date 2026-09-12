// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod acp_manager;
mod agent_discovery;

use acp_manager::AcpProcessManager;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::Mutex;

// 共享的全局状态
struct AppState {
    acp_manager: Arc<Mutex<AcpProcessManager>>,
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
    command: Option<String>,
    cwd: Option<String>,
    env_vars: Option<Vec<acp_manager::AcpEnvVar>>,
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let mut manager = state.acp_manager.lock().await;

    // 若 Agent 尚未运行且提供了命令，则自动拉起
    if !manager.is_agent_running(&agent_id) {
        if let Some(cmd) = command {
            let working_dir = cwd.unwrap_or_else(|| ".".to_string());
            tracing::info!("Auto-spawning agent {} before dispatching prompt: {}", agent_id, cmd);
            manager
                .spawn_agent(&agent_id, &cmd, &working_dir, env_vars, app_handle)
                .await
                .map_err(|e| format!("Auto-spawn agent failed: {}", e))?;
        } else {
            return Err(format!("Agent {} is not running and no command specified", agent_id));
        }
    }

    let response = manager
        .send_session_prompt(&agent_id, &room_id, &prompt)
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

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let state = AppState {
        acp_manager: Arc::new(Mutex::new(AcpProcessManager::new())),
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running shinobi tauri desktop application");
}
