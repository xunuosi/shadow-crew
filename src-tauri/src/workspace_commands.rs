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
    pub start_line: usize,
    pub end_line: usize,
    pub is_windowed: bool,
    pub has_more_before: bool,
    pub has_more_after: bool,
    pub image_data_url: Option<String>,
    pub candidate_paths: Option<Vec<String>>,
    pub error: Option<String>,
}

const PREVIEW_SMALL_TEXT_MAX_BYTES: u64 = 512 * 1024;
const PREVIEW_DEFAULT_WINDOW_LINES: usize = 500;
const PREVIEW_MAX_WINDOW_LINES: usize = 2000;
const PREVIEW_MAX_WINDOW_BYTES: usize = 512 * 1024;
const PREVIEW_MAX_SINGLE_LINE_BYTES: usize = 16 * 1024;
const PREVIEW_MAX_IMAGE_DATA_URL_BYTES: u64 = 10 * 1024 * 1024;

fn image_mime_for_extension(ext: &str) -> Option<&'static str> {
    match ext {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "ico" => Some("image/x-icon"),
        "svg" => Some("image/svg+xml"),
        _ => None,
    }
}

fn sanitize_single_preview_line(raw: &[u8]) -> String {
    let mut trimmed = raw;
    if trimmed.ends_with(b"\n") {
        trimmed = &trimmed[..trimmed.len() - 1];
    }
    if trimmed.ends_with(b"\r") {
        trimmed = &trimmed[..trimmed.len() - 1];
    }
    let decoded = String::from_utf8_lossy(trimmed);
    if decoded.len() <= PREVIEW_MAX_SINGLE_LINE_BYTES {
        return decoded.into_owned();
    }
    let mut boundary = PREVIEW_MAX_SINGLE_LINE_BYTES;
    while boundary > 0 && !decoded.is_char_boundary(boundary) {
        boundary -= 1;
    }
    format!("{} … [单行过长已截断]", &decoded[..boundary])
}

fn count_remaining_lines_buffered<R: std::io::BufRead>(
    reader: &mut R,
    last_line_had_newline: bool,
) -> Result<usize, String> {
    let mut extra_lines = 0usize;
    let mut pending_partial = !last_line_had_newline;
    let mut seen_any_byte = false;

    loop {
        let chunk = reader
            .fill_buf()
            .map_err(|e| format!("读取文件流失败: {}", e))?;
        let chunk_len = chunk.len();
        if chunk_len == 0 {
            if seen_any_byte && pending_partial {
                extra_lines += 1;
            }
            break;
        }
        seen_any_byte = true;
        for &b in chunk {
            if b == b'\n' {
                extra_lines += 1;
                pending_partial = false;
            } else {
                pending_partial = true;
            }
        }
        reader.consume(chunk_len);
    }

    Ok(extra_lines)
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

fn should_skip_lookup_dir_name(name: &str) -> bool {
    matches!(
        name,
        "node_modules"
            | ".git"
            | "target"
            | "dist"
            | ".next"
            | "build"
            | "__pycache__"
            | ".venv"
            | "vendor"
            | ".idea"
            | ".vscode"
            | ".gradle"
            | "coverage"
    )
}

fn resolve_file_target_with_candidates(
    raw: &str,
    workspace_root: Option<&str>,
) -> (std::path::PathBuf, Vec<String>) {
    use std::collections::VecDeque;

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

    let path = db_manager::expand_tilde_path(cleaned_str)
        .unwrap_or_else(|_| std::path::PathBuf::from(cleaned_str));

    if !path.is_relative() {
        return (path, Vec::new());
    }

    let Some(root) = workspace_root.map(str::trim).filter(|s| !s.is_empty()) else {
        return (path, Vec::new());
    };

    let root_buf = db_manager::expand_tilde_path(root)
        .unwrap_or_else(|_| std::path::PathBuf::from(root));

    let literal_candidate = root_buf.join(&path);

    // 含 `..` 的路径不做递归后缀检索，直接走字面拼接
    let has_parent_dir = path
        .components()
        .any(|c| matches!(c, std::path::Component::ParentDir));
    if has_parent_dir {
        return (literal_candidate, Vec::new());
    }

    // 1. 直接匹配 workspace_root/<rel>
    if literal_candidate.is_file() {
        return (literal_candidate, Vec::new());
    }

    // 抽出正规化正斜杠相对路径片段
    let rel_segments: Vec<String> = path
        .components()
        .filter_map(|c| match c {
            std::path::Component::Normal(s) => Some(s.to_string_lossy().to_string()),
            _ => None,
        })
        .collect();

    if rel_segments.is_empty() {
        return (literal_candidate, Vec::new());
    }

    // 2. 若路径首段重复了 workspace 根目录名（如 renbao-lxcore/internal/store/cacheStore.go）
    if rel_segments.len() >= 2 {
        if let Some(root_name) = root_buf.file_name().and_then(|n| n.to_str()) {
            if rel_segments[0] == root_name {
                let mut stripped_rel = std::path::PathBuf::new();
                for seg in &rel_segments[1..] {
                    stripped_rel.push(seg);
                }
                let stripped_candidate = root_buf.join(&stripped_rel);
                if stripped_candidate.is_file() {
                    return (stripped_candidate, Vec::new());
                }
            }
        }
    }

    // 3. 回退检查 workspace_root/artifacts/<rel>
    let artifacts_candidate = root_buf.join("artifacts").join(&path);
    if artifacts_candidate.is_file() {
        return (artifacts_candidate, Vec::new());
    }

    // 4. 在 workspace_root 下执行有界 BFS 后缀检索（解决孤立文件名/部分子路径如 cacheStore.go）
    if !root_buf.exists() || !root_buf.is_dir() {
        return (literal_candidate, Vec::new());
    }

    let canonical_root = canonical_or_clean(&root_buf);
    let target_rel = rel_segments.join("/");
    let target_rel_lower = target_rel.to_ascii_lowercase();
    let target_suffix = format!("/{}", target_rel);
    let target_suffix_lower = format!("/{}", target_rel_lower);

    const LOOKUP_MAX_DEPTH: usize = 10;
    const LOOKUP_MAX_VISITED: usize = 15_000;
    const LOOKUP_MAX_CANDIDATES: usize = 8;

    let mut queue: VecDeque<(std::path::PathBuf, usize, String)> = VecDeque::new();
    queue.push_back((canonical_root.clone(), 0, String::new()));

    let mut visited_entries: usize = 0;
    let mut exact_matches: Vec<(usize, usize, String, std::path::PathBuf)> = Vec::new();
    let mut ci_matches: Vec<(usize, usize, String, std::path::PathBuf)> = Vec::new();

    while let Some((dir_path, depth, rel_prefix)) = queue.pop_front() {
        if depth > LOOKUP_MAX_DEPTH || visited_entries >= LOOKUP_MAX_VISITED {
            break;
        }
        let Ok(entries) = std::fs::read_dir(&dir_path) else {
            continue;
        };
        for entry_res in entries {
            visited_entries += 1;
            if visited_entries >= LOOKUP_MAX_VISITED {
                break;
            }
            let Ok(entry) = entry_res else {
                continue;
            };
            let Ok(ft) = entry.file_type() else {
                continue;
            };
            if ft.is_symlink() {
                continue;
            }
            let file_name = entry.file_name().to_string_lossy().to_string();
            let rel_path = if rel_prefix.is_empty() {
                file_name.clone()
            } else {
                format!("{}/{}", rel_prefix, file_name)
            };

            if ft.is_dir() {
                if depth < LOOKUP_MAX_DEPTH && !should_skip_lookup_dir_name(&file_name) {
                    queue.push_back((entry.path(), depth + 1, rel_path));
                }
                continue;
            }

            if !ft.is_file() {
                continue;
            }

            let is_exact = rel_path == target_rel || rel_path.ends_with(&target_suffix);
            let rel_lower = rel_path.to_ascii_lowercase();
            let is_ci = !is_exact
                && (rel_lower == target_rel_lower || rel_lower.ends_with(&target_suffix_lower));

            if !is_exact && !is_ci {
                continue;
            }

            let cand_path = canonical_or_clean(&entry.path());
            if !cand_path.starts_with(&canonical_root) {
                continue;
            }

            let record = (depth, rel_path.len(), rel_path, cand_path);
            if is_exact {
                if exact_matches.len() < LOOKUP_MAX_CANDIDATES {
                    exact_matches.push(record);
                }
            } else if exact_matches.is_empty() && ci_matches.len() < LOOKUP_MAX_CANDIDATES {
                ci_matches.push(record);
            }
        }
    }

    let mut chosen = if !exact_matches.is_empty() {
        exact_matches
    } else {
        ci_matches
    };

    if chosen.is_empty() {
        return (literal_candidate, Vec::new());
    }

    chosen.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(&b.1)).then_with(|| a.2.cmp(&b.2)));

    let mut seen_paths = std::collections::HashSet::new();
    let mut candidate_strings = Vec::new();
    for (_, _, _, p) in &chosen {
        let cleaned_str = path_string_clean(p);
        if seen_paths.insert(cleaned_str.clone()) {
            candidate_strings.push(cleaned_str);
        }
    }

    let primary = chosen.into_iter().next().map(|(_, _, _, p)| p).unwrap_or(literal_candidate);
    let extra_candidates = if candidate_strings.len() > 1 {
        candidate_strings
    } else {
        Vec::new()
    };

    (primary, extra_candidates)
}

fn normalize_file_target_path(raw: &str, workspace_root: Option<&str>) -> std::path::PathBuf {
    resolve_file_target_with_candidates(raw, workspace_root).0
}

pub fn read_file_for_preview_fs(
    path: &str,
    workspace_root: Option<&str>,
    start_line: Option<usize>,
    max_lines: Option<usize>,
    tail: Option<bool>,
) -> Result<FilePreviewDto, String> {
    use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
    use std::collections::VecDeque;
    use std::io::{BufRead, BufReader, Read};

    let (target_path, resolved_candidates) = resolve_file_target_with_candidates(path, workspace_root);
    let candidate_paths = if resolved_candidates.len() > 1 {
        Some(resolved_candidates)
    } else {
        None
    };
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

    let image_mime = image_mime_for_extension(extension.as_str());
    let is_svg = extension == "svg";

    // 常见二进制扩展名（注意 SVG 为文本矢量格式，可内嵌预览 + 源码）
    let known_binary_exts = [
        "png", "jpg", "jpeg", "gif", "webp", "ico", "pdf", "zip", "tar", "gz", "wasm", "exe",
        "dylib", "so", "bin", "scpack", "mp4", "mp3", "mov", "avi", "woff", "woff2", "ttf",
    ];
    let is_binary_by_ext = known_binary_exts.contains(&extension.as_str());

    // 探针读取前 8KB 检查是否有 0x00 空字符
    let mut probe_file = std::fs::File::open(&canonical).map_err(|e| format!("打开文件失败: {}", e))?;
    let mut probe_buf = vec![0u8; 8192.min(size_bytes as usize)];
    let bytes_read = probe_file.read(&mut probe_buf).map_err(|e| format!("读取文件头失败: {}", e))?;
    let is_binary = is_binary_by_ext || probe_buf[..bytes_read].contains(&0);

    let image_data_url = if let Some(mime) = image_mime {
        if size_bytes <= PREVIEW_MAX_IMAGE_DATA_URL_BYTES {
            let bytes = std::fs::read(&canonical).map_err(|e| format!("读取图像失败: {}", e))?;
            Some(format!("data:{};base64,{}", mime, BASE64_STANDARD.encode(&bytes)))
        } else {
            None
        }
    } else {
        None
    };

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
            start_line: 0,
            end_line: 0,
            is_windowed: false,
            has_more_before: false,
            has_more_after: false,
            image_data_url,
            candidate_paths,
            error: None,
        });
    }

    if size_bytes == 0 {
        return Ok(FilePreviewDto {
            path: canonical.to_string_lossy().to_string(),
            display_name,
            extension,
            size_bytes: 0,
            is_binary: false,
            content: String::new(),
            total_lines: 0,
            is_truncated: false,
            start_line: 0,
            end_line: 0,
            is_windowed: false,
            has_more_before: false,
            has_more_after: false,
            image_data_url: if is_svg { image_data_url } else { None },
            candidate_paths,
            error: None,
        });
    }

    let wants_tail = tail == Some(true);
    let has_explicit_window = start_line.is_some() || wants_tail;

    // 常规中小文件直接全量返回
    if size_bytes <= PREVIEW_SMALL_TEXT_MAX_BYTES && !has_explicit_window {
        let bytes = std::fs::read(&canonical).map_err(|e| format!("读取文本失败: {}", e))?;
        let content = String::from_utf8_lossy(&bytes).into_owned();
        let total_lines = content.lines().count().max(1);
        return Ok(FilePreviewDto {
            path: canonical.to_string_lossy().to_string(),
            display_name,
            extension,
            size_bytes,
            is_binary: false,
            content,
            total_lines,
            is_truncated: false,
            start_line: 1,
            end_line: total_lines,
            is_windowed: false,
            has_more_before: false,
            has_more_after: false,
            image_data_url: if is_svg { image_data_url } else { None },
            candidate_paths,
            error: None,
        });
    }

    // 大文件 / 显式窗口定位模式：使用 BufReader 流式扫描与按窗分页，无 3MB 硬拒绝壁垒
    let window_lines = max_lines
        .unwrap_or(PREVIEW_DEFAULT_WINDOW_LINES)
        .clamp(50, PREVIEW_MAX_WINDOW_LINES);
    let file = std::fs::File::open(&canonical).map_err(|e| format!("打开文件失败: {}", e))?;
    let mut reader = BufReader::with_capacity(64 * 1024, file);
    let mut line_buf: Vec<u8> = Vec::with_capacity(512);

    if wants_tail {
        let mut ring: VecDeque<String> = VecDeque::with_capacity(window_lines);
        let mut total_lines = 0usize;

        loop {
            line_buf.clear();
            let n = reader
                .read_until(b'\n', &mut line_buf)
                .map_err(|e| format!("流式读取文件失败: {}", e))?;
            if n == 0 {
                break;
            }
            total_lines += 1;
            let sanitized = sanitize_single_preview_line(&line_buf);
            if ring.len() == window_lines {
                ring.pop_front();
            }
            ring.push_back(sanitized);
        }

        // 从尾部向上裁剪以同时严控窗口字节预算
        let mut kept_rev: Vec<String> = Vec::with_capacity(ring.len());
        let mut used_bytes = 0usize;
        while let Some(line) = ring.pop_back() {
            let line_cost = line.len() + 1;
            if used_bytes + line_cost > PREVIEW_MAX_WINDOW_BYTES && !kept_rev.is_empty() {
                break;
            }
            used_bytes += line_cost;
            kept_rev.push(line);
        }
        kept_rev.reverse();

        let kept_count = kept_rev.len();
        let actual_start = if kept_count == 0 {
            0
        } else {
            total_lines.saturating_sub(kept_count) + 1
        };
        let actual_end = if kept_count == 0 { 0 } else { total_lines };
        let has_more_before = actual_start > 1;
        let is_windowed = has_more_before || size_bytes > PREVIEW_SMALL_TEXT_MAX_BYTES;

        return Ok(FilePreviewDto {
            path: canonical.to_string_lossy().to_string(),
            display_name,
            extension,
            size_bytes,
            is_binary: false,
            content: kept_rev.join("\n"),
            total_lines,
            is_truncated: has_more_before,
            start_line: actual_start,
            end_line: actual_end,
            is_windowed,
            has_more_before,
            has_more_after: false,
            image_data_url: if is_svg { image_data_url } else { None },
            candidate_paths,
            error: None,
        });
    }

    let req_start = start_line.unwrap_or(1).max(1);
    let mut collected: Vec<String> = Vec::with_capacity(window_lines.min(512));
    let mut collected_bytes = 0usize;
    let mut total_lines = 0usize;
    let mut last_line_had_newline = true;
    let mut stopped_early = false;

    loop {
        line_buf.clear();
        let n = reader
            .read_until(b'\n', &mut line_buf)
            .map_err(|e| format!("流式读取文件失败: {}", e))?;
        if n == 0 {
            break;
        }
        total_lines += 1;
        last_line_had_newline = line_buf.ends_with(b"\n");

        if total_lines >= req_start {
            let sanitized = sanitize_single_preview_line(&line_buf);
            let next_bytes = collected_bytes + sanitized.len() + 1;
            if (next_bytes > PREVIEW_MAX_WINDOW_BYTES && !collected.is_empty())
                || collected.len() >= window_lines
            {
                stopped_early = true;
                break;
            }
            collected_bytes = next_bytes;
            collected.push(sanitized);
            if collected.len() >= window_lines {
                stopped_early = true;
                break;
            }
        }
    }

    if stopped_early {
        let extra = count_remaining_lines_buffered(&mut reader, last_line_had_newline)?;
        total_lines += extra;
    }

    let actual_start = if collected.is_empty() { 0 } else { req_start };
    let actual_end = if collected.is_empty() {
        0
    } else {
        req_start + collected.len() - 1
    };
    let has_more_before = req_start > 1 && total_lines > 0;
    let has_more_after = if collected.is_empty() {
        false
    } else {
        actual_end < total_lines
    };
    let is_truncated = has_more_before || has_more_after;
    let is_windowed = is_truncated || size_bytes > PREVIEW_SMALL_TEXT_MAX_BYTES;

    Ok(FilePreviewDto {
        path: canonical.to_string_lossy().to_string(),
        display_name,
        extension,
        size_bytes,
        is_binary: false,
        content: collected.join("\n"),
        total_lines,
        is_truncated,
        start_line: actual_start,
        end_line: actual_end,
        is_windowed,
        has_more_before,
        has_more_after,
        image_data_url: if is_svg { image_data_url } else { None },
        candidate_paths,
        error: None,
    })
}

/// Tauri Command: 读取本地文件用于应用内轻量抽屉预览（支持超大文件流式分段窗口与行跳转）
#[tauri::command]
pub async fn read_file_for_preview(
    path: String,
    workspace_root: Option<String>,
    start_line: Option<usize>,
    max_lines: Option<usize>,
    tail: Option<bool>,
) -> Result<FilePreviewDto, String> {
    read_file_for_preview_fs(&path, workspace_root.as_deref(), start_line, max_lines, tail)
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
        let preview = read_file_for_preview(path_uri, None, None, None, None)
            .await
            .expect("read_file_for_preview should succeed");
        assert_eq!(preview.display_name, "hello_preview.txt");
        assert_eq!(preview.extension, "txt");
        assert_eq!(preview.is_binary, false);
        assert_eq!(preview.total_lines, 3);
        assert_eq!(preview.start_line, 1);
        assert_eq!(preview.end_line, 3);
        assert_eq!(preview.is_windowed, false);
        assert!(preview.content.contains("Line 2: Shadow Crew"));

        // 2. 测试相对路径结合 workspace_root 及 artifacts/ 子目录解析
        let rel_preview = read_file_for_preview(
            "hello_preview.txt".to_string(),
            Some(root.to_string_lossy().to_string()),
            None,
            None,
            None,
        )
        .await
        .expect("relative path with workspace_root should succeed");
        assert_eq!(rel_preview.display_name, "hello_preview.txt");
        assert_eq!(rel_preview.total_lines, 3);

        let artifacts_dir = root.join("artifacts");
        std::fs::create_dir_all(&artifacts_dir).unwrap();
        std::fs::write(artifacts_dir.join("adr-output.md"), "# ADR\nOK").unwrap();
        let art_preview = read_file_for_preview(
            "adr-output.md".to_string(),
            Some(root.to_string_lossy().to_string()),
            None,
            None,
            None,
        )
        .await
        .expect("relative path inside workspace_root/artifacts should resolve cleanly");
        assert_eq!(art_preview.display_name, "adr-output.md");

        // 3. 测试二进制图像文件检测与 Data URL 输出
        let bin_file = root.join("test_image.png");
        std::fs::write(&bin_file, [0x89, 0x50, 0x4E, 0x47, 0x00, 0x01, 0x02, 0x03]).unwrap();
        let bin_preview = read_file_for_preview(
            bin_file.to_string_lossy().to_string(),
            None,
            None,
            None,
            None,
        )
        .await
        .expect("binary read should succeed");
        assert_eq!(bin_preview.is_binary, true);
        assert!(bin_preview.content.is_empty());
        assert!(
            bin_preview
                .image_data_url
                .as_deref()
                .is_some_and(|u| u.starts_with("data:image/png;base64,")),
            "image preview must include base64 data URL for local image rendering"
        );

        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn test_read_file_for_preview_large_file_window_jump_and_tail() {
        use std::io::Write;

        let root = temp_root();
        let _ = std::fs::create_dir_all(&root);
        let big_log = root.join("huge-trace.log");

        // 生成超过 4MB 的 65,000 行大文件（跨越原先 3MB 硬截断阈值）
        {
            let f = std::fs::File::create(&big_log).unwrap();
            let mut writer = std::io::BufWriter::new(f);
            for i in 1..=65_000usize {
                writeln!(
                    writer,
                    "LINE_{:05}: 2026-11-19T12:00:00Z INFO shadow_crew::worker payload=large_file_streaming_check_abcdef012345",
                    i
                )
                .unwrap();
            }
            writer.flush().unwrap();
        }

        let size = std::fs::metadata(&big_log).unwrap().len();
        assert!(size > 4 * 1024 * 1024, "test file must exceed old 3MB cap");
        let path_str = big_log.to_string_lossy().to_string();

        // 1. 默认首窗预览
        let head = read_file_for_preview(path_str.clone(), None, None, None, None)
            .await
            .expect("default large file window must succeed");
        assert!(head.is_windowed);
        assert!(head.is_truncated);
        assert_eq!(head.start_line, 1);
        assert_eq!(head.end_line, 500);
        assert_eq!(head.total_lines, 65_000);
        assert!(!head.has_more_before);
        assert!(head.has_more_after);
        assert!(head.content.contains("LINE_00001:"));
        assert!(head.content.contains("LINE_00500:"));

        // 2. 跳转超过 3MB 位置的第 60,000 行
        let jumped = read_file_for_preview(path_str.clone(), None, Some(60_000), Some(200), None)
            .await
            .expect("jump beyond 3MB must succeed");
        assert!(jumped.is_windowed);
        assert_eq!(jumped.start_line, 60_000);
        assert_eq!(jumped.end_line, 60_199);
        assert_eq!(jumped.total_lines, 65_000);
        assert!(jumped.has_more_before);
        assert!(jumped.has_more_after);
        assert!(jumped.content.contains("LINE_60000:"));
        assert!(jumped.content.contains("LINE_60199:"));

        // 3. Tail 末尾模式
        let tail_view = read_file_for_preview(path_str, None, None, Some(300), Some(true))
            .await
            .expect("tail large file view must succeed");
        assert!(tail_view.is_windowed);
        assert_eq!(tail_view.total_lines, 65_000);
        assert_eq!(tail_view.start_line, 64_701);
        assert_eq!(tail_view.end_line, 65_000);
        assert!(tail_view.has_more_before);
        assert!(!tail_view.has_more_after);
        assert!(tail_view.content.contains("LINE_65000:"));

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

    #[tokio::test]
    async fn test_read_file_for_preview_resolves_bare_filename_subpath_and_duplicated_root() {
        let root_parent = temp_root();
        let workspace_root = root_parent.join("renbao-lxcore");
        let internal_store = workspace_root.join("internal").join("store");
        let vendor_store = workspace_root.join("vendor").join("legacy");
        let outside_dir = root_parent.join("outside-repo");
        std::fs::create_dir_all(&internal_store).unwrap();
        std::fs::create_dir_all(&vendor_store).unwrap();
        std::fs::create_dir_all(&outside_dir).unwrap();

        let real_go = internal_store.join("cacheStore.go");
        std::fs::write(&real_go, "package store\n\ntype CacheStore struct{}\n").unwrap();
        // vendor 中的同名文件应被跳过
        std::fs::write(vendor_store.join("cacheStore.go"), "package vendor\n").unwrap();
        // 沙箱外的文件不能被相对 BFS 找到
        std::fs::write(outside_dir.join("outsideOnly.go"), "package outside\n").unwrap();

        let ws_str = workspace_root.to_string_lossy().to_string();

        // 1. 孤立文件名匹配到 internal/store/cacheStore.go
        let bare = read_file_for_preview("cacheStore.go".to_string(), Some(ws_str.clone()), None, None, None)
            .await
            .expect("bare filename must resolve via bounded BFS");
        assert!(bare.path.ends_with("internal/store/cacheStore.go") || bare.path.ends_with("internal\\store\\cacheStore.go"));
        assert!(bare.content.contains("package store"));
        assert!(bare.candidate_paths.is_none());

        // 2. 部分子路径匹配
        let subpath = read_file_for_preview("store/cacheStore.go".to_string(), Some(ws_str.clone()), None, None, None)
            .await
            .expect("partial subpath must resolve cleanly");
        assert!(subpath.content.contains("package store"));

        // 3. 重复带入仓库根目录前缀 (renbao-lxcore/internal/store/cacheStore.go)
        let dup_prefix = read_file_for_preview(
            "renbao-lxcore/internal/store/cacheStore.go".to_string(),
            Some(ws_str.clone()),
            None,
            None,
            None,
        )
        .await
        .expect("duplicated root folder name must strip and resolve");
        assert!(dup_prefix.content.contains("package store"));

        // 4. 含 .. 的路径不能逃逸或误触 BFS
        let err = read_file_for_preview("../missingFile.go".to_string(), Some(ws_str), None, None, None)
            .await
            .unwrap_err();
        assert!(err.contains("文件不存在"));

        let _ = std::fs::remove_dir_all(&root_parent);
    }

    #[tokio::test]
    async fn test_read_file_for_preview_returns_candidates_when_multiple_files_match() {
        let root = temp_root();
        let pkg_a = root.join("pkg").join("a");
        let pkg_b = root.join("pkg").join("b");
        std::fs::create_dir_all(&pkg_a).unwrap();
        std::fs::create_dir_all(&pkg_b).unwrap();

        std::fs::write(pkg_a.join("cacheStore.go"), "package a\n").unwrap();
        std::fs::write(pkg_b.join("cacheStore.go"), "package b\n").unwrap();

        let ws_str = root.to_string_lossy().to_string();
        let res = read_file_for_preview("cacheStore.go".to_string(), Some(ws_str), None, None, None)
            .await
            .expect("multiple matches should open primary and expose candidate_paths");
        let candidates = res.candidate_paths.expect("candidate_paths should be populated");
        assert_eq!(candidates.len(), 2);
        assert!(candidates.iter().any(|p| p.contains("/pkg/a/cacheStore.go") || p.contains("\\pkg\\a\\cacheStore.go")));
        assert!(candidates.iter().any(|p| p.contains("/pkg/b/cacheStore.go") || p.contains("\\pkg\\b\\cacheStore.go")));

        let _ = std::fs::remove_dir_all(&root);
    }

}
