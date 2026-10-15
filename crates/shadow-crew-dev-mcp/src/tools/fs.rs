use anyhow::{anyhow, Result};
use std::path::Path;
use tokio::fs;

/// 读取文件内容，支持行切片
pub async fn read_file(
    path: &str,
    offset: Option<usize>,
    limit: Option<usize>,
) -> Result<String> {
    let p = Path::new(path);
    if !p.exists() {
        return Err(anyhow!("文件不存在: {}", path));
    }
    if !p.is_file() {
        return Err(anyhow!("目标路径不是一个常规文件: {}", path));
    }

    let content = fs::read_to_string(p)
        .await
        .map_err(|e| anyhow!("读取文件失败 [{}]: {}", path, e))?;

    if offset.is_none() && limit.is_none() {
        return Ok(content);
    }

    let start_line = offset.unwrap_or(1).saturating_sub(1);
    let max_lines = limit.unwrap_or(usize::MAX);

    let lines: Vec<&str> = content.lines().collect();
    let total_lines = lines.len();

    let sliced = lines
        .into_iter()
        .skip(start_line)
        .take(max_lines)
        .enumerate()
        .map(|(idx, line)| format!("{:4} | {}", start_line + idx + 1, line))
        .collect::<Vec<_>>()
        .join("\n");

    Ok(format!(
        "[文件: {}, 总行数: {}, 显示行范围: {}-{}]\n{}",
        path,
        total_lines,
        start_line + 1,
        (start_line + max_lines).min(total_lines),
        sliced
    ))
}

/// 写入或全量覆盖文件，自动创建父级目录
pub async fn write_file(path: &str, content: &str) -> Result<String> {
    let p = Path::new(path);
    if let Some(parent) = p.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent)
                .await
                .map_err(|e| anyhow!("创建父级目录失败 [{}]: {}", parent.display(), e))?;
        }
    }

    fs::write(p, content.as_bytes())
        .await
        .map_err(|e| anyhow!("写入文件失败 [{}]: {}", path, e))?;

    Ok(format!(
        "文件写入成功: {} (大小: {} 字节)",
        path,
        content.len()
    ))
}

/// 对文件内容进行精准子串替换 (str_replace)
pub async fn str_replace(path: &str, old_str: &str, new_str: &str) -> Result<String> {
    let p = Path::new(path);
    if !p.exists() {
        return Err(anyhow!("文件不存在: {}", path));
    }

    let content = fs::read_to_string(p)
        .await
        .map_err(|e| anyhow!("读取文件失败 [{}]: {}", path, e))?;

    if !content.contains(old_str) {
        return Err(anyhow!(
            "在文件 [{}] 中未找到匹配的目标字符串 old_str，请先读取文件核对内容",
            path
        ));
    }

    let count = content.matches(old_str).count();
    let replaced = content.replacen(old_str, new_str, 1);

    fs::write(p, replaced.as_bytes())
        .await
        .map_err(|e| anyhow!("写入替换内容失败 [{}]: {}", path, e))?;

    Ok(format!(
        "字符串替换成功 [{}]: 替换了 1 处匹配 (原匹配出现次数: {})",
        path, count
    ))
}

/// 列出目录中的文件与文件夹 (支持最大递归深度)
pub async fn list_dir(path: Option<&str>, max_depth: Option<usize>) -> Result<String> {
    let root = path.unwrap_or(".");
    let root_path = Path::new(root);
    if !root_path.exists() {
        return Err(anyhow!("路径不存在: {}", root));
    }

    let max_d = max_depth.unwrap_or(2);

    fn walk(
        dir: &Path,
        current_depth: usize,
        max_depth: usize,
        out: &mut Vec<String>,
    ) -> std::io::Result<()> {
        if current_depth > max_depth {
            return Ok(());
        }
        if let Ok(rd) = std::fs::read_dir(dir) {
            for entry in rd.flatten() {
                let p = entry.path();
                let name = entry.file_name().to_string_lossy().to_string();
                // 忽略噪音与构建目录
                if name.starts_with('.') || name == "target" || name == "node_modules" {
                    continue;
                }
                let is_dir = p.is_dir();
                let indent = "  ".repeat(current_depth);
                if is_dir {
                    out.push(format!("{}[DIR]  {}/", indent, name));
                    let _ = walk(&p, current_depth + 1, max_depth, out);
                } else {
                    out.push(format!("{}[FILE] {}", indent, name));
                }
            }
        }
        Ok(())
    }

    let mut out = Vec::new();
    out.push(format!("[Directory: {}]", root_path.display()));
    let _ = walk(root_path, 0, max_d, &mut out);

    Ok(out.join("\n"))
}

/// 在指定目录下按模式快速检索源码 (类似 grep / ripgrep)
pub async fn search_code(
    pattern: &str,
    path: Option<&str>,
    max_results: Option<usize>,
) -> Result<String> {
    if pattern.trim().is_empty() {
        return Err(anyhow!("搜索模式 pattern 不能为空"));
    }

    let root = path.unwrap_or(".");
    let root_path = Path::new(root);
    if !root_path.exists() {
        return Err(anyhow!("搜索路径不存在: {}", root));
    }

    let max_res = max_results.unwrap_or(50);
    let mut matches = Vec::new();

    fn walk_search(
        dir: &Path,
        pattern: &str,
        max_res: usize,
        matches: &mut Vec<String>,
    ) -> std::io::Result<()> {
        if matches.len() >= max_res {
            return Ok(());
        }
        if let Ok(rd) = std::fs::read_dir(dir) {
            for entry in rd.flatten() {
                if matches.len() >= max_res {
                    break;
                }
                let p = entry.path();
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with('.') || name == "target" || name == "node_modules" {
                    continue;
                }
                if p.is_dir() {
                    let _ = walk_search(&p, pattern, max_res, matches);
                } else if p.is_file() {
                    // 读取文件前检查扩展名，避免扫描大型二进制
                    if let Some(ext) = p.extension().and_then(|s| s.to_str()) {
                        let is_text = matches!(
                            ext,
                            "rs" | "ts" | "tsx" | "js" | "jsx" | "json" | "md" | "toml" | "yaml" | "yml" | "css" | "html" | "txt" | "sh" | "sql"
                        );
                        if !is_text {
                            continue;
                        }
                    }
                    if let Ok(content) = std::fs::read_to_string(&p) {
                        for (idx, line) in content.lines().enumerate() {
                            if line.contains(pattern) {
                                matches.push(format!(
                                    "{}:{}: {}",
                                    p.display(),
                                    idx + 1,
                                    line.trim()
                                ));
                                if matches.len() >= max_res {
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        }
        Ok(())
    }

    let _ = walk_search(root_path, pattern, max_res, &mut matches);

    if matches.is_empty() {
        Ok(format!("未在 [{}] 中搜索到关键词: {}", root, pattern))
    } else {
        Ok(format!(
            "搜索结果 (共 {} 处匹配):\n{}",
            matches.len(),
            matches.join("\n")
        ))
    }
}

/// 解析用户级 Shadow Crew 根目录 (~/.shadow-crew)
pub fn get_shadow_crew_home_dir() -> std::path::PathBuf {
    let base = std::env::var("SHADOW_CREW_HOME")
        .or_else(|_| std::env::var("SHINOBI_HOME"))
        .ok()
        .map(std::path::PathBuf::from)
        .or_else(|| {
            if cfg!(target_os = "windows") {
                std::env::var("USERPROFILE").ok().map(std::path::PathBuf::from)
            } else {
                std::env::var("HOME").ok().map(std::path::PathBuf::from)
            }
        })
        .unwrap_or_else(|| std::path::PathBuf::from("."));

    if base.ends_with(".shadow-crew") {
        base
    } else {
        base.join(".shadow-crew")
    }
}

/// 解析指定频道的落地产物目录 (~/.shadow-crew/channels/<channel_id>/artifacts/)
pub fn get_channel_artifacts_dir(channel_id: Option<&str>) -> std::path::PathBuf {
    let clean_id = channel_id
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.trim().to_string())
        .or_else(|| std::env::var("SHADOW_CREW_CHANNEL_ID").or_else(|_| std::env::var("SHINOBI_CHANNEL_ID")).ok().filter(|s| !s.trim().is_empty()))
        .unwrap_or_else(|| "chan-default".to_string());

    let artifacts_dir = get_shadow_crew_home_dir()
        .join("channels")
        .join(clean_id)
        .join("artifacts");
    let _ = std::fs::create_dir_all(&artifacts_dir);
    artifacts_dir
}

/// 将关键技术产物 (ADR 架构决策、推演设计白皮书、补丁 diff) 归档至当前频道专属产物目录
pub async fn write_channel_artifact(
    filename: &str,
    content: &str,
    channel_id: Option<&str>,
) -> Result<String> {
    let p = Path::new(filename);
    let clean_name = p
        .file_name()
        .ok_or_else(|| anyhow!("无效的产物文件名: {}", filename))?;
    let artifacts_dir = get_channel_artifacts_dir(channel_id);
    fs::create_dir_all(&artifacts_dir)
        .await
        .map_err(|e| anyhow!("创建产物目录失败 [{}]: {}", artifacts_dir.display(), e))?;

    let target_path = artifacts_dir.join(clean_name);

    fs::write(&target_path, content.as_bytes())
        .await
        .map_err(|e| anyhow!("写入产物失败 [{}]: {}", target_path.display(), e))?;

    Ok(format!(
        "产物已成功归档到当前频道专属产物目录: {} (大小: {} 字节)",
        target_path.display(),
        content.len()
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_read_write_replace() {
        let temp_dir = std::env::temp_dir();
        let test_file = temp_dir.join("test_shinobi_mcp_fs.txt");
        let path_str = test_file.to_str().unwrap();

        // 1. write
        let write_res = write_file(path_str, "line1\nline2\nhello shinobi\nline4").await;
        assert!(write_res.is_ok());

        // 2. read
        let read_res = read_file(path_str, Some(2), Some(2)).await.unwrap();
        assert!(read_res.contains("line2"));
        assert!(read_res.contains("hello shinobi"));

        // 3. str_replace
        let replace_res = str_replace(path_str, "hello shinobi", "hello world").await;
        assert!(replace_res.is_ok());

        let read_after = read_file(path_str, None, None).await.unwrap();
        assert!(read_after.contains("hello world"));

        let _ = fs::remove_file(test_file).await;
    }

    #[tokio::test]
    async fn test_write_channel_artifact() {
        let temp_dir = std::env::temp_dir().join("shadow_crew_mcp_test_art").join(".shadow-crew");
        std::env::set_var("SHADOW_CREW_HOME", &temp_dir);

        let res = write_channel_artifact("adr_001.md", "# ADR 001\nDecisions made.", Some("test-chan")).await;
        assert!(res.is_ok());
        let msg = res.unwrap();
        assert!(msg.contains("adr_001.md"));
        assert!(msg.contains("test-chan"));

        // Test DM isolated artifact directory
        let dm_res = write_channel_artifact("design_spec.md", "# Design Spec", Some("dm-agent-test-999")).await;
        assert!(dm_res.is_ok());
        let dm_msg = dm_res.unwrap();
        assert!(dm_msg.contains("design_spec.md"));
        assert!(dm_msg.contains("dm-agent-test-999"));
        assert!(temp_dir.join("channels").join("dm-agent-test-999").join("artifacts").join("design_spec.md").exists());

        let _ = fs::remove_dir_all(&temp_dir).await;
        std::env::remove_var("SHADOW_CREW_HOME");
    }
}
