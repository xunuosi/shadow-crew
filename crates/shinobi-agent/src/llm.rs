use anyhow::{anyhow, Context, Result};
use serde_json::{json, Value};
use std::process::Stdio;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

/// Shinobi 底座模型配置，由宿主 (Shadow Crew) 在拉起进程时通过 SHADOW_CREW_LLM_* 环境变量注入
#[derive(Debug, Clone)]
pub struct LlmConfig {
    pub provider: String,
    pub model_id: String,
    pub base_url: String,
    pub api_key: String,
    pub temperature: f64,
    pub max_tokens: u64,
}

impl LlmConfig {
    /// 从环境变量加载；未配置模型或缺少必要凭证时返回 None
    pub fn from_env() -> Option<Self> {
        let model_id = std::env::var("SHADOW_CREW_LLM_MODEL_ID").ok()?.trim().to_string();
        if model_id.is_empty() {
            return None;
        }
        let provider = std::env::var("SHADOW_CREW_LLM_PROVIDER")
            .unwrap_or_else(|_| "openai_compatible".to_string());
        let api_key = std::env::var("SHADOW_CREW_LLM_API_KEY").unwrap_or_default();
        // 本地 Ollama 免密，其余提供商必须有 Key
        if provider != "ollama" && api_key.trim().is_empty() {
            return None;
        }
        Some(Self {
            provider,
            model_id,
            base_url: std::env::var("SHADOW_CREW_LLM_BASE_URL").unwrap_or_default(),
            api_key,
            temperature: std::env::var("SHADOW_CREW_LLM_TEMPERATURE")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(0.7),
            max_tokens: std::env::var("SHADOW_CREW_LLM_MAX_TOKENS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(4096),
        })
    }
}

fn chat_completions_url(raw: &str) -> String {
    let url = raw.trim().trim_end_matches('/');
    if url.ends_with("/chat/completions") {
        url.to_string()
    } else {
        format!("{}/chat/completions", url)
    }
}

fn anthropic_messages_url(raw: &str) -> String {
    let url = raw.trim().trim_end_matches('/');
    if url.ends_with("/messages") {
        url.to_string()
    } else if url.ends_with("/v1") {
        format!("{}/messages", url)
    } else {
        format!("{}/v1/messages", url)
    }
}

/// 转义 curl 配置文件 (-K) 中双引号字符串的特殊字符
fn curl_config_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            _ => out.push(c),
        }
    }
    out
}

/// 通过系统 curl 发起 JSON POST。URL、请求头(含 API Key)与请求体全部经 stdin 以 curl 配置传入，
/// 避免凭证出现在进程参数列表 (ps) 中。
async fn post_json(url: &str, headers: &[(String, String)], body: &Value) -> Result<(u16, Value)> {
    let mut config = String::new();
    config.push_str(&format!("url = \"{}\"\n", curl_config_escape(url)));
    config.push_str("request = \"POST\"\n");
    config.push_str("header = \"Content-Type: application/json\"\n");
    for (k, v) in headers {
        config.push_str(&format!("header = \"{}: {}\"\n", curl_config_escape(k), curl_config_escape(v)));
    }
    config.push_str(&format!("data = \"{}\"\n", curl_config_escape(&body.to_string())));

    let mut child = Command::new("curl")
        .args(["-sS", "--max-time", "300", "-w", "\n%{http_code}", "-K", "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .context("无法启动系统 curl，请确认已安装")?;

    child
        .stdin
        .take()
        .ok_or_else(|| anyhow!("无法写入 curl stdin"))?
        .write_all(config.as_bytes())
        .await?;

    let output = child.wait_with_output().await?;
    if !output.status.success() {
        return Err(anyhow!(
            "网络请求失败: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let (payload, code) = stdout
        .rsplit_once('\n')
        .ok_or_else(|| anyhow!("无法解析网关响应"))?;
    let status: u16 = code.trim().parse().context("无法解析 HTTP 状态码")?;
    let value: Value = serde_json::from_str(payload)
        .with_context(|| format!("网关返回了非 JSON 内容 (HTTP {})", status))?;
    Ok((status, value))
}

/// 调用底座模型完成一次推演。Anthropic 走 /v1/messages，其余走 OpenAI 兼容 /chat/completions
pub async fn complete(config: &LlmConfig, system_prompt: &str, user_prompt: &str) -> Result<String> {
    if config.base_url.trim().is_empty() {
        return Err(anyhow!("模型 Base URL 未配置"));
    }

    if config.provider == "anthropic" {
        let body = json!({
            "model": config.model_id,
            "max_tokens": config.max_tokens,
            "temperature": config.temperature,
            "system": system_prompt,
            "messages": [{ "role": "user", "content": user_prompt }],
        });
        let headers = vec![
            ("x-api-key".to_string(), config.api_key.clone()),
            ("anthropic-version".to_string(), "2023-06-01".to_string()),
        ];
        let (status, value) = post_json(&anthropic_messages_url(&config.base_url), &headers, &body).await?;
        if !(200..300).contains(&status) {
            return Err(anyhow!("Anthropic 返回 HTTP {}: {}", status, value));
        }
        let text = value["content"]
            .as_array()
            .map(|blocks| {
                blocks
                    .iter()
                    .filter_map(|b| b["text"].as_str())
                    .collect::<Vec<_>>()
                    .join("")
            })
            .unwrap_or_default();
        return non_empty(text);
    }

    let body = json!({
        "model": config.model_id,
        "temperature": config.temperature,
        "max_tokens": config.max_tokens,
        "messages": [
            { "role": "system", "content": system_prompt },
            { "role": "user", "content": user_prompt },
        ],
    });
    let mut headers = Vec::new();
    if !config.api_key.trim().is_empty() {
        headers.push(("Authorization".to_string(), format!("Bearer {}", config.api_key)));
    }
    let (status, value) = post_json(&chat_completions_url(&config.base_url), &headers, &body).await?;
    if !(200..300).contains(&status) {
        return Err(anyhow!("模型网关返回 HTTP {}: {}", status, value));
    }
    let text = value["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    non_empty(text)
}

fn non_empty(text: String) -> Result<String> {
    if text.trim().is_empty() {
        Err(anyhow!("模型返回了空内容"))
    } else {
        Ok(text)
    }
}
