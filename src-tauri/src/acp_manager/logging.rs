use std::sync::atomic::{AtomicU64, Ordering};
use tokio::io::AsyncBufReadExt;

pub(crate) fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

static NEXT_INIT_REQUEST_ID: AtomicU64 = AtomicU64::new(1001);

pub(crate) fn next_init_request_id() -> u64 {
    NEXT_INIT_REQUEST_ID.fetch_add(1, Ordering::Relaxed)
}

/// 单次 JSON-RPC stdin 写出超时上限（对齐 Buzz 30s 写出超时）
pub(crate) const ACP_STDIN_WRITE_TIMEOUT_SECS: u64 = 30;
/// 单条出站 NDJSON 行最大字节数（对齐 Buzz 4 MiB 单行 JSON-RPC 限制）
pub(crate) const ACP_MAX_OUTBOUND_LINE_BYTES: usize = 4 * 1024 * 1024;
/// 单条入站 stdout NDJSON 行最大字节数（对齐 Buzz 10 MiB 防 OOM 上限）
pub(crate) const ACP_MAX_STDOUT_LINE_BYTES: usize = 10 * 1024 * 1024;

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum BoundedLineRead {
    Line(String),
    Overflow { discarded_bytes: usize },
    Eof,
}

/// 有界读取单行 stdout（按字节扫描 `\n`，超过 `max_bytes` 后立即停止内存追加并跳过该行剩余字节，防止异常 Agent 无限输出导致 OOM）
pub(crate) async fn read_bounded_stdout_line<R: tokio::io::AsyncBufRead + Unpin>(
    reader: &mut R,
    max_bytes: usize,
) -> std::io::Result<BoundedLineRead> {
    let mut buf: Vec<u8> = Vec::new();
    let mut overflowed = false;
    let mut discarded_bytes: usize = 0;

    loop {
        let available = reader.fill_buf().await?;
        if available.is_empty() {
            if overflowed {
                return Ok(BoundedLineRead::Overflow { discarded_bytes });
            }
            if buf.is_empty() {
                return Ok(BoundedLineRead::Eof);
            }
            let line = String::from_utf8_lossy(&buf).into_owned();
            return Ok(BoundedLineRead::Line(line));
        }

        if let Some(newline_pos) = available.iter().position(|&b| b == b'\n') {
            if !overflowed {
                if buf.len() + newline_pos <= max_bytes {
                    buf.extend_from_slice(&available[..newline_pos]);
                    if buf.last() == Some(&b'\r') {
                        buf.pop();
                    }
                    reader.consume(newline_pos + 1);
                    let line = String::from_utf8_lossy(&buf).into_owned();
                    return Ok(BoundedLineRead::Line(line));
                } else {
                    discarded_bytes = buf.len() + newline_pos;
                    buf.clear();
                    buf.shrink_to_fit();
                }
            } else {
                discarded_bytes += newline_pos;
            }
            reader.consume(newline_pos + 1);
            return Ok(BoundedLineRead::Overflow { discarded_bytes });
        } else {
            let chunk_len = available.len();
            if !overflowed {
                if buf.len() + chunk_len <= max_bytes {
                    buf.extend_from_slice(available);
                } else {
                    overflowed = true;
                    discarded_bytes = buf.len() + chunk_len;
                    buf.clear();
                    buf.shrink_to_fit();
                }
            } else {
                discarded_bytes += chunk_len;
            }
            reader.consume(chunk_len);
        }
    }
}

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


#[cfg(test)]
mod tests {

    #[test]
    fn test_initialize_request_ids_are_unique() {
        use super::next_init_request_id;

        let first = next_init_request_id();
        let second = next_init_request_id();
        assert_ne!(first, second);
        assert!(second > first);
    }


    #[tokio::test]
    async fn test_read_bounded_stdout_line_prevents_oom_and_recovers() {
        use super::{read_bounded_stdout_line, BoundedLineRead};
        use tokio::io::BufReader;

        let oversized = "x".repeat(120);
        let payload = format!("first-line\n{}\nsecond-line\r\n", oversized);
        let mut reader = BufReader::new(payload.as_bytes());

        let first = read_bounded_stdout_line(&mut reader, 64).await.unwrap();
        assert_eq!(first, BoundedLineRead::Line("first-line".to_string()));

        let overflow = read_bounded_stdout_line(&mut reader, 64).await.unwrap();
        assert_eq!(
            overflow,
            BoundedLineRead::Overflow {
                discarded_bytes: 120
            }
        );

        let second = read_bounded_stdout_line(&mut reader, 64).await.unwrap();
        assert_eq!(second, BoundedLineRead::Line("second-line".to_string()));

        let eof = read_bounded_stdout_line(&mut reader, 64).await.unwrap();
        assert_eq!(eof, BoundedLineRead::Eof);
    }

}
