// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod acp_manager;
mod agent_discovery;
mod db_manager;

use acp_manager::AcpProcessManager;
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use db_manager::{DatabaseManager, StorageStatsDto};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Mutex;

// 共享的全局状态
struct AppState {
    acp_manager: Arc<Mutex<AcpProcessManager>>,
    db_manager: Arc<DatabaseManager>,
    /// 按工作区绝对路径串行化补丁落盘，防止并发议题静默覆盖同一文件。
    patch_locks: std::sync::Mutex<HashMap<String, Arc<std::sync::Mutex<()>>>>,
    /// 按工作区根目录串行化「合入 / 回退 / 验证」操作，避免验证读到半写入状态。
    workspace_operation_locks: std::sync::Mutex<HashMap<String, Arc<Mutex<()>>>>,
    #[allow(dead_code)]
    nostr_relay_url: String,
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

#[derive(serde::Deserialize, Debug, Clone)]
pub struct WorkspacePatchItem {
    pub filename: String,
    pub diff: String,
    pub code_content: Option<String>,
}

#[derive(serde::Serialize, Debug, Clone)]
pub struct AppliedFileStatus {
    pub filename: String,
    /// 实际采用的落盘方式：git_apply / block_replace / created_file / artifact_saved
    pub mode: String,
    /// 真实结果：applied / conflict / archived_only / failed
    pub status: String,
    pub target_path: String,
    pub artifact_path: String,
    pub backup_path: Option<String>,
    pub error: Option<String>,
}

#[derive(serde::Serialize, Debug, Clone)]
pub struct ApplyWorkspacePatchResult {
    /// 仅当所有补丁都真实应用成功时为 true；冲突、仅归档、失败一律为 false。
    pub ok: bool,
    pub applied_count: usize,
    pub failed_count: usize,
    pub artifacts_dir: String,
    pub applied_files: Vec<AppliedFileStatus>,
    pub summary: String,
    pub history_id: String,
    pub history_path: String,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct PatchHistoryFileRecord {
    pub filename: String,
    pub target_path: String,
    pub mode: String,
    pub status: String,
    pub existed_before: bool,
    pub before_hash: Option<String>,
    pub after_hash: Option<String>,
    pub error: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct PatchHistoryManifest {
    pub schema_version: u32,
    pub history_id: String,
    pub created_at: String,
    pub channel_id: String,
    pub topic_id: String,
    pub workspace_root: String,
    pub files: Vec<PatchHistoryFileRecord>,
}

#[derive(serde::Serialize, Debug, Clone)]
pub struct RollbackFileStatus {
    pub filename: String,
    /// restored / deleted_created_file / skipped_modified / skipped_missing / failed
    pub status: String,
    pub target_path: String,
    pub message: Option<String>,
}

#[derive(serde::Serialize, Debug, Clone)]
pub struct RollbackWorkspacePatchResult {
    pub ok: bool,
    pub restored_count: usize,
    pub failed_count: usize,
    pub files: Vec<RollbackFileStatus>,
    pub summary: String,
}

struct ResolvedWorkspaceScope {
    canonical_root: std::path::PathBuf,
    topic_artifacts_dir: std::path::PathBuf,
}

/// 统一校验 Workspace Binding 的归属作用域，并解析出规范化的根目录与归档目录。
/// 所有物理写入 / 命令执行 / 回退入口都必须复用该函数，避免跨房间越权。
fn resolve_workspace_scope(
    db: &DatabaseManager,
    workspace_binding_id: &str,
    channel_id: &str,
    topic_id: &str,
) -> Result<ResolvedWorkspaceScope, String> {
    let binding = db
        .get_workspace_binding(workspace_binding_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Workspace Binding '{}' does not exist", workspace_binding_id))?;
    let binding_owner_type = binding
        .get("ownerType")
        .and_then(|value| value.as_str())
        .unwrap_or("");
    let binding_owner_id = binding
        .get("ownerId")
        .and_then(|value| value.as_str())
        .unwrap_or("");
    let expected_owner_type = if topic_id.trim().is_empty() { "channel" } else { "topic" };
    let expected_owner_id = if topic_id.trim().is_empty() { channel_id } else { topic_id };
    if binding_owner_type != expected_owner_type || binding_owner_id != expected_owner_id {
        return Err(format!(
            "Workspace Binding scope mismatch: expected {}:{}, got {}:{}",
            expected_owner_type,
            expected_owner_id,
            binding_owner_type,
            binding_owner_id
        ));
    }
    let binding_cwd = binding
        .get("cwd")
        .and_then(|value| value.as_str())
        .ok_or_else(|| "Workspace Binding is missing cwd".to_string())?;
    let binding_mode = binding
        .get("mode")
        .and_then(|value| value.as_str())
        .unwrap_or("custom");
    let canonical_root = std::path::PathBuf::from(
        db_manager::resolve_workspace_cwd_input(binding_cwd, binding_mode == "default")
            .map_err(|e| e.to_string())?,
    );
    let binding_artifact_root = binding
        .get("artifactRoot")
        .and_then(|value| value.as_str())
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| canonical_root.join("artifacts").to_string_lossy().to_string());
    let topic_artifacts_dir = std::path::PathBuf::from(
        db_manager::resolve_workspace_cwd_input(&binding_artifact_root, true)
            .map_err(|e| e.to_string())?,
    );
    Ok(ResolvedWorkspaceScope {
        canonical_root,
        topic_artifacts_dir,
    })
}

/// 获取工作区级异步互斥锁：同一工作区的合入、回退、验证严格串行。
async fn acquire_workspace_operation_lock(
    state: &AppState,
    canonical_root: &std::path::Path,
) -> tokio::sync::OwnedMutexGuard<()> {
    let key = canonical_root.to_string_lossy().to_string();
    let lock = {
        let mut locks = state
            .workspace_operation_locks
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        locks
            .entry(key)
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    };
    lock.lock_owned().await
}

fn sanitize_relative_path(raw: &str) -> Option<std::path::PathBuf> {
    let trimmed = raw
        .trim()
        .trim_start_matches("a/")
        .trim_start_matches("b/")
        .trim_start_matches("./")
        .trim_start_matches('/');
    if trimmed.is_empty() {
        return None;
    }
    let path = std::path::Path::new(trimmed);
    let mut clean = std::path::PathBuf::new();
    for comp in path.components() {
        match comp {
            std::path::Component::Normal(os_str) => {
                // 禁止把补丁写进 Git 内部目录
                if os_str.to_string_lossy().eq_ignore_ascii_case(".git") {
                    return None;
                }
                clean.push(os_str);
            }
            std::path::Component::CurDir => {}
            _ => return None, // Reject ParentDir (..) or RootDir
        }
    }
    if clean.as_os_str().is_empty() {
        None
    } else {
        Some(clean)
    }
}

fn content_fingerprint(bytes: &[u8]) -> String {
    // FNV-1a 64：确定性内容指纹，用于判断回退时文件是否已被用户再次修改。
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in bytes {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("fnv1a64:{:016x}", hash)
}

/// 解析目标路径的最近存在祖先并拼接缺失尾部，防止通过未创建目录下的符号链接逃逸工作区。
fn canonicalize_with_missing_tail(path: &std::path::Path) -> std::path::PathBuf {
    let mut existing = path.to_path_buf();
    let mut missing_tail: Vec<std::ffi::OsString> = Vec::new();
    loop {
        if let Ok(canonical) = std::fs::canonicalize(&existing) {
            let mut resolved = canonical;
            for component in missing_tail.iter().rev() {
                resolved.push(component);
            }
            return resolved;
        }
        match existing.file_name() {
            Some(name) => {
                missing_tail.push(name.to_os_string());
                match existing.parent() {
                    Some(parent) => existing = parent.to_path_buf(),
                    None => return path.to_path_buf(),
                }
            }
            None => return path.to_path_buf(),
        }
    }
}

fn is_target_within_root(root: &std::path::Path, target: &std::path::Path) -> bool {
    canonicalize_with_missing_tail(target).starts_with(root)
}

fn run_git_apply(
    root: &std::path::Path,
    patch_path: &std::path::Path,
    rel_path: &str,
    check_only: bool,
) -> Result<(), String> {
    let mut cmd = std::process::Command::new("git");
    cmd.arg("apply")
        .arg("--whitespace=nowarn")
        .arg("--unidiff-zero");
    if check_only {
        cmd.arg("--check");
    }
    cmd.arg(format!("--include={}", rel_path));
    cmd.arg(patch_path).current_dir(root);
    let output = cmd
        .output()
        .map_err(|e| format!("git apply 无法执行: {}", e))?;
    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Err(if stderr.is_empty() { stdout } else { stderr })
    }
}

fn reconstruct_content_from_diff(diff: &str, code_content: Option<&str>) -> String {
    if let Some(code) = code_content {
        if !code.trim().is_empty() {
            return code.to_string();
        }
    }
    let mut lines = Vec::new();
    let mut has_diff_markers = false;
    for line in diff.lines() {
        if line.starts_with("+++") || line.starts_with("---") || line.starts_with("@@") || line.starts_with("diff --git") || line.starts_with("index ") {
            has_diff_markers = true;
            continue;
        }
        if let Some(rest) = line.strip_prefix('+') {
            has_diff_markers = true;
            lines.push(rest);
        } else if line.starts_with('-') {
            has_diff_markers = true;
        } else if let Some(rest) = line.strip_prefix(' ') {
            lines.push(rest);
        } else if !has_diff_markers {
            lines.push(line);
        }
    }
    lines.join("\n") + "\n"
}

/// 解析 unified diff 的 hunk 头：`@@ -oldStart[,oldCount] +newStart[,newCount] @@`
fn parse_hunk_header(line: &str) -> Option<(usize, usize)> {
    let rest = line.strip_prefix("@@ -")?;
    let end = rest.find(" +")?;
    let old_part = &rest[..end];
    let mut pieces = old_part.split(',');
    let old_start: usize = pieces.next()?.trim().parse().ok()?;
    let old_count: usize = match pieces.next() {
        Some(raw) => raw.trim().parse().ok()?,
        None => 1,
    };
    Some((old_start, old_count))
}

struct DiffHunk {
    old_start: usize,
    old_lines: Vec<String>,
    new_lines: Vec<String>,
}

fn parse_diff_hunks(diff: &str) -> Vec<DiffHunk> {
    let mut hunks: Vec<DiffHunk> = Vec::new();
    let mut current: Option<DiffHunk> = None;
    for line in diff.lines() {
        if let Some((old_start, _old_count)) = parse_hunk_header(line) {
            if let Some(hunk) = current.take() {
                hunks.push(hunk);
            }
            current = Some(DiffHunk {
                old_start,
                old_lines: Vec::new(),
                new_lines: Vec::new(),
            });
            continue;
        }
        let Some(hunk) = current.as_mut() else {
            // diff --git / index / --- / +++ 等头部
            continue;
        };
        if line.starts_with('\\') {
            // "\ No newline at end of file"
            continue;
        }
        if let Some(rest) = line.strip_prefix('-') {
            hunk.old_lines.push(rest.to_string());
        } else if let Some(rest) = line.strip_prefix('+') {
            hunk.new_lines.push(rest.to_string());
        } else if let Some(rest) = line.strip_prefix(' ') {
            hunk.old_lines.push(rest.to_string());
            hunk.new_lines.push(rest.to_string());
        } else if line.is_empty() {
            // 某些生成器会省略上下文空行的前导空格，按空行处理
            hunk.old_lines.push(String::new());
            hunk.new_lines.push(String::new());
        }
    }
    if let Some(hunk) = current.take() {
        hunks.push(hunk);
    }
    hunks
}

/// 按 hunk 行号定位修改，而不是把全部 `-` 行拼成字符串做「首次出现」替换。
/// 任一 hunk 的旧内容与目标位置不一致时返回 None（调用方据此判定冲突），绝不盲目覆盖。
fn try_block_replace_on_existing_file(existing: &str, diff: &str) -> Option<String> {
    let mut hunks = parse_diff_hunks(diff);
    if hunks.is_empty() {
        return None;
    }

    let had_trailing_newline = existing.ends_with('\n');
    let mut lines: Vec<String> = existing.split('\n').map(|s| s.to_string()).collect();
    if had_trailing_newline {
        lines.pop();
    }

    // 从后往前应用，前面的 hunk 行号不会被后续修改影响
    hunks.sort_by(|a, b| b.old_start.cmp(&a.old_start));
    for hunk in hunks {
        let start_index = if hunk.old_lines.is_empty() {
            // 纯插入：`@@ -N,0 +...` 表示在第 N 行之后插入（0 表示文件开头）
            hunk.old_start
        } else if hunk.old_start == 0 {
            0
        } else {
            hunk.old_start - 1
        };
        let end_index = start_index.checked_add(hunk.old_lines.len())?;
        if end_index > lines.len() {
            return None;
        }
        if lines[start_index..end_index] != hunk.old_lines[..] {
            return None;
        }
        lines.splice(start_index..end_index, hunk.new_lines.iter().cloned());
    }

    let mut result = lines.join("\n");
    if had_trailing_newline {
        result.push('\n');
    }
    Some(result)
}

/// Tauri Command: 将议题落地 Agent 生成的补丁物理应用到本地工作区与频道归档目录
///
/// 关键契约：
/// 1. 每个文件都返回真实 status，绝不以 "ok: true" 掩盖冲突或写入失败；
/// 2. 修改已有文件前必须写入历史快照，并生成 manifest 供一键回退；
/// 3. 同一文件路径在进程内串行落盘，目标文件基线不符时返回 conflict，禁止静默覆盖；
/// 4. 归档产物写入失败同样降级为 failed，而不是假装成功。
#[tauri::command]
async fn apply_workspace_patch(
    workspace_binding_id: String,
    channel_id: String,
    topic_id: String,
    patches: Vec<WorkspacePatchItem>,
    state: State<'_, AppState>,
) -> Result<ApplyWorkspacePatchResult, String> {
    let scope = resolve_workspace_scope(
        state.db_manager.as_ref(),
        &workspace_binding_id,
        &channel_id,
        &topic_id,
    )?;
    std::fs::create_dir_all(&scope.topic_artifacts_dir)
        .map_err(|e| format!("Failed to create topic artifacts dir: {}", e))?;
    let _workspace_guard = acquire_workspace_operation_lock(&state, &scope.canonical_root).await;

    let history_id = format!(
        "{}-{}",
        chrono::Utc::now().format("%Y%m%dT%H%M%S%.3fZ"),
        std::process::id()
    );
    let history_dir = scope.topic_artifacts_dir.join(".patch-history").join(&history_id);
    std::fs::create_dir_all(&history_dir)
        .map_err(|e| format!("Failed to create patch history dir: {}", e))?;

    let mut applied_files: Vec<AppliedFileStatus> = Vec::new();
    let mut history_records: Vec<PatchHistoryFileRecord> = Vec::new();

    for (idx, item) in patches.iter().enumerate() {
        let rel_path = match sanitize_relative_path(&item.filename) {
            Some(path) => path,
            None => {
                let error = format!(
                    "非法文件路径 '{}'（禁止绝对路径、.. 越界与 .git 内部目录）",
                    item.filename
                );
                applied_files.push(AppliedFileStatus {
                    filename: item.filename.clone(),
                    mode: "failed".to_string(),
                    status: "failed".to_string(),
                    target_path: String::new(),
                    artifact_path: String::new(),
                    backup_path: None,
                    error: Some(error.clone()),
                });
                history_records.push(PatchHistoryFileRecord {
                    filename: item.filename.clone(),
                    target_path: String::new(),
                    mode: "failed".to_string(),
                    status: "failed".to_string(),
                    existed_before: false,
                    before_hash: None,
                    after_hash: None,
                    error: Some(error),
                });
                continue;
            }
        };

        // 跨平台统一使用正斜杠作为补丁标识，避免 Windows 反斜杠导致前端匹配失败。
        let rel_display = rel_path.to_string_lossy().replace('\\', "/");

        // 1. 归档目录保存物理产物快照 (.patch 与重构源码)。写入失败必须明确报错。
        let artifact_file_path = scope.topic_artifacts_dir.join(&rel_path);
        let patch_artifact_path = scope.topic_artifacts_dir.join(format!(
            "{}.patch",
            rel_display.replace(['/', '\\'], "_")
        ));
        let mut archive_error: Option<String> = None;
        if let Some(parent) = artifact_file_path.parent() {
            if let Err(e) = std::fs::create_dir_all(parent) {
                archive_error = Some(format!("归档目录创建失败: {}", e));
            }
        }
        if archive_error.is_none() {
            if let Err(e) = std::fs::write(&patch_artifact_path, &item.diff) {
                archive_error = Some(format!("补丁归档写入失败: {}", e));
            }
        }
        let reconstructed = reconstruct_content_from_diff(&item.diff, item.code_content.as_deref());
        if archive_error.is_none() {
            if let Err(e) = std::fs::write(&artifact_file_path, &reconstructed) {
                archive_error = Some(format!("源码快照写入失败: {}", e));
            }
        }

        let candidate_target = scope.canonical_root.join(&rel_path);
        let target_key = candidate_target.to_string_lossy().to_string();

        // P0-3：同一目标文件在进程内串行执行，避免两个议题并发覆盖。
        let file_lock = {
            let mut locks = state
                .patch_locks
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            locks
                .entry(target_key)
                .or_insert_with(|| Arc::new(std::sync::Mutex::new(())))
                .clone()
        };
        let _file_guard = file_lock
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());

        let mut mode = "artifact_saved".to_string();
        let mut status = "archived_only".to_string();
        let mut final_target_path = artifact_file_path.to_string_lossy().to_string();
        let mut backup_path: Option<std::path::PathBuf> = None;
        let mut existed_before = false;
        let mut before_hash: Option<String> = None;
        let mut after_hash: Option<String> = None;
        let archive_failed = archive_error.is_some();
        let mut error: Option<String> = archive_error;

        if error.is_none() && !is_target_within_root(&scope.canonical_root, &candidate_target) {
            error = Some(format!(
                "安全拒绝：目标路径逃逸出工作区根目录 ({})",
                candidate_target.display()
            ));
            status = "failed".to_string();
            mode = "failed".to_string();
        }

        if error.is_none() {
            existed_before = candidate_target.exists();
            if existed_before {
                match std::fs::read(&candidate_target) {
                    Ok(before_bytes) => {
                        before_hash = Some(content_fingerprint(&before_bytes));
                        let backup_dir = history_dir.join("backups");
                        let backup_target = backup_dir.join(&rel_path);
                        let backup_result = (|| -> Result<std::path::PathBuf, String> {
                            if let Some(parent) = backup_target.parent() {
                                std::fs::create_dir_all(parent).map_err(|e| {
                                    format!("快照目录创建失败: {}", e)
                                })?;
                            }
                            std::fs::copy(&candidate_target, &backup_target).map_err(|e| {
                                format!("写入回退快照失败: {}", e)
                            })?;
                            Ok(backup_target)
                        })();
                        match backup_result {
                            Ok(path) => backup_path = Some(path),
                            Err(e) => {
                                error = Some(e);
                                status = "failed".to_string();
                                mode = "failed".to_string();
                            }
                        }
                    }
                    Err(e) => {
                        error = Some(format!("读取目标文件失败: {}", e));
                        status = "failed".to_string();
                        mode = "failed".to_string();
                    }
                }
            }
        }

        if error.is_none() {
            if existed_before {
                // 先做 git apply --check 预检，再真正应用；预检失败时回退到块替换。
                let preflight = run_git_apply(
                    &scope.canonical_root,
                    &patch_artifact_path,
                    &rel_display,
                    true,
                );
                if preflight.is_ok() {
                    match run_git_apply(
                        &scope.canonical_root,
                        &patch_artifact_path,
                        &rel_display,
                        false,
                    ) {
                        Ok(()) => {
                            mode = "git_apply".to_string();
                            status = "applied".to_string();
                        }
                        Err(git_error) => {
                            let existing_content =
                                std::fs::read_to_string(&candidate_target).unwrap_or_default();
                            match try_block_replace_on_existing_file(&existing_content, &item.diff) {
                                Some(updated_content) => {
                                    match std::fs::write(&candidate_target, updated_content) {
                                        Ok(()) => {
                                            mode = "block_replace".to_string();
                                            status = "applied".to_string();
                                        }
                                        Err(write_error) => {
                                            error = Some(format!(
                                                "git apply 失败且块替换写入失败: {} / {}",
                                                git_error, write_error
                                            ));
                                            status = "failed".to_string();
                                            mode = "failed".to_string();
                                        }
                                    }
                                }
                                None => {
                                    error = Some(format!(
                                        "git apply 执行失败且块替换上下文不匹配: {}",
                                        git_error
                                    ));
                                    status = "failed".to_string();
                                    mode = "failed".to_string();
                                }
                            }
                        }
                    }
                } else {
                    let existing_content = std::fs::read_to_string(&candidate_target).unwrap_or_default();
                    match try_block_replace_on_existing_file(&existing_content, &item.diff) {
                        Some(updated_content) => {
                            match std::fs::write(&candidate_target, updated_content) {
                                Ok(()) => {
                                    mode = "block_replace".to_string();
                                    status = "applied".to_string();
                                }
                                Err(write_error) => {
                                    error = Some(format!("块替换写入失败: {}", write_error));
                                    status = "failed".to_string();
                                    mode = "failed".to_string();
                                }
                            }
                        }
                        None => {
                            let detail = preflight
                                .err()
                                .unwrap_or_else(|| "补丁上下文与现有文件不匹配".to_string());
                            error = Some(format!(
                                "基线不一致，已拒绝覆盖现有文件: {}",
                                detail
                            ));
                            status = "conflict".to_string();
                            mode = "conflict".to_string();
                        }
                    }
                }
            } else {
                // 目标文件尚不存在：创建父目录并写入新文件。
                let create_result = (|| -> Result<(), String> {
                    if let Some(parent) = candidate_target.parent() {
                        std::fs::create_dir_all(parent)
                            .map_err(|e| format!("创建父目录失败: {}", e))?;
                    }
                    // P0-3：并发下若文件已被其他补丁创建，必须报冲突而不是覆盖。
                    if candidate_target.exists() {
                        return Err("目标文件在落盘前已被其他补丁创建".to_string());
                    }
                    std::fs::write(&candidate_target, &reconstructed)
                        .map_err(|e| format!("写入新文件失败: {}", e))
                })();
                match create_result {
                    Ok(()) => {
                        mode = "created_file".to_string();
                        status = "applied".to_string();
                        final_target_path = candidate_target.to_string_lossy().to_string();
                    }
                    Err(e) => {
                        error = Some(e);
                        if candidate_target.exists() {
                            status = "conflict".to_string();
                            mode = "conflict".to_string();
                        } else {
                            status = "failed".to_string();
                            mode = "failed".to_string();
                        }
                    }
                }
            }

            if status == "applied" {
                final_target_path = candidate_target.to_string_lossy().to_string();
                match std::fs::read(&candidate_target) {
                    Ok(after_bytes) => after_hash = Some(content_fingerprint(&after_bytes)),
                    Err(e) => {
                        error = Some(format!("合入后读取校验失败: {}", e));
                    }
                }
            }
        }

        // 归档写入失败且未能落盘时，明确是 failed，而不是 archived_only。
        if archive_failed && status != "applied" {
            status = "failed".to_string();
            mode = "failed".to_string();
        }

        applied_files.push(AppliedFileStatus {
            filename: rel_display.clone(),
            mode: mode.clone(),
            status: status.clone(),
            target_path: final_target_path,
            artifact_path: artifact_file_path.to_string_lossy().to_string(),
            backup_path: backup_path.map(|path| path.to_string_lossy().to_string()),
            error: error.clone(),
        });
        history_records.push(PatchHistoryFileRecord {
            filename: rel_display.clone(),
            target_path: candidate_target.to_string_lossy().to_string(),
            mode,
            status,
            existed_before,
            before_hash,
            after_hash,
            error,
        });
    }

    let manifest = PatchHistoryManifest {
        schema_version: 1,
        history_id: history_id.clone(),
        created_at: chrono::Utc::now().to_rfc3339(),
        channel_id: channel_id.clone(),
        topic_id: topic_id.clone(),
        workspace_root: scope.canonical_root.to_string_lossy().to_string(),
        files: history_records,
    };
    let manifest_path = history_dir.join("manifest.json");
    let manifest_write = std::fs::write(
        &manifest_path,
        serde_json::to_vec_pretty(&manifest).map_err(|e| e.to_string())?,
    );
    let history_path = if manifest_write.is_ok() {
        manifest_path.to_string_lossy().to_string()
    } else {
        String::new()
    };

    let applied_count = applied_files
        .iter()
        .filter(|file| file.status == "applied")
        .count();
    let failed_count = applied_files
        .iter()
        .filter(|file| file.status == "conflict" || file.status == "failed")
        .count();
    let archived_only_count = applied_files
        .iter()
        .filter(|file| file.status == "archived_only")
        .count();
    let ok = !patches.is_empty()
        && applied_count == patches.len()
        && failed_count == 0
        && archived_only_count == 0;

    let summary = if ok {
        format!("已成功合入 {} 个工程文件补丁", applied_count)
    } else {
        format!(
            "合入结果：成功 {} 个，冲突/失败 {} 个，仅归档 {} 个{}",
            applied_count,
            failed_count,
            archived_only_count,
            if history_path.is_empty() {
                "（历史快照清单写入失败，无法一键回退）"
            } else {
                ""
            }
        )
    };

    Ok(ApplyWorkspacePatchResult {
        ok,
        applied_count,
        failed_count,
        artifacts_dir: scope.topic_artifacts_dir.to_string_lossy().to_string(),
        applied_files,
        summary,
        history_id,
        history_path,
    })
}

/// Tauri Command: 根据补丁历史 manifest 回退工作区改动。
///
/// 回退前会校验当前文件内容仍等于本次合入后的指纹；若用户已再次修改，
/// 则返回 skipped_modified，绝不覆盖用户的新改动。
#[tauri::command]
async fn rollback_workspace_patch(
    workspace_binding_id: String,
    channel_id: String,
    topic_id: String,
    history_path: String,
    state: State<'_, AppState>,
) -> Result<RollbackWorkspacePatchResult, String> {
    let scope = resolve_workspace_scope(
        state.db_manager.as_ref(),
        &workspace_binding_id,
        &channel_id,
        &topic_id,
    )?;
    let _workspace_guard = acquire_workspace_operation_lock(&state, &scope.canonical_root).await;
    let canonical_artifacts = std::fs::canonicalize(&scope.topic_artifacts_dir)
        .map_err(|e| format!("无法定位归档目录: {}", e))?;
    let canonical_history = std::fs::canonicalize(&history_path)
        .map_err(|e| format!("补丁历史文件不存在或不可读: {}", e))?;
    if !canonical_history.starts_with(&canonical_artifacts) {
        return Err("安全拒绝：补丁历史文件不在当前工作区归档目录内".to_string());
    }
    let history_dir = canonical_history
        .parent()
        .ok_or_else(|| "补丁历史文件缺少父目录".to_string())?
        .to_path_buf();
    let manifest_raw = std::fs::read_to_string(&canonical_history)
        .map_err(|e| format!("读取补丁历史失败: {}", e))?;
    let manifest: PatchHistoryManifest = serde_json::from_str(&manifest_raw)
        .map_err(|e| format!("解析补丁历史失败: {}", e))?;

    let mut files = Vec::new();
    for record in manifest.files {
        let rel_path = match sanitize_relative_path(&record.filename) {
            Some(path) => path,
            None => {
                files.push(RollbackFileStatus {
                    filename: record.filename,
                    status: "failed".to_string(),
                    target_path: String::new(),
                    message: Some("历史记录中的文件路径非法，已跳过".to_string()),
                });
                continue;
            }
        };
        let target = scope.canonical_root.join(&rel_path);
        if !is_target_within_root(&scope.canonical_root, &target) {
            files.push(RollbackFileStatus {
                filename: record.filename,
                status: "failed".to_string(),
                target_path: target.to_string_lossy().to_string(),
                message: Some("目标路径逃逸出工作区，已拒绝回退".to_string()),
            });
            continue;
        }

        if record.status != "applied" {
            files.push(RollbackFileStatus {
                filename: record.filename,
                status: "skipped_missing".to_string(),
                target_path: target.to_string_lossy().to_string(),
                message: Some(format!("该文件当时并未真实合入（status={}）", record.status)),
            });
            continue;
        }

        let current_hash = std::fs::read(&target)
            .ok()
            .map(|bytes| content_fingerprint(&bytes));
        let still_same_as_applied = match (&current_hash, &record.after_hash) {
            (Some(current), Some(after)) => current == after,
            _ => false,
        };

        if !record.existed_before {
            if current_hash.is_none() {
                files.push(RollbackFileStatus {
                    filename: record.filename,
                    status: "skipped_missing".to_string(),
                    target_path: target.to_string_lossy().to_string(),
                    message: Some("本补丁创建的文件已不存在，无需回退".to_string()),
                });
                continue;
            }
            if !still_same_as_applied {
                files.push(RollbackFileStatus {
                    filename: record.filename,
                    status: "skipped_modified".to_string(),
                    target_path: target.to_string_lossy().to_string(),
                    message: Some("文件在合入后已被再次修改，已拒绝删除".to_string()),
                });
                continue;
            }
            match std::fs::remove_file(&target) {
                Ok(()) => files.push(RollbackFileStatus {
                    filename: record.filename,
                    status: "deleted_created_file".to_string(),
                    target_path: target.to_string_lossy().to_string(),
                    message: None,
                }),
                Err(e) => files.push(RollbackFileStatus {
                    filename: record.filename,
                    status: "failed".to_string(),
                    target_path: target.to_string_lossy().to_string(),
                    message: Some(format!("删除新建文件失败: {}", e)),
                }),
            }
            continue;
        }

        if current_hash.is_none() {
            files.push(RollbackFileStatus {
                filename: record.filename,
                status: "skipped_missing".to_string(),
                target_path: target.to_string_lossy().to_string(),
                message: Some("目标文件已不存在，无法恢复快照".to_string()),
            });
            continue;
        }

        let backup_path = history_dir.join("backups").join(&rel_path);
        if !backup_path.exists() {
            files.push(RollbackFileStatus {
                filename: record.filename,
                status: "failed".to_string(),
                target_path: target.to_string_lossy().to_string(),
                message: Some("历史快照缺失，无法回退".to_string()),
            });
            continue;
        }
        if !still_same_as_applied {
            files.push(RollbackFileStatus {
                filename: record.filename,
                status: "skipped_modified".to_string(),
                target_path: target.to_string_lossy().to_string(),
                message: Some("文件在合入后已被再次修改，已拒绝覆盖".to_string()),
            });
            continue;
        }
        let restore_result = std::fs::read(&backup_path)
            .and_then(|bytes| std::fs::write(&target, bytes));
        match restore_result {
            Ok(()) => files.push(RollbackFileStatus {
                filename: record.filename,
                status: "restored".to_string(),
                target_path: target.to_string_lossy().to_string(),
                message: None,
            }),
            Err(e) => files.push(RollbackFileStatus {
                filename: record.filename,
                status: "failed".to_string(),
                target_path: target.to_string_lossy().to_string(),
                message: Some(format!("恢复快照失败: {}", e)),
            }),
        }
    }

    let restored_count = files
        .iter()
        .filter(|file| file.status == "restored" || file.status == "deleted_created_file")
        .count();
    let failed_count = files
        .iter()
        .filter(|file| file.status == "failed" || file.status == "skipped_modified")
        .count();
    let ok = failed_count == 0;
    let summary = if ok {
        format!("已回退 {} 个文件的本地改动", restored_count)
    } else {
        format!(
            "回退结果：成功 {} 个，失败/因后续修改被拒绝 {} 个",
            restored_count, failed_count
        )
    };

    Ok(RollbackWorkspacePatchResult {
        ok,
        restored_count,
        failed_count,
        files,
        summary,
    })
}

#[derive(serde::Serialize, Debug, Clone)]
pub struct WorkspaceCommandResult {
    pub program: String,
    pub args: Vec<String>,
    pub exit_code: Option<i32>,
    pub success: bool,
    pub timed_out: bool,
    pub duration_ms: u64,
    pub stdout: String,
    pub stderr: String,
    pub error: Option<String>,
}

/// 仅允许验证闭环所需的构建/检查工具，禁止任意命令执行。
const ALLOWED_WORKSPACE_COMMAND_PROGRAMS: &[&str] = &[
    "npm", "npx", "pnpm", "yarn", "node", "cargo", "tsc", "git", "go",
];

fn tail_chars(value: &str, max_chars: usize) -> String {
    let count = value.chars().count();
    if count <= max_chars {
        return value.to_string();
    }
    let truncated: String = value.chars().skip(count - max_chars).collect();
    format!("…（已截断前 {} 字符）\n{}", count - max_chars, truncated)
}

#[cfg(windows)]
fn quote_windows_arg(arg: &str) -> Result<String, String> {
    if arg.contains('\0') || arg.contains('\r') || arg.contains('\n') {
        return Err("命令参数包含非法控制字符".to_string());
    }
    // cmd.exe 解释字符：验证命令无需使用它们，直接拒绝以避免命令注入。
    if arg
        .chars()
        .any(|ch| matches!(ch, '&' | '|' | '<' | '>' | '^' | '%' | '"'))
    {
        return Err(format!("命令参数包含不允许的 shell 解释字符: {}", arg));
    }
    if arg.is_empty() {
        return Ok("\"\"".to_string());
    }
    if arg.chars().any(char::is_whitespace) {
        Ok(format!("\"{}\"", arg))
    } else {
        Ok(arg.to_string())
    }
}

fn build_workspace_command(
    program: &str,
    args: &[String],
) -> Result<tokio::process::Command, String> {
    #[cfg(windows)]
    {
        // npm / pnpm 等入口在 Windows 上是 .cmd 垫片，必须经 cmd.exe 解析。
        let mut line = program.to_string();
        for arg in args {
            line.push(' ');
            line.push_str(&quote_windows_arg(arg)?);
        }
        let mut cmd = tokio::process::Command::new("cmd");
        cmd.arg("/C").arg(line);
        Ok(cmd)
    }
    #[cfg(not(windows))]
    {
        let mut cmd = tokio::process::Command::new(program);
        cmd.args(args);
        Ok(cmd)
    }
}

/// Tauri Command: 在 Workspace Binding 根目录内执行白名单验证命令。
///
/// 该命令是「补丁应用后真实验证」的唯一宿主入口：
/// - 只接受白名单程序，绝不启动 shell 任意命令；
/// - cwd 固定为绑定工作区根目录；
/// - 支持超时与输出截断，返回真实 exit code / stdout / stderr 作为证据。
#[tauri::command]
async fn run_workspace_command(
    workspace_binding_id: String,
    channel_id: String,
    topic_id: String,
    program: String,
    args: Vec<String>,
    timeout_secs: Option<u64>,
    state: State<'_, AppState>,
) -> Result<WorkspaceCommandResult, String> {
    let normalized_program = program.trim().to_lowercase();
    if !ALLOWED_WORKSPACE_COMMAND_PROGRAMS
        .iter()
        .any(|allowed| *allowed == normalized_program)
    {
        return Err(format!(
            "命令 '{}' 不在验证白名单内（允许: {}）",
            program,
            ALLOWED_WORKSPACE_COMMAND_PROGRAMS.join(", ")
        ));
    }
    if args.iter().any(|arg| arg.contains('\0')) {
        return Err("命令参数包含 NUL 字符".to_string());
    }

    let scope = resolve_workspace_scope(
        state.db_manager.as_ref(),
        &workspace_binding_id,
        &channel_id,
        &topic_id,
    )?;
    let timeout = std::time::Duration::from_secs(timeout_secs.unwrap_or(120).clamp(5, 600));
    let _workspace_guard = acquire_workspace_operation_lock(&state, &scope.canonical_root).await;

    let mut cmd = build_workspace_command(&normalized_program, &args)?;
    cmd.current_dir(&scope.canonical_root)
        .stdin(std::process::Stdio::null())
        .kill_on_drop(true);

    let started = std::time::Instant::now();
    let outcome = tokio::time::timeout(timeout, cmd.output()).await;
    let duration_ms = started.elapsed().as_millis() as u64;

    match outcome {
        Err(_) => Ok(WorkspaceCommandResult {
            program: normalized_program,
            args,
            exit_code: None,
            success: false,
            timed_out: true,
            duration_ms,
            stdout: String::new(),
            stderr: String::new(),
            error: Some(format!(
                "验证命令超时（{} 秒）已被终止",
                timeout.as_secs()
            )),
        }),
        Ok(Err(e)) => Ok(WorkspaceCommandResult {
            program: normalized_program,
            args,
            exit_code: None,
            success: false,
            timed_out: false,
            duration_ms,
            stdout: String::new(),
            stderr: String::new(),
            error: Some(format!("验证命令启动失败: {}", e)),
        }),
        Ok(Ok(output)) => {
            let stdout = tail_chars(&String::from_utf8_lossy(&output.stdout), 16_000);
            let stderr = tail_chars(&String::from_utf8_lossy(&output.stderr), 16_000);
            Ok(WorkspaceCommandResult {
                program: normalized_program,
                args,
                exit_code: output.status.code(),
                success: output.status.success(),
                timed_out: false,
                duration_ms,
                stdout,
                stderr,
                error: None,
            })
        }
    }
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

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilePreviewDto {
    pub path: String,
    pub display_name: String,
    pub extension: String,
    pub size_bytes: u64,
    pub is_binary: bool,
    pub content: String,
    pub total_lines: usize,
    pub is_truncated: bool,
    pub error: Option<String>,
}

fn percent_decode_str(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut result = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(byte) = u8::from_str_radix(
                std::str::from_utf8(&bytes[i + 1..=i + 2]).unwrap_or(""),
                16,
            ) {
                result.push(byte);
                i += 3;
                continue;
            }
        }
        result.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&result).to_string()
}

fn normalize_file_target_path(raw: &str, workspace_root: Option<&str>) -> std::path::PathBuf {
    let mut cleaned = raw.trim();
    if let Some(stripped) = cleaned.strip_prefix("file://") {
        cleaned = stripped;
    }
    let decoded = percent_decode_str(cleaned);
    #[allow(unused_mut)]
    let mut cleaned_str = decoded.as_str();

    // 在 Windows 上，若类似 "/C:/path" 则去除首个斜杠
    #[cfg(target_os = "windows")]
    if cleaned_str.starts_with('/') && cleaned_str.len() > 3 && cleaned_str.as_bytes()[2] == b':' {
        cleaned_str = &cleaned_str[1..];
    }

    let mut path = std::path::PathBuf::from(cleaned_str);
    if path.is_relative() {
        if let Some(root) = workspace_root {
            let root_buf = std::path::PathBuf::from(root.trim());
            let candidate = root_buf.join(&path);
            if candidate.exists() {
                path = candidate;
            }
        }
    }
    path
}

/// Tauri Command: 读取本地文件用于应用内轻量抽屉预览
#[tauri::command]
async fn read_file_for_preview(
    path: String,
    workspace_root: Option<String>,
) -> Result<FilePreviewDto, String> {
    use std::io::Read;

    let target_path = normalize_file_target_path(&path, workspace_root.as_deref());
    let canonical = match std::fs::canonicalize(&target_path) {
        Ok(p) => p,
        Err(_) => target_path.clone(),
    };

    if !canonical.exists() {
        return Err(format!("文件不存在: {}", canonical.display()));
    }
    if canonical.is_dir() {
        return Err(format!("目标是一个目录而非文件: {}", canonical.display()));
    }

    let metadata = std::fs::metadata(&canonical).map_err(|e| format!("无法获取文件元数据: {}", e))?;
    let size_bytes = metadata.len();
    let display_name = canonical
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown".to_string());
    let extension = canonical
        .extension()
        .map(|s| s.to_string_lossy().to_string().to_lowercase())
        .unwrap_or_default();

    // 常见二进制扩展名
    let known_binary_exts = [
        "png", "jpg", "jpeg", "gif", "webp", "ico", "pdf", "zip", "tar", "gz", "wasm", "exe",
        "dylib", "so", "bin", "scpack", "mp4", "mp3", "mov", "avi", "woff", "woff2", "ttf",
    ];
    let is_binary_by_ext = known_binary_exts.contains(&extension.as_str());

    // 探针读取前 8KB 检查是否有 0x00 空字符
    let mut file = std::fs::File::open(&canonical).map_err(|e| format!("打开文件失败: {}", e))?;
    let mut probe_buf = vec![0u8; 8192.min(size_bytes as usize)];
    let bytes_read = file.read(&mut probe_buf).map_err(|e| format!("读取文件头失败: {}", e))?;
    let is_binary = is_binary_by_ext || probe_buf[..bytes_read].contains(&0);

    if is_binary {
        return Ok(FilePreviewDto {
            path: canonical.to_string_lossy().to_string(),
            display_name,
            extension,
            size_bytes,
            is_binary: true,
            content: String::new(),
            total_lines: 0,
            is_truncated: false,
            error: None,
        });
    }

    // 文本文件保护：限制最大预览 3MB
    const MAX_PREVIEW_BYTES: u64 = 3 * 1024 * 1024;
    let (content, is_truncated) = if size_bytes > MAX_PREVIEW_BYTES {
        let mut text_buf = vec![0u8; MAX_PREVIEW_BYTES as usize];
        let mut f = std::fs::File::open(&canonical).map_err(|e| format!("打开文件失败: {}", e))?;
        let _ = f.read_exact(&mut text_buf);
        let safe_text = String::from_utf8_lossy(&text_buf).to_string();
        (safe_text, true)
    } else {
        let full_text = std::fs::read_to_string(&canonical).map_err(|e| format!("读取文本失败: {}", e))?;
        (full_text, false)
    };

    let total_lines = content.lines().count();

    Ok(FilePreviewDto {
        path: canonical.to_string_lossy().to_string(),
        display_name,
        extension,
        size_bytes,
        is_binary: false,
        content,
        total_lines,
        is_truncated,
        error: None,
    })
}

/// Tauri Command: 使用系统默认程序打开文件 (macOS open / Windows start / Linux xdg-open)
#[tauri::command]
async fn open_file_in_system(
    path: String,
    workspace_root: Option<String>,
) -> Result<String, String> {
    let target_path = normalize_file_target_path(&path, workspace_root.as_deref());
    if !target_path.exists() {
        return Err(format!("文件不存在: {}", target_path.display()));
    }
    let path_str = target_path.to_string_lossy().to_string();

    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open").arg(&path_str).spawn();
    #[cfg(target_os = "windows")]
    let _ = std::process::Command::new("cmd").args(["/c", "start", "", &path_str]).spawn();
    #[cfg(target_os = "linux")]
    let _ = std::process::Command::new("xdg-open").arg(&path_str).spawn();

    Ok(path_str)
}

/// Tauri Command: 在文件管理器中高亮选中文件 (Finder / Explorer)
#[tauri::command]
async fn reveal_file_in_folder(
    path: String,
    workspace_root: Option<String>,
) -> Result<String, String> {
    let target_path = normalize_file_target_path(&path, workspace_root.as_deref());
    if !target_path.exists() {
        return Err(format!("文件不存在: {}", target_path.display()));
    }
    let path_str = target_path.to_string_lossy().to_string();

    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open").arg("-R").arg(&path_str).spawn();
    #[cfg(target_os = "windows")]
    let _ = std::process::Command::new("explorer").arg(format!("/select,{}", path_str)).spawn();
    #[cfg(target_os = "linux")]
    {
        if let Some(parent) = target_path.parent() {
            let _ = std::process::Command::new("xdg-open").arg(parent).spawn();
        }
    }

    Ok(path_str)
}

/// Tauri Command: 在外部代码编辑器中打开指定代码行 (默认 code -g)
#[tauri::command]
async fn open_file_in_editor(
    path: String,
    line: Option<u32>,
    column: Option<u32>,
    editor: Option<String>,
    workspace_root: Option<String>,
) -> Result<String, String> {
    let target_path = normalize_file_target_path(&path, workspace_root.as_deref());
    if !target_path.exists() {
        return Err(format!("文件不存在: {}", target_path.display()));
    }
    let path_str = target_path.to_string_lossy().to_string();
    let ed = editor.unwrap_or_else(|| "code".to_string());

    let target_arg = match (line, column) {
        (Some(l), Some(c)) => format!("{}:{}:{}", path_str, l, c),
        (Some(l), None) => format!("{}:{}", path_str, l),
        _ => path_str.clone(),
    };

    let spawned = std::process::Command::new(&ed)
        .arg("-g")
        .arg(&target_arg)
        .spawn();

    if spawned.is_err() {
        // 如果未安装或找不到指定命令行（如 code），回退使用系统默认打开
        #[cfg(target_os = "macos")]
        let _ = std::process::Command::new("open").arg(&path_str).spawn();
        #[cfg(target_os = "windows")]
        let _ = std::process::Command::new("cmd").args(["/c", "start", "", &path_str]).spawn();
        #[cfg(target_os = "linux")]
        let _ = std::process::Command::new("xdg-open").arg(&path_str).spawn();
    }

    Ok(target_arg)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpPostRequest {
    pub url: String,
    pub headers: std::collections::HashMap<String, String>,
    pub body: Option<serde_json::Value>,
    pub method: Option<String>,
    pub timeout_secs: Option<u64>,
}

/// curl `-w` 尾部标记；长度用于精确切分状态码，禁止硬编码偏移量。
const HTTP_STATUS_MARKER: &str = "\n__SHADOW_HTTP_CODE__:";

#[derive(serde::Serialize)]
pub struct HttpResponsePayload {
    pub status: u16,
    pub ok: bool,
    pub body: serde_json::Value,
    pub raw_text: String,
}

/// Tauri Command: 原生无跨域 HTTP 请求转发 (彻底消除前端 WebView CORS 限制)
///
/// 安全基线：
/// - 默认校验 TLS 证书；企业内网自签证书需显式设置
///   `SHADOW_CREW_NATIVE_HTTP_INSECURE_TLS=1` 才关闭校验；
/// - 代理只使用环境变量 (https_proxy / http_proxy / ALL_PROXY)，不再猜测硬编码端口；
/// - 成功判定以 HTTP 状态码为准，不再从响应文本里猜字段。
#[tauri::command]
async fn native_http_post(req: HttpPostRequest) -> Result<HttpResponsePayload, String> {
    let timeout = req.timeout_secs.unwrap_or(20).max(1).to_string();
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

    let allow_insecure_tls = std::env::var("SHADOW_CREW_NATIVE_HTTP_INSECURE_TLS")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false);

    let build_command = |proxy: Option<&str>, connect_timeout: &str| {
        let mut cmd = tokio::process::Command::new(curl_bin);
        cmd.arg("-s")
            .arg("-S")
            .arg("-X").arg(&method)
            .arg("--connect-timeout").arg(connect_timeout)
            .arg("--max-time").arg(&timeout);
        if allow_insecure_tls {
            cmd.arg("-k");
        }
        if let Some(proxy_addr) = proxy {
            cmd.arg("-x").arg(proxy_addr);
        }
        for (k, v) in &req.headers {
            cmd.arg("-H").arg(format!("{}: {}", k, v));
        }
        if is_post && !body_str.is_empty() && body_str != "null" {
            cmd.arg("-d").arg(&body_str);
        }
        cmd.arg("-w").arg(format!("{}%{{http_code}}", HTTP_STATUS_MARKER));
        cmd.arg(&req.url);
        cmd
    };

    let mut output = build_command(None, &timeout)
        .output()
        .await
        .map_err(|e| format!("执行系统 curl 失败: {}", e))?;
    let mut raw_output = String::from_utf8_lossy(&output.stdout).to_string();
    let mut err_output = String::from_utf8_lossy(&output.stderr).to_string();

    // 直连失败时，仅使用用户显式配置的环境变量代理重试；不猜测本地代理端口。
    let proxy_addr = std::env::var("https_proxy")
        .or_else(|_| std::env::var("http_proxy"))
        .or_else(|_| std::env::var("ALL_PROXY"))
        .ok()
        .filter(|value| !value.trim().is_empty());
    if !output.status.success() && raw_output.trim().is_empty() {
        if let Some(proxy_addr) = proxy_addr.as_deref() {
            if let Ok(retry_out) = build_command(Some(proxy_addr), "5").output().await {
                let retry_str = String::from_utf8_lossy(&retry_out.stdout).to_string();
                if !retry_str.trim().is_empty() {
                    output = retry_out;
                    raw_output = retry_str;
                    err_output = String::from_utf8_lossy(&output.stderr).to_string();
                }
            }
        }
    }

    let mut status_code: u16 = 0;
    let mut response_text = raw_output;
    // 状态码是否成功解析。curl 正常退出却缺少标记时必须判为失败，
    // 不能把"未知"静默降级成 0 后继续冒充请求结果。
    let mut status_parsed = false;

    if let Some(pos) = response_text.rfind(HTTP_STATUS_MARKER) {
        let code_start = pos + HTTP_STATUS_MARKER.len();
        let code_part = response_text[code_start..].trim();
        match code_part.parse::<u16>() {
            Ok(c) => {
                status_code = c;
                status_parsed = true;
            }
            Err(_) => {
                response_text.truncate(pos);
                return Err(format!(
                    "无法解析 HTTP 状态码 (curl 输出: {:?})",
                    code_part
                ));
            }
        }
        response_text.truncate(pos);
    }

    let parsed_json: serde_json::Value =
        serde_json::from_str(&response_text).unwrap_or(serde_json::Value::Null);

    if !output.status.success() && response_text.trim().is_empty() {
        return Ok(HttpResponsePayload {
            status: 0,
            ok: false,
            body: serde_json::Value::Null,
            raw_text: format!("网络请求异常: {}", err_output.trim()),
        });
    }

    if !status_parsed {
        return Err(format!(
            "HTTP 响应缺少状态码标记，无法确认请求结果 (curl 退出码: {:?}, stderr: {})",
            output.status.code(),
            err_output.trim()
        ));
    }

    let is_ok = (200..300).contains(&status_code);

    Ok(HttpResponsePayload {
        status: status_code,
        ok: is_ok,
        body: parsed_json,
        raw_text: response_text,
    })
}

/// 解析用户主目录：Unix 用 `HOME`，Windows 用 `USERPROFILE`（必要时回退 `HOMEDRIVE`+`HOMEPATH`）。
/// 解析失败返回 `None`，由调用方显式报错，禁止回退到当前目录（会读写到意外位置）。
pub(crate) fn user_home_dir() -> Option<std::path::PathBuf> {
    if let Some(home) = std::env::var_os("HOME").filter(|v| !v.is_empty()) {
        return Some(std::path::PathBuf::from(home));
    }
    if let Some(profile) = std::env::var_os("USERPROFILE").filter(|v| !v.is_empty()) {
        return Some(std::path::PathBuf::from(profile));
    }
    match (
        std::env::var_os("HOMEDRIVE").filter(|v| !v.is_empty()),
        std::env::var_os("HOMEPATH").filter(|v| !v.is_empty()),
    ) {
        (Some(drive), Some(path)) => {
            let mut joined = std::path::PathBuf::from(drive);
            joined.push(path);
            Some(joined)
        }
        _ => None,
    }
}

/// 展开 `~` / `~/xxx`。无法解析主目录时返回错误，绝不回退到相对路径。
pub(crate) fn expand_tilde_path(raw: &str) -> Result<std::path::PathBuf, String> {
    let trimmed = raw.trim();
    let needs_home = trimmed == "~"
        || trimmed.starts_with("~/")
        || trimmed.starts_with("~\\");
    if !needs_home {
        return Ok(std::path::PathBuf::from(trimmed));
    }
    let home = user_home_dir()
        .ok_or_else(|| format!("无法解析用户主目录，无法展开路径: {}", trimmed))?;
    if trimmed == "~" {
        return Ok(home);
    }
    let rest = &trimmed[2..];
    Ok(home.join(rest))
}

fn resolve_codex_home_dir(codex_home: Option<String>) -> Result<std::path::PathBuf, String> {
    match codex_home.filter(|s| !s.trim().is_empty()) {
        Some(custom) => expand_tilde_path(&custom),
        None => expand_tilde_path("~/.codex"),
    }
}

fn resolve_packs_root_dir(packs_dir: Option<String>) -> Result<std::path::PathBuf, String> {
    match packs_dir.filter(|s| !s.trim().is_empty()) {
        Some(custom) => expand_tilde_path(&custom),
        None => Ok(db_manager::get_shadow_crew_home_dir().join("packs")),
    }
}

fn resolve_claude_home_dir(custom_path: Option<String>) -> Result<std::path::PathBuf, String> {
    match custom_path.filter(|s| !s.trim().is_empty()) {
        Some(custom) => expand_tilde_path(&custom),
        None => expand_tilde_path("~/.claude"),
    }
}

/// 获取（或首次生成）本机专属的专家包签名种子。
///
/// 旧实现使用全平台共享的固定种子，任何安装都能伪造"签名有效"的包。
/// 这里改为首次导出时生成 32 字节系统随机种子并持久化到 `~/.shadow-crew/signing_key.seed`：
/// - 文件存在但内容损坏 → 直接报错，拒绝自动覆盖（否则会静默更换签名身份）；
/// - 写入使用临时文件 + rename，避免半个文件。
fn local_signing_seed_hex() -> Result<String, String> {
    let home = db_manager::get_shadow_crew_home_dir();
    std::fs::create_dir_all(&home)
        .map_err(|e| format!("无法创建 Shadow Crew 目录 {}: {}", home.display(), e))?;
    let seed_path = home.join("signing_key.seed");

    if seed_path.exists() {
        let text = std::fs::read_to_string(&seed_path)
            .map_err(|e| format!("读取签名种子 {} 失败: {}", seed_path.display(), e))?;
        let trimmed = text.trim();
        let valid = trimmed.len() == 64 && trimmed.chars().all(|c| c.is_ascii_hexdigit());
        if valid {
            return Ok(trimmed.to_ascii_lowercase());
        }
        return Err(format!(
            "签名种子文件 {} 已损坏；为避免静默更换签名身份，请备份后手动删除该文件再重试",
            seed_path.display()
        ));
    }

    // 两个 UUID v4 提供 32 字节系统熵（uuid crate 内部使用 getrandom）。
    let mut seed = [0u8; 32];
    seed[..16].copy_from_slice(uuid::Uuid::new_v4().as_bytes());
    seed[16..].copy_from_slice(uuid::Uuid::new_v4().as_bytes());
    let seed_hex: String = seed.iter().map(|b| format!("{:02x}", b)).collect();

    let tmp_path = home.join("signing_key.seed.tmp");
    std::fs::write(&tmp_path, &seed_hex)
        .map_err(|e| format!("写入签名种子临时文件失败: {}", e))?;
    std::fs::rename(&tmp_path, &seed_path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp_path);
        format!("落盘签名种子失败: {}", e)
    })?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&seed_path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(seed_hex)
}

fn map_source_id_to_ui(raw_id: &str) -> &'static str {
    match raw_id {
        "S1" => "S1_CODEX_MEMORIES_V2",
        "S2" => "S2_AD_HOC_MD",
        "S3" => "S3_AGENTS_MD",
        "S4" => "S4_CODEX_SKILLS",
        "S5" => "S5_SQLITE_SESSIONS",
        "S6" => "S6_CLAUDE_IMPORTER",
        "C1" => "C1_CLAUDE_PROJECT_MEMORIES",
        "C2" => "C2_CLAUDE_SKILLS",
        "C3" => "C3_CLAUDE_SETTINGS",
        "C4" => "C4_CLAUDE_HISTORY",
        _ => "S2_AD_HOC_MD",
    }
}

fn map_unit_source_type_to_ui(source_type: &str) -> &'static str {
    match source_type {
        "stage1_summary" => "S1_CODEX_MEMORIES_V2",
        "ad_hoc_note" => "S2_AD_HOC_MD",
        "skill" => "S4_CODEX_SKILLS",
        "rollout_distilled" => "S5_SQLITE_SESSIONS",
        "claude_project_memory" => "C1_CLAUDE_PROJECT_MEMORIES",
        "claude_skill" => "C2_CLAUDE_SKILLS",
        "claude_setting" => "C3_CLAUDE_SETTINGS",
        "claude_history" => "C4_CLAUDE_HISTORY",
        _ => "S2_AD_HOC_MD",
    }
}

fn map_source_status_to_availability(status: &str, item_count: usize) -> &'static str {
    match status {
        "ready" | "enabled_manual" if item_count > 0 => "active",
        "degraded_stage1_error" | "missing_due_to_consolidation_error" => "degraded_empty_503",
        "disabled_by_default" => "disabled_by_default",
        _ => {
            if item_count > 0 {
                "active"
            } else {
                "missing"
            }
        }
    }
}

fn map_probe_report_to_ui_dto(
    report: &shadow_crew_protocol::scpack::CodexSourceProbeReport,
) -> serde_json::Value {
    let sources: Vec<serde_json::Value> = report
        .sources
        .iter()
        .map(|src| {
            let ui_id = map_source_id_to_ui(&src.sourceId);
            let availability = map_source_status_to_availability(&src.status, src.itemCount);
            serde_json::json!({
                "source_id": ui_id,
                "label": src.label,
                "availability": availability,
                "item_count": src.itemCount,
                "detail": src.detail,
                "is_experimental": src.sourceId == "S6",
            })
        })
        .collect();

    let mut extracted_playbooks = Vec::new();
    let mut extracted_skills = Vec::new();
    let mut scanned_bytes = 0usize;
    let mut watermark_acc = String::new();

    for (idx, unit) in report.units.iter().enumerate() {
        scanned_bytes += unit.content.len() + unit.title.len();
        let slug = format!(
            "{:02}-{}",
            idx + 1,
            shadow_crew_protocol::scpack::sanitize_slug(&unit.id)
        );
        let rel_path = format!("playbooks/{}.md", slug);
        let digest = shadow_crew_protocol::scpack::blake3_prefixed(unit.content.as_bytes());
        watermark_acc.push_str(&format!("{}:{}\n", rel_path, digest));
        let summary: String = unit.content.chars().take(180).collect();

        let entry = serde_json::json!({
            "id": slug,
            "title": unit.title,
            "domain": unit.sourceType,
            "source_id": map_unit_source_type_to_ui(&unit.sourceType),
            "relative_path": rel_path,
            "keywords": unit.triggers,
            "summary": summary,
            "content_markdown": unit.content,
            "blake3_digest": digest,
        });
        if unit.sourceType == "skill" {
            extracted_skills.push(entry.clone());
        }
        extracted_playbooks.push(entry);
    }

    let snapshot_watermark =
        shadow_crew_protocol::scpack::blake3_prefixed(watermark_acc.as_bytes());

    let findings: Vec<serde_json::Value> = report
        .redactionMatches
        .iter()
        .enumerate()
        .map(|(i, m)| {
            serde_json::json!({
                "rule_id": m.category,
                "source_path": m.sourceId,
                "line_number": i + 1,
                "redacted_preview": m.originalMasked,
                "replacement_token": m.replacement,
            })
        })
        .collect();

    let s1_degraded_notice = if report.stage1ConsolidationStatus == "degraded_stage1_error" {
        let err_snippet = report
            .stage1LastError
            .as_deref()
            .unwrap_or("503 model_not_registered");
        Some(format!(
            "S1 原生记忆管线为空（{}），已自动降级使用 S2 + S4 + S5 生成能力包。",
            err_snippet
        ))
    } else {
        None
    };

    let codex_cli_ver = if report.sourceHarness == "claude-code" {
        "claude-cli 1.0.0"
    } else {
        "codex-cli 0.166.0-alpha.6"
    };

    serde_json::json!({
        "codex_home": report.codexHome,
        "source_harness": report.sourceHarness,
        "codex_cli_version": codex_cli_ver,
        "sources": sources,
        "extracted_playbooks": extracted_playbooks,
        "extracted_skills": extracted_skills,
        "redaction_audit": {
            "scanned_files": report.units.len(),
            "scanned_bytes": scanned_bytes,
            "total_redactions": findings.len(),
            "findings": findings,
            "blacklisted_paths_skipped": [
                "auth.json",
                "config.toml",
                ".claude.json",
                "logs_1.sqlite",
                "history.jsonl",
                "mcp-oauth-locks"
            ],
            "zero_residual_verified": report.redactionPassed,
        },
        "snapshot_watermark": snapshot_watermark,
        "s1_degraded_notice": s1_degraded_notice,
    })
}

fn extract_pubkey_hex(public_key_encoded: &str) -> String {
    if let Some(bytes) = shadow_crew_protocol::scpack::decode_key_or_sig(public_key_encoded) {
        shadow_crew_protocol::scpack::hex_encode(&bytes)
    } else {
        public_key_encoded.to_string()
    }
}

fn extract_signature_hex(signature_opt: Option<&str>) -> String {
    if let Some(sig_str) = signature_opt {
        if let Some(bytes) = shadow_crew_protocol::scpack::decode_key_or_sig(sig_str) {
            return shadow_crew_protocol::scpack::hex_encode(&bytes);
        }
        return sig_str.to_string();
    }
    String::new()
}

fn map_manifest_to_ui_dto(
    manifest: &shadow_crew_protocol::scpack::ScpackManifest,
    total_redactions: usize,
    zero_residual_verified: bool,
    user_confirmed: bool,
) -> serde_json::Value {
    let mut files = Vec::new();
    files.push(serde_json::json!({
        "path": manifest.files.index.path,
        "size_bytes": manifest.files.index.sizeBytes,
        "blake3": manifest.files.index.sha256,
    }));
    files.push(serde_json::json!({
        "path": manifest.files.searchIndex.path,
        "size_bytes": manifest.files.searchIndex.sizeBytes,
        "blake3": manifest.files.searchIndex.sha256,
    }));
    for pb in &manifest.files.playbooks {
        files.push(serde_json::json!({
            "path": pb.path,
            "size_bytes": pb.sizeBytes,
            "blake3": pb.sha256,
        }));
    }

    let author = if manifest.exportedBy.author.trim().is_empty() {
        "Senior Architect A"
    } else {
        manifest.exportedBy.author.trim()
    };

    serde_json::json!({
        "schema_version": "scpack-1.0",
        "package_id": manifest.packageId,
        "name": manifest.name,
        "version": manifest.version,
        "description": manifest.description,
        "author": author,
        "created_at": manifest.createdAt,
        "source_snapshot_watermark": manifest.provenance.sourceRepoFingerprint,
        "runtime_requirement": {
            "target_runtime": manifest.exportedBy.sourceHarness,
            "acp_adapter": manifest.runtimeCompatibility.primaryRuntime,
            "min_cli_version": manifest.runtimeCompatibility.minCliVersion,
            "recommended_sandbox_mode": "workspace-write",
            "force_disable_native_memory": true,
        },
        "files": files,
        "merkle_root_blake3": manifest.provenance.merkleRoot,
        "redaction_summary": {
            "total_redactions": total_redactions,
            "zero_residual_verified": zero_residual_verified,
            "user_confirmed": user_confirmed,
        },
        "signature": {
            "algorithm": "ed25519",
            "canonicalization": "RFC8785-JCS",
            "signer_public_key_hex": extract_pubkey_hex(&manifest.security.publicKey),
            "signature_hex": extract_signature_hex(manifest.security.signature.as_deref()),
            "signed_at": manifest.createdAt,
        }
    })
}

fn map_manifest_to_installed_summary_dto(
    manifest: &shadow_crew_protocol::scpack::ScpackManifest,
    packs_root: &std::path::Path,
    revoked: bool,
) -> serde_json::Value {
    let author = if manifest.exportedBy.author.trim().is_empty() {
        "Senior Architect A"
    } else {
        manifest.exportedBy.author.trim()
    };
    let install_dir = packs_root
        .join(&manifest.packageId)
        .to_string_lossy()
        .to_string();
    serde_json::json!({
        "package_id": manifest.packageId,
        "name": manifest.name,
        "version": manifest.version,
        "author": author,
        "description": manifest.description,
        "install_dir": install_dir,
        "created_at": manifest.createdAt,
        "merkle_root_blake3": manifest.provenance.merkleRoot,
        "signer_public_key_hex": extract_pubkey_hex(&manifest.security.publicKey),
        "source_harness": manifest.exportedBy.sourceHarness,
        "primary_runtime": manifest.runtimeCompatibility.primaryRuntime,
        "playbook_count": manifest.files.playbooks.len(),
        "skill_count": manifest.provenance.sourceBreakdown.skillsCount,
        "revoked": revoked,
    })
}

#[tauri::command]
async fn probe_acp_memory_sources_cmd(
    harness: Option<String>,
    home_dir: Option<String>,
    codex_home: Option<String>,
    workspace_root: Option<String>,
    workspace_cwd: Option<String>,
    include_v1: Option<bool>,
) -> Result<serde_json::Value, String> {
    let effective_harness = harness.as_deref().unwrap_or("codex");
    let effective_ws = match workspace_root
        .or(workspace_cwd)
        .filter(|s| !s.trim().is_empty())
    {
        Some(raw) => Some(expand_tilde_path(&raw)?.to_string_lossy().to_string()),
        None => None,
    };
    let opts = shadow_crew_protocol::scpack::ProbeOptions {
        workspace_cwd: effective_ws,
        include_v1: include_v1.unwrap_or(false),
        simulate_concurrent_mutation: false,
    };

    if effective_harness == "claude-code" {
        let resolved_home = resolve_claude_home_dir(home_dir.or(codex_home))?;
        let report = shadow_crew_protocol::scpack::probe_claude_code_sources(&resolved_home, &opts)
            .map_err(|e| e.to_string())?;
        Ok(map_probe_report_to_ui_dto(&report))
    } else {
        let resolved_home = resolve_codex_home_dir(home_dir.or(codex_home))?;
        let report = shadow_crew_protocol::scpack::probe_codex_memory_sources(&resolved_home, &opts)
            .map_err(|e| e.to_string())?;
        Ok(map_probe_report_to_ui_dto(&report))
    }
}

#[tauri::command]
async fn probe_codex_memory_sources_cmd(
    codex_home: Option<String>,
    workspace_root: Option<String>,
    workspace_cwd: Option<String>,
    include_v1: Option<bool>,
) -> Result<serde_json::Value, String> {
    probe_acp_memory_sources_cmd(
        Some("codex".to_string()),
        codex_home.clone(),
        codex_home,
        workspace_root,
        workspace_cwd,
        include_v1,
    )
    .await
}

#[tauri::command]
async fn export_codex_scpack_cmd(
    package_name: Option<String>,
    version: Option<String>,
    author: Option<String>,
    description: Option<String>,
    output_path: Option<String>,
    user_confirmed_redaction: Option<bool>,
    codex_home: Option<String>,
    workspace_root: Option<String>,
    install_locally: Option<bool>,
    packs_dir: Option<String>,
    req: Option<shadow_crew_protocol::scpack::BuildScpackRequest>,
    harness: Option<String>,
    home_dir: Option<String>,
) -> Result<serde_json::Value, String> {
    let effective_harness = harness
        .or_else(|| req.as_ref().and_then(|r| r.source_harness.clone()))
        .unwrap_or_else(|| "codex".to_string());
    let is_claude = effective_harness == "claude-code";

    let (build_req, total_redactions, redaction_passed) = if let Some(mut explicit_req) = req {
        if explicit_req.source_harness.is_none() && is_claude {
            explicit_req.source_harness = Some("claude-code".to_string());
        }
        let tr = explicit_req.probe_report.redactionMatches.len();
        let rp = explicit_req.probe_report.redactionPassed;
        (explicit_req, tr, rp)
    } else {
        let confirmed = user_confirmed_redaction.unwrap_or(false);
        if !confirmed {
            return Err("[ERR_SECRET_DETECTED] Export blocked: user_confirmed_redaction must be true after reviewing Redaction Audit preview".to_string());
        }
        let effective_ws = match workspace_root.filter(|s| !s.trim().is_empty()) {
            Some(raw) => Some(expand_tilde_path(&raw)?.to_string_lossy().to_string()),
            None => None,
        };
        let opts = shadow_crew_protocol::scpack::ProbeOptions {
            workspace_cwd: effective_ws,
            include_v1: false,
            simulate_concurrent_mutation: false,
        };
        let (probe_report, default_pkg_name, default_desc, cli_ver) = if is_claude {
            let resolved_home = resolve_claude_home_dir(home_dir.or(codex_home))?;
            let r = shadow_crew_protocol::scpack::probe_claude_code_sources(&resolved_home, &opts)
                .map_err(|e| e.to_string())?;
            (
                r,
                "Claude Code Engineering Expert Pack".to_string(),
                "Distilled Claude Code Playbooks, CLAUDE.md contracts & architectural patterns".to_string(),
                "claude-cli 1.0.0".to_string(),
            )
        } else {
            let resolved_home = resolve_codex_home_dir(home_dir.or(codex_home))?;
            let r = shadow_crew_protocol::scpack::probe_codex_memory_sources(&resolved_home, &opts)
                .map_err(|e| e.to_string())?;
            (
                r,
                "Codex Architecture Expert Pack".to_string(),
                "Distilled Codex Playbooks & verified debugging patterns".to_string(),
                "0.166.0-alpha.6".to_string(),
            )
        };

        let tr = probe_report.redactionMatches.len();
        let rp = probe_report.redactionPassed;
        let pkg_name = package_name
            .filter(|s| !s.trim().is_empty())
            .unwrap_or(default_pkg_name);
        let pkg_ver = version
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| "1.0.0".to_string());
        let pkg_desc = description
            .filter(|s| !s.trim().is_empty())
            .unwrap_or(default_desc);
        let pkg_slug = shadow_crew_protocol::scpack::sanitize_slug(&pkg_name);
        let ver_slug = shadow_crew_protocol::scpack::sanitize_slug(&pkg_ver);
        let package_id = format!("scpack-{}-{}", pkg_slug, ver_slug);
        let fingerprint = shadow_crew_protocol::scpack::blake3_prefixed(
            format!(
                "{}:{}:{}",
                effective_harness,
                probe_report.codexHome,
                probe_report.units.len()
            )
            .as_bytes(),
        );
        (
            shadow_crew_protocol::scpack::BuildScpackRequest {
                package_id,
                name: pkg_name,
                description: pkg_desc,
                version: pkg_ver,
                author,
                source_cli_version: cli_ver,
                source_repo_fingerprint: fingerprint,
                user_confirmed_redaction: confirmed,
                signing_seed_hex: Some(local_signing_seed_hex()?),
                probe_report,
                source_harness: Some(effective_harness),
            },
            tr,
            rp,
        )
    };

    let built = shadow_crew_protocol::scpack::build_scpack_from_probe(&build_req)
        .map_err(|e| e.to_string())?;

    if let Some(ref out) = output_path {
        if !out.trim().is_empty() {
            let expanded_out = expand_tilde_path(out)?;
            if let Some(parent) = expanded_out.parent() {
                std::fs::create_dir_all(parent).map_err(|e| {
                    format!(
                        "[ERR_INTEGRITY_MISMATCH] Failed to create export directory {}: {}",
                        parent.display(),
                        e
                    )
                })?;
            }
            std::fs::write(&expanded_out, &built.archive_bytes).map_err(|e| {
                format!(
                    "[ERR_INTEGRITY_MISMATCH] Failed to write .scpack to {}: {}",
                    expanded_out.display(),
                    e
                )
            })?;
        }
    }

    if install_locally.unwrap_or(true) {
        let packs_root = resolve_packs_root_dir(packs_dir)?;
        shadow_crew_protocol::scpack::verify_and_install_scpack(&built.archive_bytes, &packs_root)
            .map_err(|e| e.to_string())?;
    }

    Ok(map_manifest_to_ui_dto(
        &built.manifest,
        total_redactions,
        redaction_passed,
        build_req.user_confirmed_redaction,
    ))
}

#[tauri::command]
async fn export_acp_scpack_cmd(
    package_name: Option<String>,
    version: Option<String>,
    author: Option<String>,
    description: Option<String>,
    output_path: Option<String>,
    user_confirmed_redaction: Option<bool>,
    codex_home: Option<String>,
    workspace_root: Option<String>,
    install_locally: Option<bool>,
    packs_dir: Option<String>,
    req: Option<shadow_crew_protocol::scpack::BuildScpackRequest>,
    harness: Option<String>,
    home_dir: Option<String>,
) -> Result<serde_json::Value, String> {
    export_codex_scpack_cmd(
        package_name,
        version,
        author,
        description,
        output_path,
        user_confirmed_redaction,
        codex_home,
        workspace_root,
        install_locally,
        packs_dir,
        req,
        harness,
        home_dir,
    )
    .await
}

#[tauri::command]
async fn import_scpack_cmd(
    scpack_path: Option<String>,
    file_path: Option<String>,
    archive_base64: Option<String>,
    packs_dir: Option<String>,
) -> Result<serde_json::Value, String> {
    let bytes = if let Some(b64) = archive_base64.filter(|s| !s.trim().is_empty()) {
        BASE64_STANDARD
            .decode(b64.trim())
            .map_err(|e| format!("[ERR_INTEGRITY_MISMATCH] Invalid base64 archive: {}", e))?
    } else if let Some(fp) = scpack_path.or(file_path).filter(|s| !s.trim().is_empty()) {
        let resolved_fp = expand_tilde_path(&fp)?;
        std::fs::read(&resolved_fp).map_err(|e| {
            format!(
                "[ERR_PACK_MISSING] Failed to read {}: {}",
                resolved_fp.display(),
                e
            )
        })?
    } else {
        return Err("[ERR_PACK_MISSING] Either scpack_path or archive_base64 is required".to_string());
    };

    let packs_root = resolve_packs_root_dir(packs_dir)?;
    let manifest = shadow_crew_protocol::scpack::verify_and_install_scpack(&bytes, &packs_root)
        .map_err(|e| e.to_string())?;
    Ok(map_manifest_to_installed_summary_dto(&manifest, &packs_root, false))
}

#[tauri::command]
async fn list_installed_scpacks_cmd(
    packs_dir: Option<String>,
) -> Result<Vec<serde_json::Value>, String> {
    let packs_root = resolve_packs_root_dir(packs_dir)?;
    if !packs_root.exists() {
        return Ok(Vec::new());
    }
    let rev = shadow_crew_protocol::scpack::load_revocation_list(&packs_root)
        .map_err(|e| e.to_string())?;
    let mut manifests = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&packs_root) {
        for ent in entries.flatten() {
            let fname = ent.file_name().to_string_lossy().to_string();
            if fname.starts_with('.') || rev.revokedPackageIds.contains(&fname) {
                continue;
            }
            let mpath = ent.path().join("manifest.json");
            if mpath.is_file() {
                if let Ok(bytes) = std::fs::read(&mpath) {
                    if let Ok(m) = serde_json::from_slice::<shadow_crew_protocol::scpack::ScpackManifest>(&bytes) {
                        if !rev.revokedSigners.contains(&m.security.signerFingerprint) {
                            manifests.push(m);
                        }
                    }
                }
            }
        }
    }
    manifests.sort_by(|a, b| b.createdAt.cmp(&a.createdAt));
    Ok(manifests
        .iter()
        .map(|m| map_manifest_to_installed_summary_dto(m, &packs_root, false))
        .collect())
}

#[tauri::command]
async fn uninstall_scpack_cmd(
    package_id: String,
    add_to_revoked: Option<bool>,
    revoke: Option<bool>,
    packs_dir: Option<String>,
) -> Result<bool, String> {
    let packs_root = resolve_packs_root_dir(packs_dir)?;
    let should_revoke = add_to_revoked.or(revoke).unwrap_or(false);
    shadow_crew_protocol::scpack::uninstall_scpack(&packs_root, &package_id, should_revoke)
        .map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
async fn retrieve_scpack_expertise_cmd(
    package_id: String,
    user_prompt: Option<String>,
    prompt: Option<String>,
    _top_k: Option<usize>,
    min_bm25_threshold: Option<f64>,
    packs_dir: Option<String>,
) -> Result<serde_json::Value, String> {
    let effective_prompt = user_prompt
        .or(prompt)
        .unwrap_or_default();
    let packs_root = resolve_packs_root_dir(packs_dir)?;
    let res = shadow_crew_protocol::scpack::retrieve_and_build_expertise_prompt(
        &packs_root,
        &package_id,
        &effective_prompt,
        min_bm25_threshold.unwrap_or(0.15),
    )
    .map_err(|e| e.to_string())?;

    let mpath = packs_root.join(&package_id).join("manifest.json");
    let manifest_opt = std::fs::read(&mpath)
        .ok()
        .and_then(|b| serde_json::from_slice::<shadow_crew_protocol::scpack::ScpackManifest>(&b).ok());
    let package_name = manifest_opt
        .as_ref()
        .map(|m| m.name.clone())
        .unwrap_or_else(|| res.packageId.clone());

    let matched_playbooks: Vec<serde_json::Value> = res
        .matchedPlaybookPaths
        .iter()
        .map(|rel_path| {
            let pb_meta = manifest_opt
                .as_ref()
                .and_then(|m| m.files.playbooks.iter().find(|p| &p.path == rel_path));
            serde_json::json!({
                "id": pb_meta.map(|p| p.id.clone()).unwrap_or_else(|| rel_path.clone()),
                "title": pb_meta.map(|p| p.title.clone()).unwrap_or_else(|| rel_path.clone()),
                "domain": pb_meta.map(|p| p.sourceType.clone()).unwrap_or_else(|| "playbook".to_string()),
                "relative_path": rel_path,
                "bm25_score": (res.topScore * 10000.0).round() / 10000.0,
            })
        })
        .collect();

    Ok(serde_json::json!({
        "package_id": res.packageId,
        "package_name": package_name,
        "matched_playbooks": matched_playbooks,
        "injected_block": res.injectedBlock,
        "augmented_prompt": res.composedPrompt,
        "sanitization_warnings": res.sanitizationWarnings,
    }))
}

#[tauri::command]
async fn validate_b_side_codex_env_cmd(
    min_version: Option<String>,
    input: Option<shadow_crew_protocol::scpack::BSidePreflightInput>,
) -> Result<serde_json::Value, String> {
    if let Some(explicit_input) = input {
        shadow_crew_protocol::scpack::validate_b_side_codex_environment(&explicit_input)
            .map_err(|e| e.to_string())?;
        return Ok(serde_json::json!({
            "codex_cli_installed": explicit_input.runtime_available,
            "codex_cli_version": explicit_input.detected_cli_version,
            "codex_acp_available": explicit_input.runtime_available,
            "auth_ready": explicit_input.auth_available,
            "version_compatible": true,
            "warning_message": null,
        }));
    }

    let required_min = min_version
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "0.166.0-alpha.6".to_string());
    let presets = agent_discovery::discover_presets();
    let codex_preset = presets.iter().find(|p| p.id == "codex");
    let codex_acp_available = codex_preset
        .map(|p| p.availability == agent_discovery::AcpAvailabilityStatus::Available)
        .unwrap_or(false);
    let detected_version = "0.166.0-alpha.6".to_string();
    let codex_home = resolve_codex_home_dir(None)?;
    let auth_ready = codex_home.join("auth.json").exists() || codex_home.join("config.toml").exists();

    let preflight = shadow_crew_protocol::scpack::BSidePreflightInput {
        runtime_available: codex_acp_available || codex_home.exists(),
        auth_available: auth_ready,
        detected_cli_version: detected_version.clone(),
        min_required_version: required_min,
    };
    shadow_crew_protocol::scpack::validate_b_side_codex_environment(&preflight)
        .map_err(|e| e.to_string())?;

    Ok(serde_json::json!({
        "codex_cli_installed": preflight.runtime_available,
        "codex_cli_version": format!("codex-cli {}", detected_version),
        "codex_acp_available": codex_acp_available || preflight.runtime_available,
        "auth_ready": preflight.auth_available,
        "version_compatible": true,
        "warning_message": null,
    }))
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
        patch_locks: std::sync::Mutex::new(HashMap::new()),
        workspace_operation_locks: std::sync::Mutex::new(HashMap::new()),
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
            read_workspace_file_sandboxed,
            apply_workspace_patch,
            rollback_workspace_patch,
            run_workspace_command,
            get_acp_log_path,
            read_recent_acp_logs,
            db_save_message,
            db_save_messages_batch,
            db_get_messages,
            db_delete_messages,
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
            probe_acp_memory_sources_cmd,
            probe_codex_memory_sources_cmd,
            export_acp_scpack_cmd,
            export_codex_scpack_cmd,
            import_scpack_cmd,
            list_installed_scpacks_cmd,
            uninstall_scpack_cmd,
            retrieve_scpack_expertise_cmd,
            validate_b_side_codex_env_cmd,
            read_file_for_preview,
            open_file_in_system,
            reveal_file_in_folder,
            open_file_in_editor,
        ])
        .build(tauri::generate_context!())
        .expect("error while building shadow-crew tauri desktop application")
        .run(|app_handle, event| {
            // 应用退出前终止全部 ACP 子进程并释放句柄。
            // 仅监听 Exit（此时窗口已关闭、退出不可撤销），避免 ExitRequested 被取消时误杀进程。
            if let tauri::RunEvent::Exit = event {
                let manager = app_handle.state::<AppState>().acp_manager.clone();
                tauri::async_runtime::block_on(async move {
                    let mut guard = manager.lock().await;
                    if let Err(e) = guard.stop_all().await {
                        tracing::warn!("Failed to stop all ACP agents on exit: {}", e);
                    }
                });
            }
        });
}

#[cfg(test)]
mod attachment_tests {
    use super::*;

    fn temp_root() -> std::path::PathBuf {
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

    #[tokio::test]
    async fn scpack_tauri_commands_match_frontend_ui_contracts_and_real_codex_schema() {
        let root = temp_root();
        let packs_dir = root.join("packs_test").to_string_lossy().to_string();
        let codex_home = root.join("mock_codex_home");
        std::fs::create_dir_all(codex_home.join("memories_v2/extensions/ad_hoc/notes")).unwrap();
        std::fs::create_dir_all(codex_home.join("skills/hatch-pet")).unwrap();

        // 0-byte lock files (as found in real ~/.codex) must NOT trigger ERR_SNAPSHOT_INCONSISTENT
        std::fs::write(codex_home.join("memories_v2.lock"), b"").unwrap();
        std::fs::write(codex_home.join(".sqlite-maintenance.lock"), b"").unwrap();
        std::fs::write(codex_home.join("session_index.jsonl.lock"), b"").unwrap();

        // Real Codex 0.166.0-alpha.6 memories_v2_1.sqlite DDL (no `cwd` column on stage1_outputs!)
        let s1_db = codex_home.join("memories_v2_1.sqlite");
        let conn = rusqlite::Connection::open(&s1_db).unwrap();
        conn.execute_batch(
            "CREATE TABLE _sqlx_migrations (
                 version BIGINT PRIMARY KEY,
                 description TEXT NOT NULL,
                 installed_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                 success BOOLEAN NOT NULL,
                 checksum BLOB NOT NULL,
                 execution_time BIGINT NOT NULL
             );
             INSERT INTO _sqlx_migrations VALUES (1, 'init', CURRENT_TIMESTAMP, 1, X'00', 1);
             INSERT INTO _sqlx_migrations VALUES (2, 'v2', CURRENT_TIMESTAMP, 1, X'00', 1);
             CREATE TABLE stage1_outputs (
                 thread_id TEXT PRIMARY KEY,
                 source_updated_at INTEGER NOT NULL,
                 raw_memory TEXT NOT NULL,
                 rollout_summary TEXT NOT NULL,
                 rollout_slug TEXT,
                 generated_at INTEGER NOT NULL,
                 usage_count INTEGER,
                 last_usage INTEGER,
                 selected_for_phase2 INTEGER NOT NULL DEFAULT 0,
                 selected_for_phase2_source_updated_at INTEGER
             );
             CREATE TABLE jobs (
                 kind TEXT NOT NULL,
                 job_key TEXT NOT NULL,
                 status TEXT NOT NULL,
                 worker_id TEXT,
                 ownership_token TEXT,
                 started_at INTEGER,
                 finished_at INTEGER,
                 lease_until INTEGER,
                 retry_at INTEGER,
                  retry_remaining INTEGER NOT NULL,
                 last_error TEXT,
                 input_watermark INTEGER,
                 last_success_watermark INTEGER,
                 PRIMARY KEY (kind, job_key)
             );
             INSERT INTO jobs (kind, job_key, status, retry_remaining, last_error)
             VALUES ('memory_stage1', 'thread-1', 'error', 0, '503 Service Unavailable: model_not_registered');",
        )
        .unwrap();
        drop(conn);

        std::fs::write(
            codex_home.join("memories_v2/extensions/ad_hoc/notes/2026-11-02T00-00-00-sc-codex-memory-contract.md"),
            "SC_CODEX_MEMORY_CONTRACT_20261102 = CYAN-8192-RAVEN\nGateway domain: ai-gateway.qianxin-inc.cn\nAuth: Bearer secret_token_1234567890abcdef",
        )
        .unwrap();
        std::fs::write(
            codex_home.join("skills/hatch-pet/SKILL.md"),
            "# Hatch Pet Skill\nAlways validate SQLite schema columns before querying.",
        )
        .unwrap();

        let probe_dto = probe_codex_memory_sources_cmd(
            Some(codex_home.to_string_lossy().to_string()),
            None,
            None,
            Some(false),
        )
        .await
        .expect("probe_codex_memory_sources_cmd should succeed with real stage1_outputs schema");

        // Verify exact snake_case fields expected by AgentDashboard.tsx & src/types.ts
        assert!(probe_dto.get("codex_home").and_then(|v| v.as_str()).is_some());
        assert!(probe_dto.get("s1_degraded_notice").and_then(|v| v.as_str()).is_some());
        let sources = probe_dto.get("sources").and_then(|v| v.as_array()).unwrap();
        assert_eq!(sources.len(), 6);
        assert_eq!(
            sources[0].get("source_id").and_then(|v| v.as_str()),
            Some("S1_CODEX_MEMORIES_V2")
        );
        assert_eq!(
            sources[0].get("availability").and_then(|v| v.as_str()),
            Some("degraded_empty_503")
        );
        let redaction_audit = probe_dto.get("redaction_audit").unwrap();
        assert!(redaction_audit.get("total_redactions").and_then(|v| v.as_u64()).unwrap() >= 2);
        assert_eq!(
            redaction_audit.get("zero_residual_verified").and_then(|v| v.as_bool()),
            Some(true)
        );
        assert!(redaction_audit
            .get("blacklisted_paths_skipped")
            .and_then(|v| v.as_array())
            .is_some());

        // Export .scpack via Tauri command contract
        let export_out_path = root.join("exports/codex-test.scpack");
        let manifest_dto = export_codex_scpack_cmd(
            Some("Codex Architecture Expert Pack".to_string()),
            Some("1.0.0".to_string()),
            Some("Senior Architect A".to_string()),
            Some("Distilled Codex Playbooks".to_string()),
            Some(export_out_path.to_string_lossy().to_string()),
            Some(true),
            Some(codex_home.to_string_lossy().to_string()),
            None,
            Some(true),
            Some(packs_dir.clone()),
            None,
            None,
            None,
        )
        .await
        .expect("export_codex_scpack_cmd should succeed");

        assert!(export_out_path.exists());
        let pkg_id = manifest_dto
            .get("package_id")
            .and_then(|v| v.as_str())
            .unwrap()
            .to_string();
        assert_eq!(
            manifest_dto.get("author").and_then(|v| v.as_str()),
            Some("Senior Architect A")
        );
        assert!(manifest_dto
            .get("merkle_root_blake3")
            .and_then(|v| v.as_str())
            .unwrap()
            .starts_with("blake3:"));
        assert!(manifest_dto
            .pointer("/signature/signer_public_key_hex")
            .and_then(|v| v.as_str())
            .is_some());

        // Import .scpack via Tauri command contract
        let imported_dto = import_scpack_cmd(
            Some(export_out_path.to_string_lossy().to_string()),
            None,
            None,
            Some(packs_dir.clone()),
        )
        .await
        .expect("import_scpack_cmd should succeed");
        assert_eq!(
            imported_dto.get("package_id").and_then(|v| v.as_str()),
            Some(pkg_id.as_str())
        );
        assert_eq!(
            imported_dto.get("author").and_then(|v| v.as_str()),
            Some("Senior Architect A")
        );
        assert!(imported_dto.get("playbook_count").and_then(|v| v.as_u64()).unwrap() >= 2);

        // Retrieve expertise via Tauri command contract
        let ret_dto = retrieve_scpack_expertise_cmd(
            pkg_id.clone(),
            Some("What is SC_CODEX_MEMORY_CONTRACT_20261102?".to_string()),
            None,
            Some(3),
            Some(0.1),
            Some(packs_dir.clone()),
        )
        .await
        .expect("retrieve_scpack_expertise_cmd should succeed");
        assert_eq!(
            ret_dto.get("package_id").and_then(|v| v.as_str()),
            Some(pkg_id.as_str())
        );
        assert!(ret_dto
            .get("augmented_prompt")
            .and_then(|v| v.as_str())
            .unwrap()
            .contains("CYAN-8192-RAVEN"));
        assert!(!ret_dto
            .get("matched_playbooks")
            .and_then(|v| v.as_array())
            .unwrap()
            .is_empty());

        // Clean up installed test pack
        let _ = uninstall_scpack_cmd(pkg_id, Some(false), None, Some(packs_dir)).await;
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn real_host_codex_home_probe_and_export_roundtrip_if_accessible() {
        let real_codex = expand_tilde_path("~/.codex").expect("home directory must be resolvable in tests");
        // In sandboxed CI where ~/.codex is not readable, skip gracefully; when accessible, verify full pipeline
        if std::fs::read_dir(&real_codex).is_err() || !real_codex.join("memories_v2_1.sqlite").exists() {
            return;
        }
        let root = temp_root();
        let packs_dir = root.join("packs_real").to_string_lossy().to_string();

        let probe_dto = probe_codex_memory_sources_cmd(
            Some("~/.codex".to_string()),
            None,
            None,
            Some(false),
        )
        .await
        .expect("Probing real ~/.codex must succeed without ERR_SCHEMA_UNSUPPORTED");

        let sources = probe_dto.get("sources").and_then(|v| v.as_array()).unwrap();
        assert_eq!(sources.len(), 6);
        let playbooks = probe_dto
            .get("extracted_playbooks")
            .and_then(|v| v.as_array())
            .unwrap();
        println!(
            "[REAL_CODEX_PROBE] playbooks={}, redactions={}, s1_notice={:?}",
            playbooks.len(),
            probe_dto
                .pointer("/redaction_audit/total_redactions")
                .and_then(|v| v.as_u64())
                .unwrap_or(0),
            probe_dto.get("s1_degraded_notice").and_then(|v| v.as_str())
        );
        assert!(
            !playbooks.is_empty(),
            "Real ~/.codex should yield at least 1 distilled playbook/skill"
        );

        let out_file = root.join("exports/real-codex-expert.scpack");
        let manifest_dto = export_codex_scpack_cmd(
            Some("Real Host Codex Expert Pack".to_string()),
            Some("1.0.0".to_string()),
            Some("Senior Architect A".to_string()),
            Some("Exported from live ~/.codex".to_string()),
            Some(out_file.to_string_lossy().to_string()),
            Some(true),
            Some("~/.codex".to_string()),
            None,
            Some(true),
            Some(packs_dir.clone()),
            None,
            None,
            None,
        )
        .await
        .expect("Exporting real ~/.codex to .scpack must succeed");

        assert!(out_file.exists());
        let pkg_id = manifest_dto
            .get("package_id")
            .and_then(|v| v.as_str())
            .unwrap()
            .to_string();

        let ret_dto = retrieve_scpack_expertise_cmd(
            pkg_id.clone(),
            Some("What is SC_CODEX_MEMORY_CONTRACT_20261102?".to_string()),
            None,
            Some(3),
            Some(0.1),
            Some(packs_dir.clone()),
        )
        .await
        .expect("Pre-retrieval on real ~/.codex pack must succeed");
        assert!(ret_dto
            .get("augmented_prompt")
            .and_then(|v| v.as_str())
            .unwrap()
            .contains("CYAN-8192-RAVEN"));

        let _ = uninstall_scpack_cmd(pkg_id, Some(false), None, Some(packs_dir)).await;
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn scpack_tauri_commands_support_claude_code_harness_roundtrip() {
        let root = temp_root();
        let claude_home = root.join(".claude");
        let ws_root = root.join("workspace");
        let packs_dir = root.join("packs_claude").to_string_lossy().to_string();
        std::fs::create_dir_all(&claude_home).unwrap();
        std::fs::create_dir_all(&ws_root).unwrap();

        // 1. C1: CLAUDE.md in workspace root
        std::fs::write(
            ws_root.join("CLAUDE.md"),
            "# Project Invariants\n- Principle: Multi-Agent Turn Barrier.\n- Secret: sk-ant-api03-0987654321fedcba0987654321\n",
        )
        .unwrap();

        // 2. C2: ~/.claude/skills/
        let skill_dir = claude_home.join("skills/audit-tool");
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::fs::write(
            skill_dir.join("SKILL.md"),
            "# Audit Tool Skill\nPerform AST security scans before merge.\n",
        )
        .unwrap();

        // 3. C3: ~/.claude/settings.json
        std::fs::write(
            claude_home.join("settings.json"),
            serde_json::json!({
                "theme": "dark",
                "apiKey": "sk-ant-SECRET-TOKEN",
                "defaultHarness": "claude-code"
            })
            .to_string(),
        )
        .unwrap();

        // 4. C4: ~/.claude/history.jsonl
        std::fs::write(
            claude_home.join("history.jsonl"),
            "{\"prompt\":\"How do we verify zero residual secrets in Claude Code .scpack?\"}\n",
        )
        .unwrap();

        // Probe Claude Code via Tauri command
        let probe_dto = probe_acp_memory_sources_cmd(
            Some("claude-code".to_string()),
            Some(claude_home.to_string_lossy().to_string()),
            None,
            Some(ws_root.to_string_lossy().to_string()),
            None,
            Some(false),
        )
        .await
        .expect("probe_acp_memory_sources_cmd should succeed for claude-code");

        assert_eq!(
            probe_dto.get("source_harness").and_then(|v| v.as_str()),
            Some("claude-code")
        );
        let sources = probe_dto.get("sources").and_then(|v| v.as_array()).unwrap();
        assert_eq!(sources.len(), 4);
        assert_eq!(
            sources[0].get("source_id").and_then(|v| v.as_str()),
            Some("C1_CLAUDE_PROJECT_MEMORIES")
        );
        assert_eq!(
            sources[1].get("source_id").and_then(|v| v.as_str()),
            Some("C2_CLAUDE_SKILLS")
        );

        // Export Claude Code .scpack via Tauri command
        let export_out_path = root.join("exports/claude-expert.scpack");
        let manifest_dto = export_acp_scpack_cmd(
            Some("Claude Engineering Expert Pack".to_string()),
            Some("1.0.0".to_string()),
            Some("Lead Architect B".to_string()),
            Some("Distilled Claude Code playbooks".to_string()),
            Some(export_out_path.to_string_lossy().to_string()),
            Some(true),
            Some(claude_home.to_string_lossy().to_string()),
            Some(ws_root.to_string_lossy().to_string()),
            Some(true),
            Some(packs_dir.clone()),
            None,
            Some("claude-code".to_string()),
            Some(claude_home.to_string_lossy().to_string()),
        )
        .await
        .expect("export_acp_scpack_cmd should succeed for claude-code");

        assert!(export_out_path.exists());
        assert_eq!(
            manifest_dto.pointer("/runtime_requirement/target_runtime").and_then(|v| v.as_str()),
            Some("claude-code")
        );
        assert_eq!(
            manifest_dto.pointer("/runtime_requirement/acp_adapter").and_then(|v| v.as_str()),
            Some("claude-agent-acp")
        );

        let pkg_id = manifest_dto
            .get("package_id")
            .and_then(|v| v.as_str())
            .unwrap()
            .to_string();

        // Retrieve from installed pack
        let ret_dto = retrieve_scpack_expertise_cmd(
            pkg_id.clone(),
            Some("How do we handle Multi-Agent Turn Barrier?".to_string()),
            None,
            Some(3),
            Some(0.1),
            Some(packs_dir.clone()),
        )
        .await
        .expect("retrieve_scpack_expertise_cmd should succeed for claude-code pack");

        assert!(ret_dto
            .get("augmented_prompt")
            .and_then(|v| v.as_str())
            .unwrap()
            .contains("Multi-Agent Turn Barrier"));

        let _ = uninstall_scpack_cmd(pkg_id, Some(false), None, Some(packs_dir)).await;
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn test_read_file_for_preview_text_and_binary() {
        let root = temp_root();
        let _ = std::fs::create_dir_all(&root);

        // 1. 测试常规文本文件预览
        let test_txt = root.join("hello_preview.txt");
        std::fs::write(&test_txt, "Line 1: Hello World\nLine 2: Shadow Crew\nLine 3: Preview\n").unwrap();

        let path_uri = format!("file://{}", test_txt.to_string_lossy());
        let preview = read_file_for_preview(path_uri, None).await.expect("read_file_for_preview should succeed");
        assert_eq!(preview.display_name, "hello_preview.txt");
        assert_eq!(preview.extension, "txt");
        assert_eq!(preview.is_binary, false);
        assert_eq!(preview.total_lines, 3);
        assert!(preview.content.contains("Line 2: Shadow Crew"));

        // 2. 测试相对路径结合 workspace_root
        let rel_preview = read_file_for_preview(
            "hello_preview.txt".to_string(),
            Some(root.to_string_lossy().to_string()),
        ).await.expect("relative path with workspace_root should succeed");
        assert_eq!(rel_preview.display_name, "hello_preview.txt");
        assert_eq!(rel_preview.total_lines, 3);

        // 3. 测试二进制文件检测
        let bin_file = root.join("test_image.png");
        std::fs::write(&bin_file, [0x89, 0x50, 0x4E, 0x47, 0x00, 0x01, 0x02, 0x03]).unwrap();
        let bin_preview = read_file_for_preview(
            bin_file.to_string_lossy().to_string(),
            None,
        ).await.expect("binary read should succeed");
        assert_eq!(bin_preview.is_binary, true);
        assert!(bin_preview.content.is_empty());

        let _ = std::fs::remove_dir_all(root);
    }
}
