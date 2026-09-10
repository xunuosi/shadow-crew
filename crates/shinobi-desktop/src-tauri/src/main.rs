// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod acp_manager;

use acp_manager::AcpProcessManager;
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};
use tokio::sync::Mutex;

// 共享的全局状态
struct AppState {
    acp_manager: Arc<Mutex<AcpProcessManager>>,
    nostr_relay_url: String,
}

/// Tauri Command: 启动指定 ACP 本地子进程 (stdio 管道绑定)
#[tauri::command]
async fn spawn_acp_agent(
    agent_id: String,
    command: String,
    cwd: String,
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<u32, String> {
    tracing::info!("Spawning ACP agent: {} with cmd: {}", agent_id, command);
    let mut manager = state.acp_manager.lock().await;
    
    let pid = manager
        .spawn_agent(&agent_id, &command, &cwd, app_handle)
        .await
        .map_err(|e| format!("Failed to spawn agent: {}", e))?;
        
    Ok(pid)
}

/// Tauri Command: 发送指令到 ACP Agent (带流式回调)
#[tauri::command]
async fn send_prompt_to_agent(
    agent_id: String,
    room_id: String,
    prompt: String,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let manager = state.acp_manager.lock().await;
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
            spawn_acp_agent,
            send_prompt_to_agent,
            read_workspace_file_sandboxed,
        ])
        .run(tauri::generate_context!())
        .expect("error while running shinobi tauri desktop application");
}
