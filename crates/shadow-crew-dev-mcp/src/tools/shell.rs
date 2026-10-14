use anyhow::{anyhow, Result};
use std::path::Path;
use std::time::Duration;
use tokio::process::Command;

/// 默认命令执行超时 120 秒，上限 10 分钟 (600 秒)
const DEFAULT_TIMEOUT_MS: u64 = 120_000;
const MAX_TIMEOUT_MS: u64 = 600_000;

/// 执行 Shell 命令行工具，支持 workdir 与超时控制
pub async fn execute_shell(
    command: &str,
    workdir: Option<&str>,
    timeout_ms: Option<u64>,
) -> Result<String> {
    if command.trim().is_empty() {
        return Err(anyhow!("shell command 不能为空"));
    }

    let timeout_duration = Duration::from_millis(
        timeout_ms
            .unwrap_or(DEFAULT_TIMEOUT_MS)
            .min(MAX_TIMEOUT_MS)
            .max(1_000),
    );

    let mut cmd = if cfg!(target_os = "windows") {
        let mut c = Command::new("cmd");
        c.args(["/C", command]);
        c
    } else {
        let mut c = Command::new("bash");
        c.args(["-c", command]);
        c
    };

    if let Some(dir) = workdir {
        let p = Path::new(dir);
        if p.exists() {
            cmd.current_dir(p);
        } else {
            return Err(anyhow!("指定的工作目录不存在: {}", dir));
        }
    }

    // 独立进程组、输出捕获与超时自动终止防护
    cmd.kill_on_drop(true);
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    let child = cmd.spawn().map_err(|e| anyhow!("启动命令失败 [{}]: {}", command, e))?;

    let timeout_res = tokio::time::timeout(timeout_duration, child.wait_with_output()).await;

    match timeout_res {
        Ok(Ok(output)) => {
            let exit_code = output.status.code().unwrap_or(-1);
            let stdout_str = String::from_utf8_lossy(&output.stdout);
            let stderr_str = String::from_utf8_lossy(&output.stderr);

            let mut result = format!("[Exit Code: {}]\n", exit_code);
            if !stdout_str.is_empty() {
                result.push_str("STDOUT:\n");
                result.push_str(&stdout_str);
                if !stdout_str.ends_with('\n') {
                    result.push('\n');
                }
            }
            if !stderr_str.is_empty() {
                result.push_str("STDERR:\n");
                result.push_str(&stderr_str);
                if !stderr_str.ends_with('\n') {
                    result.push('\n');
                }
            }
            if stdout_str.is_empty() && stderr_str.is_empty() {
                result.push_str("(No output produced)\n");
            }

            Ok(result)
        }
        Ok(Err(e)) => Err(anyhow!("命令执行过程异常中断: {}", e)),
        Err(_) => {
            // 超时时 wait_with_output future 被 drop，由于启用了 kill_on_drop(true)，子进程自动被强制 kill
            Err(anyhow!(
                "命令执行超时 (限制 {}ms)，已被强制终止: {}",
                timeout_duration.as_millis(),
                command
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_execute_echo() {
        let res = execute_shell("echo 'hello shinobi'", None, Some(5000)).await.unwrap();
        assert!(res.contains("hello shinobi"));
        assert!(res.contains("[Exit Code: 0]"));
    }

    #[tokio::test]
    async fn test_execute_timeout() {
        let res = execute_shell("sleep 3", None, Some(500)).await;
        assert!(res.is_err());
        assert!(res.unwrap_err().to_string().contains("超时"));
    }
}
