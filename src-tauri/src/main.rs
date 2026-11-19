// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod acp_manager;
mod agent_discovery;
mod db_manager;
mod scpack_commands;
mod workspace_commands;

use acp_manager::AcpProcessManager;
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use db_manager::{DatabaseManager, StorageStatsDto};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::Mutex;

// 共享的全局状态
pub(crate) struct AppState {
    pub(crate) acp_manager: Arc<Mutex<AcpProcessManager>>,
    pub(crate) db_manager: Arc<DatabaseManager>,
    #[allow(dead_code)]
    pub(crate) nostr_relay_url: String,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatAttachmentInput {
    id: String,
    kind: String,
    name: String,
    mime_type: String,
    size: u64,
    data_base64: String,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredChatAttachment {
    id: String,
    kind: String,
    name: String,
    mime_type: String,
    size: u64,
    path: String,
    uri: String,
}

fn sanitize_attachment_segment(raw: &str, fallback: &str) -> String {
    let cleaned: String = raw
        .trim()
        .chars()
        .map(|ch| {
            if ch.is_alphanumeric() || matches!(ch, '-' | '_' | '.') {
                ch
            } else {
                '_'
            }
        })
        .collect();
    let cleaned = cleaned
        .trim_matches(|ch| matches!(ch, '.' | '_' | '-'))
        .to_string();
    if cleaned.is_empty() || cleaned == "." || cleaned == ".." {
        fallback.to_string()
    } else {
        cleaned.chars().take(120).collect()
    }
}

fn detect_image_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.len() >= 8
        && bytes[0] == 0x89
        && bytes[1] == 0x50
        && bytes[2] == 0x4e
        && bytes[3] == 0x47
    {
        return Some("image/png");
    }
    if bytes.len() >= 3 && bytes[0] == 0xff && bytes[1] == 0xd8 && bytes[2] == 0xff {
        return Some("image/jpeg");
    }
    if bytes.len() >= 6 && (&bytes[..6] == b"GIF87a" || &bytes[..6] == b"GIF89a") {
        return Some("image/gif");
    }
    if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return Some("image/webp");
    }
    None
}

fn percent_encode_path(path: &std::path::Path) -> String {
    let raw = path.to_string_lossy().replace('\\', "/");
    let mut encoded = String::new();
    for byte in raw.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'/' | b'-' | b'_' | b'.' | b'~') {
            encoded.push(byte as char);
        } else {
            encoded.push_str(&format!("%{:02X}", byte));
        }
    }
    if encoded.starts_with('/') {
        format!("file://{}", encoded)
    } else {
        format!("file:///{}", encoded)
    }
}

/// 将聊天附件写入 Shadow Crew 私有附件目录，并返回供 ACP 使用的路径和 file URI。
#[tauri::command]
async fn save_chat_attachments(
    scope_type: String,
    scope_id: String,
    message_id: String,
    attachments: Vec<ChatAttachmentInput>,
) -> Result<Vec<StoredChatAttachment>, String> {
    let attachment_root = db_manager::get_shadow_crew_home_dir().join("attachments");
    save_chat_attachments_to_root(
        scope_type,
        scope_id,
        message_id,
        attachments,
        &attachment_root,
    )
    .await
}

async fn save_chat_attachments_to_root(
    scope_type: String,
    scope_id: String,
    message_id: String,
    attachments: Vec<ChatAttachmentInput>,
    attachment_root: &std::path::Path,
) -> Result<Vec<StoredChatAttachment>, String> {
    if attachments.len() > 6 {
        return Err("单条消息最多添加 6 个附件".to_string());
    }

    let safe_scope_type = sanitize_attachment_segment(&scope_type, "unknown");
    let safe_scope_id = sanitize_attachment_segment(&scope_id, "default");
    let safe_message_id = sanitize_attachment_segment(&message_id, "message");
    let attachment_dir = attachment_root
        .join(safe_scope_type)
        .join(safe_scope_id)
        .join(safe_message_id);
    tokio::fs::create_dir_all(&attachment_dir)
        .await
        .map_err(|e| format!("创建附件目录失败: {}", e))?;

    let mut total_size = 0u64;
    let mut stored = Vec::with_capacity(attachments.len());
    for attachment in attachments {
        let bytes = BASE64_STANDARD
            .decode(attachment.data_base64.as_bytes())
            .map_err(|e| format!("附件 {} Base64 解码失败: {}", attachment.name, e))?;
        let actual_size = bytes.len() as u64;
        if actual_size == 0 {
            return Err(format!("附件 {} 为空文件", attachment.name));
        }
        if actual_size != attachment.size {
            return Err(format!(
                "附件 {} 大小校验失败: declared={}, actual={}",
                attachment.name, attachment.size, actual_size
            ));
        }

        let is_image = attachment.kind == "image";
        let max_size = if is_image {
            4 * 1024 * 1024
        } else {
            8 * 1024 * 1024
        };
        if actual_size > max_size {
            return Err(format!(
                "{} {} 超过 {} MiB 上限",
                if is_image { "图片" } else { "文件" },
                attachment.name,
                max_size / 1024 / 1024
            ));
        }
        total_size += actual_size;
        if total_size > 16 * 1024 * 1024 {
            return Err("单条消息附件总大小不能超过 16 MiB".to_string());
        }

        let detected_image_mime = detect_image_mime(&bytes);
        if is_image && detected_image_mime.is_none() {
            return Err(format!(
                "图片 {} 文件头无效，仅支持 PNG / JPEG / WebP / GIF",
                attachment.name
            ));
        }
        if !is_image && detected_image_mime.is_some() {
            return Err(format!("附件 {} 是图片，类型声明不一致", attachment.name));
        }
        let mime_type = if is_image {
            detected_image_mime.unwrap_or("application/octet-stream")
        } else if attachment.mime_type.trim().is_empty() {
            "application/octet-stream"
        } else {
            attachment.mime_type.trim()
        };

        let safe_id = sanitize_attachment_segment(&attachment.id, "attachment");
        let safe_name = sanitize_attachment_segment(&attachment.name, "attachment.bin");
        let target_path = attachment_dir.join(format!("{}-{}", safe_id, safe_name));
        tokio::fs::write(&target_path, &bytes)
            .await
            .map_err(|e| format!("保存附件 {} 失败: {}", attachment.name, e))?;

        stored.push(StoredChatAttachment {
            id: attachment.id,
            kind: if is_image { "image" } else { "file" }.to_string(),
            name: attachment.name,
            mime_type: mime_type.to_string(),
            size: actual_size,
            path: target_path.to_string_lossy().to_string(),
            uri: percent_encode_path(&target_path),
        });
    }
    Ok(stored)
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

#[tauri::command]
async fn respond_acp_permission(
    agent_id: String,
    request_id: String,
    decision: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let manager = state.acp_manager.lock().await;
    manager
        .respond_to_acp_permission(&agent_id, &request_id, &decision)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn list_pending_acp_permissions(
    state: State<'_, AppState>,
) -> Result<Vec<acp_manager::AcpPermissionRequestView>, String> {
    let manager = state.acp_manager.lock().await;
    Ok(manager.list_pending_acp_permissions().await)
}

#[tauri::command]
async fn list_acp_permission_grants(
    agent_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<db_manager::AcpPermissionGrantRecord>, String> {
    let manager = state.acp_manager.lock().await;
    manager
        .list_acp_permission_grants(agent_id.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn revoke_acp_permission_grant(
    grant_id: String,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    let manager = state.acp_manager.lock().await;
    manager
        .revoke_acp_permission_grant(&grant_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn revoke_all_acp_permission_grants(state: State<'_, AppState>) -> Result<usize, String> {
    let manager = state.acp_manager.lock().await;
    manager
        .revoke_all_acp_permission_grants()
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn revoke_acp_permission_grants_for_agent(
    agent_id: String,
    state: State<'_, AppState>,
) -> Result<usize, String> {
    let manager = state.acp_manager.lock().await;
    manager
        .revoke_acp_permission_grants_for_agent(&agent_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn revoke_acp_permission_grants_for_scope(
    scope_type: String,
    scope_id: String,
    state: State<'_, AppState>,
) -> Result<usize, String> {
    let manager = state.acp_manager.lock().await;
    manager
        .revoke_acp_permission_grants_for_scope(&scope_type, &scope_id)
        .map_err(|e| e.to_string())
}

/// Tauri Command: 发送指令到 ACP Agent (带流式回调与自动拉起)
#[tauri::command]
async fn send_prompt_to_agent(
    agent_id: String,
    room_id: String,
    channel_id: Option<String>,
    workspace_binding_id: Option<String>,
    workspace_cwd: Option<String>,
    scope_type: Option<String>,
    attachments: Option<Vec<acp_manager::AcpPromptAttachment>>,
    prompt: String,
    _command: Option<String>,
    _cwd: Option<String>,
    _env_vars: Option<Vec<acp_manager::AcpEnvVar>>,
    system_prompt: Option<String>,
    persona_prompt: Option<String>,
    discussion_mode: Option<String>,
    native_memory_enabled: Option<bool>,
    native_memory_auto_generate: Option<bool>,
    _app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    // 关键并发隔离：在极小作用域内获取目标 Agent 的轻量级 Clone 句柄并检查存活状态，
    // 立即释放全局 acp_manager 锁！不同 Agent 的长耗时 LLM 推演（数分钟）完全并发执行。
    let agent = {
        let manager = state.acp_manager.lock().await;

        // 严格检查 Agent 进程是否已由用户手动启动，禁止程序自发静默自动拉起
        if !manager.is_agent_running(&agent_id) {
            return Err(format!(
                "Agent '{}' 尚未开启通信。请先在 Agent 控制面板点击「Start」启动进程并建立 ACP 握手连接。",
                agent_id
            ));
        }

        manager
            .get_agent(&agent_id)
            .ok_or_else(|| format!("Agent '{}' not found", agent_id))?
    };

    let response = agent
        .send_session_prompt(
            &agent_id,
            &room_id,
            channel_id.as_deref(),
            workspace_binding_id.as_deref(),
            workspace_cwd.as_deref(),
            scope_type.as_deref(),
            attachments.as_deref().unwrap_or(&[]),
            &prompt,
            system_prompt.as_deref(),
            persona_prompt.as_deref(),
            discussion_mode.as_deref(),
            native_memory_enabled,
            native_memory_auto_generate,
        )
        .await
        .map_err(|e| format!("ACP Prompt Error: {}", e))?;
        
    Ok(response)
}

/// Tauri Command: 预检并确保指定 Agent 在当前会话下拥有已建立或已恢复的 ACP sessionId
#[tauri::command]
async fn ensure_agent_session(
    agent_id: String,
    room_id: String,
    channel_id: Option<String>,
    workspace_binding_id: Option<String>,
    workspace_cwd: Option<String>,
    scope_type: Option<String>,
    system_prompt: Option<String>,
    persona_prompt: Option<String>,
    discussion_mode: Option<String>,
    local_history_intact: Option<bool>,
    state: State<'_, AppState>,
) -> Result<acp_manager::EnsureSessionResult, String> {
    // 关键并发隔离：在极小作用域内获取目标 Agent 的轻量级 Clone 句柄并检查存活状态，
    // 立即释放全局 acp_manager 锁！不同 Agent 的 session/load 或 session/new 完全并发执行，绝不发生跨 Agent 串行阻塞！
    let agent = {
        let manager = state.acp_manager.lock().await;
        if !manager.is_agent_running(&agent_id) {
            return Err(format!(
                "Agent '{}' 尚未开启通信。请先在 Agent 控制面板点击「Start」启动进程并建立 ACP 握手连接。",
                agent_id
            ));
        }
        manager
            .get_agent(&agent_id)
            .ok_or_else(|| format!("Agent '{}' not found", agent_id))?
    };

    let result = agent
        .ensure_session(
            &agent_id,
            &room_id,
            channel_id.as_deref(),
            workspace_binding_id.as_deref(),
            workspace_cwd.as_deref(),
            scope_type.as_deref(),
            system_prompt.as_deref(),
            persona_prompt.as_deref(),
            discussion_mode.as_deref(),
            local_history_intact,
        )
        .await
        .map_err(|e| format!("ACP Ensure Session Error: {}", e))?;

    Ok(result)
}

/// Tauri Command: 校验并规范化 Workspace cwd。
#[tauri::command]
fn resolve_workspace_cwd(raw_cwd: String, create_missing: bool) -> Result<String, String> {
    db_manager::resolve_workspace_cwd_input(&raw_cwd, create_missing)
        .map_err(|e| e.to_string())
}

/// Tauri Command: 清除指定 Agent 或指定会话前缀的 ACP sessionId 映射与底层沙箱状态
#[tauri::command]
async fn clear_agent_sessions(
    agent_id: Option<String>,
    session_key_prefix: Option<String>,
    clear_generation: Option<u64>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let manager = state.acp_manager.lock().await;
    manager
        .clear_agent_sessions_with_generation(
            agent_id.as_deref(),
            session_key_prefix.as_deref(),
            clear_generation,
        )
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
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

/// Tauri Command: 按消息 ID 列表批量删除消息记录
#[tauri::command]
fn db_delete_messages_by_ids(
    ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<usize, String> {
    state.db_manager.delete_messages_by_ids(&ids).map_err(|e| e.to_string())
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

/// Tauri Command: 获取完整工作区聚合数据 (channels, threads, agents, teams, workspaceState)
#[tauri::command]
fn db_get_full_workspace_data(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    state.db_manager.get_full_workspace_data().map_err(|e| e.to_string())
}

/// Tauri Command: 保存频道列表
#[tauri::command]
fn db_save_channels(channels: Vec<serde_json::Value>, state: State<'_, AppState>) -> Result<(), String> {
    state.db_manager.save_channels(&channels).map_err(|e| e.to_string())
}

/// Tauri Command: 保存 Workspace Binding 列表。
#[tauri::command]
fn db_save_workspace_bindings(bindings: Vec<serde_json::Value>, state: State<'_, AppState>) -> Result<(), String> {
    state.db_manager.save_workspace_bindings(&bindings).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_delete_workspace_bindings(binding_ids: Vec<String>, state: State<'_, AppState>) -> Result<(), String> {
    state.db_manager.delete_workspace_bindings(&binding_ids).map_err(|e| e.to_string())
}

/// Tauri Command: 保存话题/议题列表
#[tauri::command]
fn db_save_threads(threads: Vec<serde_json::Value>, state: State<'_, AppState>) -> Result<(), String> {
    state.db_manager.save_threads(&threads).map_err(|e| e.to_string())
}

/// Tauri Command: 保存 Agent 列表
#[tauri::command]
fn db_save_agents(agents: Vec<serde_json::Value>, state: State<'_, AppState>) -> Result<(), String> {
    state.db_manager.save_agents(&agents).map_err(|e| e.to_string())
}

/// Tauri Command: 保存 Team 编队列表
#[tauri::command]
fn db_save_teams(teams: Vec<serde_json::Value>, state: State<'_, AppState>) -> Result<(), String> {
    state.db_manager.save_teams(&teams).map_err(|e| e.to_string())
}

/// Tauri Command: 保存单个工作区状态项
#[tauri::command]
fn db_save_workspace_state(key: String, value: serde_json::Value, state: State<'_, AppState>) -> Result<(), String> {
    state.db_manager.save_workspace_state(&key, &value).map_err(|e| e.to_string())
}

/// Tauri Command: 获取单个工作区状态项
#[tauri::command]
fn db_get_workspace_state(key: String, state: State<'_, AppState>) -> Result<Option<serde_json::Value>, String> {
    state.db_manager.get_workspace_state(&key).map_err(|e| e.to_string())
}

/// Tauri Command: 打开指定频道的落地产物工作区目录 (系统 Finder / 资源管理器)
#[tauri::command]
async fn open_channel_artifacts_dir(channel_id: String) -> Result<String, String> {
    let channel_dir = db_manager::get_channel_dir(&channel_id);
    let artifacts_dir = channel_dir.join("artifacts");
    let _ = std::fs::create_dir_all(&artifacts_dir);
    let path_str = artifacts_dir.to_string_lossy().to_string();

    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open").arg(&path_str).spawn();
    #[cfg(target_os = "windows")]
    let _ = std::process::Command::new("explorer").arg(&path_str).spawn();
    #[cfg(target_os = "linux")]
    let _ = std::process::Command::new("xdg-open").arg(&path_str).spawn();

    Ok(path_str)
}

#[tauri::command]
async fn open_workspace_artifacts_dir(
    workspace_binding_id: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let binding = state
        .db_manager
        .get_workspace_binding(&workspace_binding_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Workspace Binding '{}' does not exist", workspace_binding_id))?;
    let artifact_root = binding
        .get("artifactRoot")
        .and_then(|value| value.as_str())
        .ok_or_else(|| "Workspace Binding is missing artifactRoot".to_string())?;
    let artifacts_dir = db_manager::resolve_workspace_cwd_input(artifact_root, true)
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open").arg(&artifacts_dir).spawn();
    #[cfg(target_os = "windows")]
    let _ = std::process::Command::new("explorer").arg(&artifacts_dir).spawn();
    #[cfg(target_os = "linux")]
    let _ = std::process::Command::new("xdg-open").arg(&artifacts_dir).spawn();

    Ok(artifacts_dir)
}

/// Tauri Command: 获取当前频道与全局 Shinobi 路径信息
#[tauri::command]
fn get_channel_dir_info(channel_id: String) -> Result<serde_json::Value, String> {
    let channel_dir = db_manager::get_channel_dir(&channel_id);
    let artifacts_dir = channel_dir.join("artifacts");
    let scratch_dir = channel_dir.join("scratch");
    let memory_db = channel_dir.join("memory.sqlite");
    
    Ok(serde_json::json!({
        "channelDir": channel_dir.to_string_lossy().to_string(),
        "artifactsDir": artifacts_dir.to_string_lossy().to_string(),
        "scratchDir": scratch_dir.to_string_lossy().to_string(),
        "memoryDb": memory_db.to_string_lossy().to_string(),
        "globalDir": db_manager::get_shinobi_home_dir().to_string_lossy().to_string(),
    }))
}

/// Tauri Command: 打开指定 Agent 的专属落地产物工作区目录 (系统 Finder / 资源管理器)
#[tauri::command]
async fn open_agent_artifacts_dir(agent_id: String) -> Result<String, String> {
    let agent_dir = db_manager::get_agent_dir(&agent_id);
    let artifacts_dir = agent_dir.join("artifacts");
    let _ = std::fs::create_dir_all(&artifacts_dir);
    let path_str = artifacts_dir.to_string_lossy().to_string();

    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open").arg(&path_str).spawn();
    #[cfg(target_os = "windows")]
    let _ = std::process::Command::new("explorer").arg(&path_str).spawn();
    #[cfg(target_os = "linux")]
    let _ = std::process::Command::new("xdg-open").arg(&path_str).spawn();

    Ok(path_str)
}

/// Tauri Command: 获取当前 Agent 与全局 Shadow Crew 路径信息
#[tauri::command]
fn get_agent_dir_info(agent_id: String) -> Result<serde_json::Value, String> {
    let agent_dir = db_manager::get_agent_dir(&agent_id);
    let artifacts_dir = agent_dir.join("artifacts");
    let scratch_dir = agent_dir.join("scratch");
    
    Ok(serde_json::json!({
        "agentDir": agent_dir.to_string_lossy().to_string(),
        "artifactsDir": artifacts_dir.to_string_lossy().to_string(),
        "scratchDir": scratch_dir.to_string_lossy().to_string(),
        "globalDir": db_manager::get_shadow_crew_home_dir().to_string_lossy().to_string(),
    }))
}

// -----------------------------------------------------------------------------
// 本地文件预览与打开能力 (Local File Preview & Native Open)
// -----------------------------------------------------------------------------

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

fn is_valid_llm_success_json(val: &serde_json::Value) -> bool {
    let Some(obj) = val.as_object() else {
        return false;
    };
    if obj.get("error").is_some_and(|e| !e.is_null()) {
        return false;
    }
    obj.get("choices").is_some_and(|v| v.is_array())
        || obj.get("models").is_some_and(|v| v.is_array())
        || obj.get("data").is_some_and(|v| v.is_array())
        || (obj.get("content").is_some_and(|v| v.is_array() || v.is_string())
            && (obj.contains_key("role") || obj.contains_key("type") || obj.contains_key("id")))
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

    // 检查首次直连响应是否已经包含合法的 LLM JSON 响应体（严禁含 error 字段或以裸子串猜测）
    let initial_has_payload = serde_json::from_str::<serde_json::Value>(&raw_output)
        .ok()
        .is_some_and(|val| is_valid_llm_success_json(&val));

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

    // 仅在 HTTP 状态未报 4xx/5xx 错误且响应体为合法无 error 的 LLM 载荷时，允许 curl 尾包提前断开恢复
    let has_valid_llm_payload = is_valid_llm_success_json(&parsed_json);

    if !output.status.success() && status_code == 200 && !has_valid_llm_payload {
        status_code = 500;
        if response_text.is_empty() {
            response_text = format!("网络请求异常: {}", err_output.trim());
        }
    }

    let is_ok = (200..300).contains(&status_code);

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
        acp_manager: Arc::new(Mutex::new(AcpProcessManager::with_db(db_manager.clone()))),
        db_manager,
        nostr_relay_url: "ws://127.0.0.1:8080/relay".to_string(),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            discover_local_acp_runtimes,
            spawn_acp_agent,
            stop_acp_agent,
            get_running_agent_ids,
            get_agents_runtime_status,
            respond_acp_permission,
            list_pending_acp_permissions,
            list_acp_permission_grants,
            revoke_acp_permission_grant,
            revoke_all_acp_permission_grants,
            revoke_acp_permission_grants_for_agent,
            revoke_acp_permission_grants_for_scope,
            save_chat_attachments,
            send_prompt_to_agent,
            ensure_agent_session,
            resolve_workspace_cwd,
            clear_agent_sessions,
            workspace_commands::read_workspace_file_sandboxed,
            workspace_commands::apply_workspace_patch,
            get_acp_log_path,
            read_recent_acp_logs,
            db_save_message,
            db_save_messages_batch,
            db_get_messages,
            db_delete_messages,
            db_delete_messages_by_ids,
            db_clear_all_messages,
            db_get_storage_stats,
            db_clear_safe_cache,
            db_get_full_workspace_data,
            db_save_channels,
            db_save_workspace_bindings,
            db_delete_workspace_bindings,
            db_save_threads,
            db_save_agents,
            db_save_teams,
            db_save_workspace_state,
            db_get_workspace_state,
            native_http_post,
            open_channel_artifacts_dir,
            open_workspace_artifacts_dir,
            get_channel_dir_info,
            open_agent_artifacts_dir,
            get_agent_dir_info,
            scpack_commands::probe_acp_memory_sources_cmd,
            scpack_commands::probe_codex_memory_sources_cmd,
            scpack_commands::export_acp_scpack_cmd,
            scpack_commands::export_codex_scpack_cmd,
            scpack_commands::import_scpack_cmd,
            scpack_commands::list_installed_scpacks_cmd,
            scpack_commands::uninstall_scpack_cmd,
            scpack_commands::retrieve_scpack_expertise_cmd,
            scpack_commands::validate_b_side_codex_env_cmd,
            workspace_commands::read_file_for_preview,
            workspace_commands::open_file_in_system,
            workspace_commands::reveal_file_in_folder,
            workspace_commands::open_file_in_editor,
            workspace_commands::list_scope_artifacts,
            workspace_commands::open_directory_in_file_manager,
        ])
        .run(tauri::generate_context!())
        .expect("error while running shadow-crew tauri desktop application");
}

#[cfg(test)]
mod attachment_tests {
    use super::*;

    pub(crate) fn temp_root() -> std::path::PathBuf {
        static TEST_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
        let seq = TEST_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        std::env::temp_dir().join(format!(
            "shadow_crew_chat_attachment_test_{}_{}_{}",
            std::process::id(),
            seq,
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ))
    }


    #[tokio::test]
    async fn saves_valid_image_and_file_into_scoped_attachment_store() {
        let root = temp_root();
        let png = b"\x89PNG\r\n\x1a\nfake-image";
        let text = b"attachment text";
        let stored = save_chat_attachments_to_root(
            "channel".to_string(),
            "channel-1".to_string(),
            "msg-1".to_string(),
            vec![
                ChatAttachmentInput {
                    id: "img-1".to_string(),
                    kind: "image".to_string(),
                    name: "screen shot.png".to_string(),
                    mime_type: "image/png".to_string(),
                    size: png.len() as u64,
                    data_base64: BASE64_STANDARD.encode(png),
                },
                ChatAttachmentInput {
                    id: "file-1".to_string(),
                    kind: "file".to_string(),
                    name: "notes.md".to_string(),
                    mime_type: "text/markdown".to_string(),
                    size: text.len() as u64,
                    data_base64: BASE64_STANDARD.encode(text),
                },
            ],
            &root,
        )
        .await
        .unwrap();

        assert_eq!(stored.len(), 2);
        assert_eq!(stored[0].kind, "image");
        assert!(stored[0].uri.starts_with("file://"));
        assert_eq!(std::fs::read(&stored[0].path).unwrap(), png);
        assert_eq!(std::fs::read(&stored[1].path).unwrap(), text);
        assert!(stored[0]
            .path
            .contains("/channel/channel-1/msg-1/"));
        let _ = std::fs::remove_dir_all(root);
    }


    #[tokio::test]
    async fn rejects_fake_images_and_declared_size_mismatch() {
        let root = temp_root();
        let error = save_chat_attachments_to_root(
            "channel".to_string(),
            "channel-1".to_string(),
            "msg-1".to_string(),
            vec![ChatAttachmentInput {
                id: "img-1".to_string(),
                kind: "image".to_string(),
                name: "fake.png".to_string(),
                mime_type: "image/png".to_string(),
                size: 4,
                data_base64: BASE64_STANDARD.encode(b"fake"),
            }],
            &root,
        )
        .await
        .unwrap_err();
        assert!(error.contains("文件头无效"));

        let error = save_chat_attachments_to_root(
            "topic".to_string(),
            "topic-1".to_string(),
            "msg-2".to_string(),
            vec![ChatAttachmentInput {
                id: "file-1".to_string(),
                kind: "file".to_string(),
                name: "notes.txt".to_string(),
                mime_type: "text/plain".to_string(),
                size: 99,
                data_base64: BASE64_STANDARD.encode(b"small"),
            }],
            &root,
        )
        .await
        .unwrap_err();
        assert!(error.contains("大小校验失败"));
        let _ = std::fs::remove_dir_all(root);
    }


    #[test]
    fn sanitizes_path_segments_and_detects_image_headers() {
        assert_eq!(sanitize_attachment_segment("../../etc", "fallback"), "etc");
        assert_eq!(sanitize_attachment_segment("", "fallback"), "fallback");
        assert_eq!(detect_image_mime(b"\x89PNG\r\n\x1a\nrest"), Some("image/png"));
        assert_eq!(detect_image_mime(b"not-an-image"), None);
    }


    #[test]
    fn is_valid_llm_success_json_rejects_error_payloads_with_id_or_content() {
        let error_with_id_and_content = serde_json::json!({
            "id": "req-401",
            "error": {
                "message": "invalid content token",
                "code": "unauthorized"
            }
        });
        assert!(!is_valid_llm_success_json(&error_with_id_and_content));

        let valid_openai = serde_json::json!({
            "id": "chatcmpl-123",
            "choices": [{ "message": { "role": "assistant", "content": "ok" } }]
        });
        assert!(is_valid_llm_success_json(&valid_openai));

        let valid_anthropic = serde_json::json!({
            "id": "msg-1",
            "type": "message",
            "role": "assistant",
            "content": [{ "type": "text", "text": "hello" }]
        });
        assert!(is_valid_llm_success_json(&valid_anthropic));
    }

}
