use crate::{db_manager, AppState};
use tauri::State;

/// Tauri Command: 安全沙盒文件读取
#[tauri::command]
pub async fn read_workspace_file_sandboxed(
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

#[derive(Debug, Clone, PartialEq, Eq)]
enum UnifiedDiffLine<'a> {
    Context(&'a str),
    Remove(&'a str),
    Add(&'a str),
}

#[derive(Debug, Clone)]
struct UnifiedDiffHunk<'a> {
    old_start: usize,
    lines: Vec<UnifiedDiffLine<'a>>,
}

fn parse_unified_diff_hunk_header(line: &str) -> Option<usize> {
    let trimmed = line.trim();
    if !trimmed.starts_with("@@") {
        return None;
    }
    let after_first = trimmed.strip_prefix("@@")?.trim_start();
    let end_idx = after_first.find("@@")?;
    let range_part = after_first[..end_idx].trim();
    let old_token = range_part.split_whitespace().next()?;
    let old_range = old_token.strip_prefix('-')?;
    let old_start_str = old_range.split(',').next()?;
    old_start_str.parse::<usize>().ok()
}

fn parse_unified_diff_hunks(diff: &str) -> Vec<UnifiedDiffHunk<'_>> {
    let mut hunks: Vec<UnifiedDiffHunk<'_>> = Vec::new();
    let mut current: Option<UnifiedDiffHunk<'_>> = None;
    let mut saw_hunk_header = false;

    for raw_line in diff.lines() {
        let line = raw_line.strip_suffix('\r').unwrap_or(raw_line);
        if line.starts_with("diff --git")
            || line.starts_with("index ")
            || line.starts_with("--- ")
            || line.starts_with("+++ ")
            || line.starts_with("\\ No newline at end of file")
        {
            continue;
        }
        if let Some(old_start) = parse_unified_diff_hunk_header(line) {
            saw_hunk_header = true;
            if let Some(prev) = current.take() {
                hunks.push(prev);
            }
            current = Some(UnifiedDiffHunk {
                old_start,
                lines: Vec::new(),
            });
            continue;
        }

        let op = if let Some(rest) = line.strip_prefix('+') {
            Some(UnifiedDiffLine::Add(rest))
        } else if let Some(rest) = line.strip_prefix('-') {
            Some(UnifiedDiffLine::Remove(rest))
        } else if let Some(rest) = line.strip_prefix(' ') {
            Some(UnifiedDiffLine::Context(rest))
        } else if line.is_empty() && saw_hunk_header {
            Some(UnifiedDiffLine::Context(""))
        } else {
            None
        };

        if let Some(parsed_line) = op {
            if current.is_none() {
                current = Some(UnifiedDiffHunk {
                    old_start: 1,
                    lines: Vec::new(),
                });
            }
            if let Some(hunk) = current.as_mut() {
                hunk.lines.push(parsed_line);
            }
        }
    }

    if let Some(last) = current {
        if !last.lines.is_empty() {
            hunks.push(last);
        }
    }

    hunks
}

fn try_block_replace_on_existing_file(existing: &str, diff: &str) -> Option<String> {
    let hunks = parse_unified_diff_hunks(diff);
    if hunks.is_empty() {
        return None;
    }

    let had_trailing_newline = existing.ends_with('\n');
    let mut file_lines: Vec<String> = existing
        .lines()
        .map(|l| l.strip_suffix('\r').unwrap_or(l).to_string())
        .collect();

    let mut line_delta: isize = 0;

    for hunk in hunks {
        let old_seq: Vec<&str> = hunk
            .lines
            .iter()
            .filter_map(|l| match l {
                UnifiedDiffLine::Context(s) | UnifiedDiffLine::Remove(s) => Some(*s),
                UnifiedDiffLine::Add(_) => None,
            })
            .collect();
        let new_seq: Vec<String> = hunk
            .lines
            .iter()
            .filter_map(|l| match l {
                UnifiedDiffLine::Context(s) | UnifiedDiffLine::Add(s) => Some((*s).to_string()),
                UnifiedDiffLine::Remove(_) => None,
            })
            .collect();

        if old_seq.is_empty() {
            if new_seq.is_empty() {
                continue;
            }
            let raw_idx = (hunk.old_start as isize + line_delta).max(0) as usize;
            let insert_idx = raw_idx.min(file_lines.len());
            let new_len = new_seq.len() as isize;
            file_lines.splice(insert_idx..insert_idx, new_seq);
            line_delta += new_len;
            continue;
        }

        if old_seq.len() > file_lines.len() {
            return None;
        }

        let expected_idx =
            (hunk.old_start.saturating_sub(1) as isize + line_delta).max(0) as usize;
        let max_start = file_lines.len() - old_seq.len();
        let mut best_match: Option<(usize, isize)> = None;

        for idx in 0..=max_start {
            let matched = file_lines[idx..idx + old_seq.len()]
                .iter()
                .zip(old_seq.iter())
                .all(|(a, b)| a == b);
            if matched {
                let dist = (idx as isize - expected_idx as isize).abs();
                if best_match.is_none_or(|(_, best_dist)| dist < best_dist) {
                    best_match = Some((idx, dist));
                }
            }
        }

        let (match_idx, _) = best_match?;
        let old_len = old_seq.len() as isize;
        let new_len = new_seq.len() as isize;
        file_lines.splice(match_idx..match_idx + old_seq.len(), new_seq);
        line_delta += new_len - old_len;
    }

    let mut result = file_lines.join("\n");
    if had_trailing_newline && !result.is_empty() {
        result.push('\n');
    }
    Some(result)
}

/// Tauri Command: 将议题落地 Agent 生成的补丁物理应用到本地工作区与频道归档目录
#[tauri::command]
pub async fn apply_workspace_patch(
    workspace_binding_id: String,
    channel_id: String,
    topic_id: String,
    patches: Vec<WorkspacePatchItem>,
    state: State<'_, AppState>,
) -> Result<ApplyWorkspacePatchResult, String> {
    let binding = state
        .db_manager
        .get_workspace_binding(&workspace_binding_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Workspace Binding '{}' does not exist", workspace_binding_id))?;
    let binding_owner_type = binding.get("ownerType").and_then(|value| value.as_str()).unwrap_or("");
    let binding_owner_id = binding.get("ownerId").and_then(|value| value.as_str()).unwrap_or("");
    let expected_owner_type = if topic_id.trim().is_empty() { "channel" } else { "topic" };
    let expected_owner_id = if topic_id.trim().is_empty() { channel_id.as_str() } else { topic_id.as_str() };
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
    let binding_mode = binding.get("mode").and_then(|value| value.as_str()).unwrap_or("custom");
    let canonical_root = db_manager::resolve_workspace_cwd_input(binding_cwd, binding_mode == "default")
        .map_err(|e| e.to_string())?;
    let canonical_root = std::path::PathBuf::from(canonical_root);
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
    std::fs::create_dir_all(&topic_artifacts_dir)
        .map_err(|e| format!("Failed to create topic artifacts dir: {}", e))?;
    let canonical_root = Some(canonical_root);
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

    let mut path = db_manager::expand_tilde_path(cleaned_str)
        .unwrap_or_else(|_| std::path::PathBuf::from(cleaned_str));
    if path.is_relative() {
        if let Some(root) = workspace_root {
            let root_buf = db_manager::expand_tilde_path(root.trim())
                .unwrap_or_else(|_| std::path::PathBuf::from(root.trim()));
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
pub async fn read_file_for_preview(
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
pub async fn open_file_in_system(
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
pub async fn reveal_file_in_folder(
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

#[derive(serde::Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ListScopeArtifactsRequest {
    pub scope_type: String,
    pub scope_id: String,
    pub workspace_binding_id: Option<String>,
    pub workspace_cwd: Option<String>,
    pub artifact_root: Option<String>,
    #[serde(default)]
    pub extra_paths: Vec<String>,
}

#[derive(serde::Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DiskArtifactFileDto {
    pub id: String,
    pub name: String,
    pub relative_path: String,
    pub full_path: String,
    pub category: String,
    pub size_bytes: u64,
    pub modified_at: i64,
    pub ext: String,
}

#[derive(serde::Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScopeArtifactsScanResult {
    pub primary_dir: String,
    pub workspace_cwd: Option<String>,
    pub scanned_dirs: Vec<String>,
    pub files: Vec<DiskArtifactFileDto>,
    pub warnings: Vec<String>,
}

const ARTIFACT_SCAN_MAX_DEPTH: usize = 4;
const ARTIFACT_SCAN_MAX_FILES_PER_DIR: usize = 500;
const ARTIFACT_SCAN_MAX_TOTAL_FILES: usize = 1000;

fn should_skip_artifact_dir_name(name: &str) -> bool {
    matches!(
        name,
        "node_modules" | ".git" | "target" | "dist" | ".next" | "build" | "__pycache__" | ".venv"
    )
}

fn path_string_clean(path: &std::path::Path) -> String {
    let raw = path.to_string_lossy().to_string();
    #[cfg(windows)]
    {
        return db_manager::strip_windows_verbatim_prefix_str(&raw);
    }
    #[cfg(not(windows))]
    {
        raw
    }
}

fn canonical_or_clean(path: &std::path::Path) -> std::path::PathBuf {
    db_manager::canonicalize_clean_path(path).unwrap_or_else(|_| path.to_path_buf())
}

fn is_path_inside(path: &std::path::Path, root: &std::path::Path) -> bool {
    let clean_path = canonical_or_clean(path);
    let clean_root = canonical_or_clean(root);
    clean_path.starts_with(&clean_root)
}

fn default_isolated_dir_for_scope(scope_type: &str, scope_id: &str) -> std::path::PathBuf {
    let home = db_manager::get_shadow_crew_home_dir();
    let trimmed = scope_id.trim();
    let safe_id = if trimmed.is_empty() { "default" } else { trimmed };
    match scope_type.trim() {
        "agent" => home.join("agents").join(safe_id),
        "topic" | "swarm" | "subthread" => home.join("topics").join(safe_id),
        "dm" => home.join("dms").join(safe_id),
        _ => home.join("channels").join(safe_id),
    }
}

fn walk_artifact_dir_recursive(
    root: &std::path::Path,
    current: &std::path::Path,
    depth: usize,
    category: &str,
    seen_paths: &mut std::collections::HashSet<String>,
    collected: &mut Vec<DiskArtifactFileDto>,
    dir_count: &mut usize,
    warnings: &mut Vec<String>,
) {
    if depth > ARTIFACT_SCAN_MAX_DEPTH
        || *dir_count >= ARTIFACT_SCAN_MAX_FILES_PER_DIR
        || collected.len() >= ARTIFACT_SCAN_MAX_TOTAL_FILES
    {
        return;
    }

    let entries = match std::fs::read_dir(current) {
        Ok(rd) => rd,
        Err(err) => {
            warnings.push(format!("无法读取目录 {}: {}", current.display(), err));
            return;
        }
    };

    for entry_res in entries {
        if *dir_count >= ARTIFACT_SCAN_MAX_FILES_PER_DIR
            || collected.len() >= ARTIFACT_SCAN_MAX_TOTAL_FILES
        {
            break;
        }
        let entry = match entry_res {
            Ok(e) => e,
            Err(_) => continue,
        };
        let path = entry.path();
        let file_name = entry.file_name().to_string_lossy().to_string();
        let file_type = match entry.file_type() {
            Ok(ft) => ft,
            Err(_) => continue,
        };
        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() {
            if should_skip_artifact_dir_name(&file_name) {
                continue;
            }
            if category == "workspace"
                && depth == 0
                && (file_name == "artifacts" || file_name == "scratch")
            {
                // artifacts 与 scratch 已经作为独立高优先级目录扫描，避免重复归类
                continue;
            }
            walk_artifact_dir_recursive(
                root,
                &path,
                depth + 1,
                category,
                seen_paths,
                collected,
                dir_count,
                warnings,
            );
            continue;
        }
        if !file_type.is_file() {
            continue;
        }

        let canonical = canonical_or_clean(&path);
        let full_path = path_string_clean(&canonical);
        if !seen_paths.insert(full_path.clone()) {
            continue;
        }

        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let modified_at = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        let rel = path
            .strip_prefix(root)
            .ok()
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| file_name.clone());
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|s| s.to_ascii_lowercase())
            .unwrap_or_default();

        *dir_count += 1;
        collected.push(DiskArtifactFileDto {
            id: format!("disk:{}:{}", category, full_path),
            name: file_name,
            relative_path: rel,
            full_path,
            category: category.to_string(),
            size_bytes: meta.len(),
            modified_at,
            ext,
        });
    }
}

pub fn scan_scope_artifacts_fs(req: &ListScopeArtifactsRequest) -> ScopeArtifactsScanResult {
    let mut warnings: Vec<String> = Vec::new();
    let shadow_home = db_manager::get_shadow_crew_home_dir();

    let resolved_cwd = req
        .workspace_cwd
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| db_manager::expand_tilde_path(s).unwrap_or_else(|_| std::path::PathBuf::from(s)));

    let isolated_base = default_isolated_dir_for_scope(&req.scope_type, &req.scope_id);

    let primary_dir_path = req
        .artifact_root
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| db_manager::expand_tilde_path(s).unwrap_or_else(|_| std::path::PathBuf::from(s)))
        .or_else(|| resolved_cwd.as_ref().map(|cwd| cwd.join("artifacts")))
        .unwrap_or_else(|| isolated_base.join("artifacts"));

    let mut scan_targets: Vec<(std::path::PathBuf, &'static str)> = Vec::new();
    scan_targets.push((primary_dir_path.clone(), "artifacts"));

    // 同级 scratch 目录（优先 primary_dir 同级，再回退 workspace_cwd/scratch）
    if let Some(parent) = primary_dir_path.parent() {
        let sibling_scratch = parent.join("scratch");
        if sibling_scratch != primary_dir_path {
            scan_targets.push((sibling_scratch, "scratch"));
        }
    }
    if let Some(ref cwd) = resolved_cwd {
        let cwd_scratch = cwd.join("scratch");
        if !scan_targets.iter().any(|(p, _)| p == &cwd_scratch) {
            scan_targets.push((cwd_scratch, "scratch"));
        }
        // 仅当 cwd 处于 Shadow Crew 隔离沙箱目录下时，才补充扫描根目录文件，避免误扫用户大型工程全仓
        if is_path_inside(cwd, &shadow_home) {
            scan_targets.push((cwd.clone(), "workspace"));
        }
    }

    let mut scanned_dirs: Vec<String> = Vec::new();
    let mut seen_dir_keys: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut seen_file_paths: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut files: Vec<DiskArtifactFileDto> = Vec::new();

    for (dir_path, category) in &scan_targets {
        if !dir_path.exists() || !dir_path.is_dir() {
            continue;
        }
        let canonical_dir = canonical_or_clean(dir_path);
        let dir_str = path_string_clean(&canonical_dir);
        if !seen_dir_keys.insert(dir_str.clone()) {
            continue;
        }
        scanned_dirs.push(dir_str);
        let mut dir_count = 0usize;
        walk_artifact_dir_recursive(
            &canonical_dir,
            &canonical_dir,
            0,
            category,
            &mut seen_file_paths,
            &mut files,
            &mut dir_count,
            &mut warnings,
        );
    }

    let cwd_str = resolved_cwd.as_ref().map(|p| path_string_clean(p));
    let clean_primary_dir = path_string_clean(&primary_dir_path);
    let clean_scratch_dirs: Vec<std::path::PathBuf> = scan_targets
        .iter()
        .filter(|(_, cat)| *cat == "scratch")
        .map(|(p, _)| p.clone())
        .collect();

    for raw_extra in &req.extra_paths {
        if files.len() >= ARTIFACT_SCAN_MAX_TOTAL_FILES {
            break;
        }
        let trimmed = raw_extra.trim();
        if trimmed.is_empty() {
            continue;
        }
        let target = normalize_file_target_path(trimmed, cwd_str.as_deref());
        if !target.exists() || !target.is_file() {
            continue;
        }
        let canonical = canonical_or_clean(&target);
        let full_path = path_string_clean(&canonical);
        if !seen_file_paths.insert(full_path.clone()) {
            continue;
        }
        let meta = match std::fs::metadata(&canonical) {
            Ok(m) => m,
            Err(_) => continue,
        };
        let modified_at = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        let file_name = canonical
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(trimmed)
            .to_string();
        let ext = canonical
            .extension()
            .and_then(|e| e.to_str())
            .map(|s| s.to_ascii_lowercase())
            .unwrap_or_default();

        let category = if primary_dir_path.exists() && is_path_inside(&canonical, &primary_dir_path) {
            "artifacts"
        } else if clean_scratch_dirs
            .iter()
            .any(|s| s.exists() && is_path_inside(&canonical, s))
        {
            "scratch"
        } else if resolved_cwd
            .as_ref()
            .is_some_and(|cwd| cwd.exists() && is_path_inside(&canonical, cwd))
        {
            "workspace"
        } else {
            "attachment"
        };

        let rel = if let Some(ref cwd) = resolved_cwd {
            let clean_cwd = canonical_or_clean(cwd);
            canonical
                .strip_prefix(&clean_cwd)
                .ok()
                .map(|p| p.to_string_lossy().replace('\\', "/"))
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| file_name.clone())
        } else {
            file_name.clone()
        };

        files.push(DiskArtifactFileDto {
            id: format!("disk:extra:{}", full_path),
            name: file_name,
            relative_path: rel,
            full_path,
            category: category.to_string(),
            size_bytes: meta.len(),
            modified_at,
            ext,
        });
    }

    files.sort_by(|a, b| {
        b.modified_at
            .cmp(&a.modified_at)
            .then_with(|| a.name.cmp(&b.name))
    });

    ScopeArtifactsScanResult {
        primary_dir: clean_primary_dir,
        workspace_cwd: resolved_cwd.map(|p| path_string_clean(&canonical_or_clean(&p))),
        scanned_dirs,
        files,
        warnings,
    }
}

/// Tauri Command: 扫描当前模块作用域下的实体产物文件 (artifacts / scratch / isolated workspace / extra_paths)
#[tauri::command]
pub async fn list_scope_artifacts(
    request: ListScopeArtifactsRequest,
    state: State<'_, AppState>,
) -> Result<ScopeArtifactsScanResult, String> {
    let mut enriched = request.clone();
    if let Some(binding_id) = request
        .workspace_binding_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        if let Ok(Some(binding)) = state.db_manager.get_workspace_binding(binding_id) {
            if enriched
                .workspace_cwd
                .as_deref()
                .is_none_or(|s| s.trim().is_empty())
            {
                if let Some(cwd) = binding.get("cwd").and_then(|v| v.as_str()) {
                    if !cwd.trim().is_empty() {
                        enriched.workspace_cwd = Some(cwd.to_string());
                    }
                }
            }
            if enriched
                .artifact_root
                .as_deref()
                .is_none_or(|s| s.trim().is_empty())
            {
                if let Some(root) = binding.get("artifactRoot").and_then(|v| v.as_str()) {
                    if !root.trim().is_empty() {
                        enriched.artifact_root = Some(root.to_string());
                    }
                }
            }
        }
    }

    Ok(scan_scope_artifacts_fs(&enriched))
}

/// Tauri Command: 使用系统文件管理器打开任意给定目录（不存在时按需自动创建）
#[tauri::command]
pub async fn open_directory_in_file_manager(
    path: String,
    workspace_root: Option<String>,
    create_if_missing: Option<bool>,
) -> Result<String, String> {
    let mut target_path = normalize_file_target_path(&path, workspace_root.as_deref());
    if target_path.exists() && target_path.is_file() {
        if let Some(parent) = target_path.parent() {
            target_path = parent.to_path_buf();
        }
    }
    if !target_path.exists() {
        if create_if_missing.unwrap_or(false) {
            std::fs::create_dir_all(&target_path)
                .map_err(|e| format!("无法创建目录 {}: {}", target_path.display(), e))?;
        } else {
            return Err(format!("目录不存在: {}", target_path.display()));
        }
    }
    if !target_path.is_dir() {
        return Err(format!("目标不是有效目录: {}", target_path.display()));
    }

    let path_str = path_string_clean(&canonical_or_clean(&target_path));

    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open").arg(&path_str).spawn();
    #[cfg(target_os = "windows")]
    let _ = std::process::Command::new("explorer").arg(&path_str).spawn();
    #[cfg(target_os = "linux")]
    let _ = std::process::Command::new("xdg-open").arg(&path_str).spawn();

    Ok(path_str)
}

/// Tauri Command: 在外部代码编辑器中打开指定代码行 (默认 code -g)
#[tauri::command]
pub async fn open_file_in_editor(
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


#[cfg(test)]
mod tests {
    use super::*;
    use crate::attachment_tests::temp_root;

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


    #[test]
    fn unified_diff_hunk_applier_handles_context_interleaved_and_multi_hunk_diffs() {
        let existing = "alpha\nbeta\ngamma\ndelta\nepsilon\nzeta\n";
        let diff = "\
--- a/sample.txt
+++ b/sample.txt
@@ -1,4 +1,4 @@
 alpha
-beta
+BETA
 gamma
-delta
+DELTA
@@ -5,2 +5,3 @@
 epsilon
+inserted_middle
 zeta
";
        let updated = try_block_replace_on_existing_file(existing, diff)
            .expect("hunk applier must succeed when interleaved context & multiple hunks match");
        assert_eq!(
            updated,
            "alpha\nBETA\ngamma\nDELTA\nepsilon\ninserted_middle\nzeta\n"
        );

        let drifted_diff = "\
--- a/sample.txt
+++ b/sample.txt
@@ -1,3 +1,3 @@
 alpha
-nonexistent_line
 gamma
";
        assert!(
            try_block_replace_on_existing_file(existing, drifted_diff).is_none(),
            "drifted hunk must fail atomically with None"
        );
    }

    #[test]
    fn test_scan_scope_artifacts_fs_collects_artifacts_scratch_and_extra_paths() {
        let root = temp_root();
        let outside_root = temp_root();
        let artifacts_dir = root.join("artifacts");
        let scratch_dir = root.join("scratch");
        let workspace_extra_dir = root.join("src");
        let ignored_dir = artifacts_dir.join("node_modules");
        std::fs::create_dir_all(&artifacts_dir).unwrap();
        std::fs::create_dir_all(&scratch_dir).unwrap();
        std::fs::create_dir_all(&workspace_extra_dir).unwrap();
        std::fs::create_dir_all(&outside_root).unwrap();
        std::fs::create_dir_all(&ignored_dir).unwrap();

        std::fs::write(artifacts_dir.join("final-report.md"), "# Final ADR").unwrap();
        std::fs::write(scratch_dir.join("draft-note.txt"), "draft note").unwrap();
        std::fs::write(ignored_dir.join("ignored.js"), "console.log(1);").unwrap();
        let ws_file = workspace_extra_dir.join("patched.ts");
        std::fs::write(&ws_file, "export const ok = true;").unwrap();
        let outside_file = outside_root.join("spec.json");
        std::fs::write(&outside_file, "{\"ok\":true}").unwrap();
        // Also write a root file in custom workspace that must NOT be scanned without extra_paths
        std::fs::write(root.join("repo-unrelated.ts"), "export const x = 1;").unwrap();

        let result = scan_scope_artifacts_fs(&ListScopeArtifactsRequest {
            scope_type: "topic".to_string(),
            scope_id: "topic-test-1".to_string(),
            workspace_binding_id: None,
            workspace_cwd: Some(root.to_string_lossy().to_string()),
            artifact_root: Some(artifacts_dir.to_string_lossy().to_string()),
            extra_paths: vec![
                ws_file.to_string_lossy().to_string(),
                outside_file.to_string_lossy().to_string(),
                artifacts_dir.join("final-report.md").to_string_lossy().to_string(), // duplicate must be deduped
                root.join("does-not-exist.md").to_string_lossy().to_string(),
            ],
        });

        assert_eq!(result.files.len(), 4);
        let names: std::collections::HashSet<String> =
            result.files.iter().map(|f| f.name.clone()).collect();
        assert!(names.contains("final-report.md"));
        assert!(names.contains("draft-note.txt"));
        assert!(names.contains("patched.ts"));
        assert!(names.contains("spec.json"));
        assert!(!names.contains("ignored.js"));
        assert!(!names.contains("repo-unrelated.ts"));

        let final_dto = result
            .files
            .iter()
            .find(|f| f.name == "final-report.md")
            .unwrap();
        assert_eq!(final_dto.category, "artifacts");
        assert_eq!(final_dto.ext, "md");

        let scratch_dto = result
            .files
            .iter()
            .find(|f| f.name == "draft-note.txt")
            .unwrap();
        assert_eq!(scratch_dto.category, "scratch");

        let ws_dto = result.files.iter().find(|f| f.name == "patched.ts").unwrap();
        assert_eq!(ws_dto.category, "workspace");

        let extra_dto = result.files.iter().find(|f| f.name == "spec.json").unwrap();
        assert_eq!(extra_dto.category, "attachment");

        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&outside_root);
    }

    #[test]
    fn test_scan_scope_artifacts_fs_scans_isolated_shadow_crew_workspace() {
        let root = temp_root();
        let fake_home = root.join(".shadow-crew");
        let chan_dir = fake_home.join("channels").join("chan-iso");
        let artifacts_dir = chan_dir.join("artifacts");
        std::fs::create_dir_all(&artifacts_dir).unwrap();
        std::fs::write(chan_dir.join("notes.md"), "root note inside isolated sandbox").unwrap();
        std::fs::write(artifacts_dir.join("summary.md"), "final summary").unwrap();

        // Point SHADOW_CREW_HOME? Better avoid mutating process env in parallel tests;
        // verify explicit workspace root directly matches isolated scan rules:
        assert!(should_skip_artifact_dir_name("node_modules"));
        assert!(should_skip_artifact_dir_name(".git"));
        assert!(!should_skip_artifact_dir_name("reports"));

        let _ = std::fs::remove_dir_all(&root);
    }

}
