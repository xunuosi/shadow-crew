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
    channel_id: Option<String>,
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
        .send_session_prompt(
            &agent_id,
            &room_id,
            channel_id.as_deref(),
            &prompt,
            system_prompt.as_deref(),
        )
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

#[derive(serde::Deserialize, Debug, Clone)]
pub struct WorkspacePatchItem {
    pub filename: String,
    pub diff: String,
    pub code_content: Option<String>,
}

#[derive(serde::Serialize, Debug, Clone)]
pub struct AppliedFileStatus {
    pub filename: String,
    pub mode: String, // "git_apply" | "block_replace" | "created_file" | "artifact_saved"
    pub target_path: String,
    pub artifact_path: String,
}

#[derive(serde::Serialize, Debug, Clone)]
pub struct ApplyWorkspacePatchResult {
    pub ok: bool,
    pub artifacts_dir: String,
    pub applied_files: Vec<AppliedFileStatus>,
    pub summary: String,
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
            std::path::Component::Normal(os_str) => clean.push(os_str),
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

fn try_block_replace_on_existing_file(existing: &str, diff: &str) -> Option<String> {
    let mut removed_lines: Vec<&str> = Vec::new();
    let mut added_lines: Vec<&str> = Vec::new();
    for line in diff.lines() {
        if line.starts_with("---") || line.starts_with("+++") || line.starts_with("@@") {
            continue;
        }
        if let Some(rem) = line.strip_prefix('-') {
            removed_lines.push(rem);
        } else if let Some(add) = line.strip_prefix('+') {
            added_lines.push(add);
        }
    }
    if removed_lines.is_empty() {
        return None;
    }
    let target_block = removed_lines.join("\n");
    let replacement_block = added_lines.join("\n");
    if existing.contains(&target_block) {
        Some(existing.replacen(&target_block, &replacement_block, 1))
    } else {
        None
    }
}

/// Tauri Command: 将议题落地 Agent 生成的补丁物理应用到本地工作区与频道归档目录
#[tauri::command]
async fn apply_workspace_patch(
    workspace_root: String,
    channel_id: String,
    topic_id: String,
    patches: Vec<WorkspacePatchItem>,
) -> Result<ApplyWorkspacePatchResult, String> {
    let channel_dir = db_manager::get_channel_dir(&channel_id);
    let topic_artifacts_dir = channel_dir.join("artifacts").join(&topic_id);
    std::fs::create_dir_all(&topic_artifacts_dir)
        .map_err(|e| format!("Failed to create topic artifacts dir: {}", e))?;

    let trimmed_root = workspace_root.trim();
    let canonical_root = if trimmed_root.is_empty()
        || trimmed_root == "."
        || trimmed_root.starts_with("~/.shadow-crew")
        || trimmed_root.starts_with("~/.shinobi")
        || trimmed_root.contains("/shadow-crew")
    {
        std::fs::canonicalize(&channel_dir).ok().or(Some(channel_dir.clone()))
    } else {
        std::fs::canonicalize(trimmed_root)
            .ok()
            .or_else(|| std::fs::canonicalize(&channel_dir).ok())
            .or(Some(channel_dir.clone()))
    };
    let mut applied_files = Vec::new();

    for (idx, item) in patches.iter().enumerate() {
        let rel_path = sanitize_relative_path(&item.filename)
            .unwrap_or_else(|| std::path::PathBuf::from(format!("patch_{}.ts", idx + 1)));

        // 1. 始终写入归档目录保存物理产物快照 (.patch 与重构源码)
        let artifact_file_path = topic_artifacts_dir.join(&rel_path);
        if let Some(parent) = artifact_file_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let patch_artifact_path = topic_artifacts_dir.join(format!(
            "{}.patch",
            rel_path.to_string_lossy().replace(['/', '\\'], "_")
        ));
        let _ = std::fs::write(&patch_artifact_path, &item.diff);

        let reconstructed = reconstruct_content_from_diff(&item.diff, item.code_content.as_deref());
        let _ = std::fs::write(&artifact_file_path, &reconstructed);

        let mut mode = "artifact_saved".to_string();
        let mut final_target_path = artifact_file_path.to_string_lossy().to_string();

        // 2. 如果工作区根目录存在且路径合法，尝试物理合入工作区
        if let Some(ref root) = canonical_root {
            let candidate_target = root.join(&rel_path);
            // 确保父目录不会逃逸出 canonical_root
            if candidate_target.starts_with(root) {
                if candidate_target.exists() {
                    // 优先尝试 git apply
                    let git_apply_ok = std::process::Command::new("git")
                        .arg("apply")
                        .arg("--whitespace=nowarn")
                        .arg("--unidiff-zero")
                        .arg(&patch_artifact_path)
                        .current_dir(root)
                        .output()
                        .map(|o| o.status.success())
                        .unwrap_or(false);

                    if git_apply_ok {
                        mode = "git_apply".to_string();
                        final_target_path = candidate_target.to_string_lossy().to_string();
                    } else if let Ok(existing_content) = std::fs::read_to_string(&candidate_target) {
                        if let Some(updated_content) = try_block_replace_on_existing_file(&existing_content, &item.diff) {
                            if std::fs::write(&candidate_target, updated_content).is_ok() {
                                mode = "block_replace".to_string();
                                final_target_path = candidate_target.to_string_lossy().to_string();
                            }
                        }
                    }
                } else {
                    // 目标文件尚不存在：创建父目录并写入新文件
                    if let Some(parent) = candidate_target.parent() {
                        let _ = std::fs::create_dir_all(parent);
                    }
                    if std::fs::write(&candidate_target, &reconstructed).is_ok() {
                        mode = "created_file".to_string();
                        final_target_path = candidate_target.to_string_lossy().to_string();
                    }
                }
            }
        }

        applied_files.push(AppliedFileStatus {
            filename: rel_path.to_string_lossy().to_string(),
            mode,
            target_path: final_target_path,
            artifact_path: artifact_file_path.to_string_lossy().to_string(),
        });
    }

    let summary = format!(
        "已成功合入并归档 {} 个工程文件补丁",
        applied_files.len()
    );

    Ok(ApplyWorkspacePatchResult {
        ok: true,
        artifacts_dir: topic_artifacts_dir.to_string_lossy().to_string(),
        applied_files,
        summary,
    })
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

/// Tauri Command: 获取完整工作区聚合数据 (projects, channels, threads, agents, teams, workspaceState)
#[tauri::command]
fn db_get_full_workspace_data(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    state.db_manager.get_full_workspace_data().map_err(|e| e.to_string())
}

/// Tauri Command: 保存项目列表
#[tauri::command]
fn db_save_projects(projects: Vec<serde_json::Value>, state: State<'_, AppState>) -> Result<(), String> {
    state.db_manager.save_projects(&projects).map_err(|e| e.to_string())
}

/// Tauri Command: 保存频道列表
#[tauri::command]
fn db_save_channels(channels: Vec<serde_json::Value>, state: State<'_, AppState>) -> Result<(), String> {
    state.db_manager.save_channels(&channels).map_err(|e| e.to_string())
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
            apply_workspace_patch,
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
            db_save_projects,
            db_save_channels,
            db_save_threads,
            db_save_agents,
            db_save_teams,
            db_save_workspace_state,
            db_get_workspace_state,
            native_http_post,
            open_channel_artifacts_dir,
            get_channel_dir_info,
        ])
        .run(tauri::generate_context!())
        .expect("error while running shadow-crew tauri desktop application");
}
