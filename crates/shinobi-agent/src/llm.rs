use anyhow::{anyhow, Context, Result};
use serde_json::{json, Value};
use std::time::Duration;

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
    } else if url.ends_with("/v1") {
        format!("{}/chat/completions", url)
    } else {
        format!("{}/v1/chat/completions", url)
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

/// 构建支持环境变量代理与自适应超时的 Rust 原生 HTTP 客户端
fn build_http_client() -> Result<reqwest::Client> {
    let mut builder = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(300));

    // 显式检查代理环境变量 (http_proxy / https_proxy / all_proxy)
    if let Ok(proxy_url) = std::env::var("https_proxy")
        .or_else(|_| std::env::var("HTTPS_PROXY"))
        .or_else(|_| std::env::var("http_proxy"))
        .or_else(|_| std::env::var("HTTP_PROXY"))
        .or_else(|_| std::env::var("all_proxy"))
        .or_else(|_| std::env::var("ALL_PROXY"))
    {
        if !proxy_url.trim().is_empty() {
            if let Ok(proxy) = reqwest::Proxy::all(&proxy_url) {
                builder = builder.proxy(proxy);
            }
        }
    }

    builder.build().context("初始化 Rust 原生 HTTP 客户端失败")
}

/// 使用 Rust 内核原生异步网络栈 (reqwest) 调用底座大模型完成推演，彻底规避前端浏览器 CORS 跨域限制
pub async fn complete(config: &LlmConfig, system_prompt: &str, user_prompt: &str) -> Result<String> {
    if config.base_url.trim().is_empty() {
        return Err(anyhow!("模型 Base URL 未配置，请在设置中填写提供商网关地址"));
    }

    let client = build_http_client()?;

    if config.provider == "anthropic" {
        let url = anthropic_messages_url(&config.base_url);
        let body = json!({
            "model": config.model_id,
            "max_tokens": config.max_tokens,
            "temperature": config.temperature,
            "system": system_prompt,
            "messages": [{ "role": "user", "content": user_prompt }],
        });

        let req = client.post(&url)
            .header("x-api-key", &config.api_key)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json")
            .json(&body);

        let resp = req.send().await.with_context(|| format!("请求 Anthropic 端点 [{}] 失败", url))?;
        let status = resp.status();
        let resp_text = resp.text().await.unwrap_or_default();

        if !status.is_success() {
            return Err(anyhow!("Anthropic 服务端响应异常 (HTTP {}): {}", status.as_u16(), resp_text));
        }

        let value: Value = serde_json::from_str(&resp_text)
            .with_context(|| format!("解析 Anthropic JSON 响应失败: {}", resp_text))?;

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

    // OpenAI 兼容协议 (DeepSeek, Ollama, 智谱, SiliconFlow, 官方 OpenAI, 企业私有 AI 网关等)
    let url = chat_completions_url(&config.base_url);
    let body = json!({
        "model": config.model_id,
        "temperature": config.temperature,
        "max_tokens": config.max_tokens,
        "messages": [
            { "role": "system", "content": system_prompt },
            { "role": "user", "content": user_prompt },
        ],
    });

    let mut req = client.post(&url)
        .header("content-type", "application/json")
        .json(&body);

    if !config.api_key.trim().is_empty() {
        req = req.header("Authorization", format!("Bearer {}", config.api_key.trim()));
    }

    let resp = req.send().await.with_context(|| format!("请求大模型网关端点 [{}] 失败", url))?;
    let status = resp.status();
    let resp_text = resp.text().await.unwrap_or_default();

    if !status.is_success() {
        return Err(anyhow!("大模型网关服务端响应异常 (HTTP {}): {}", status.as_u16(), resp_text));
    }

    let value: Value = serde_json::from_str(&resp_text)
        .with_context(|| format!("解析大模型网关 JSON 响应失败: {}", resp_text))?;

    let text = value["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or_default()
        .to_string();

    non_empty(text)
}

fn non_empty(text: String) -> Result<String> {
    if text.trim().is_empty() {
        Err(anyhow!("模型网关返回了有效 HTTP 响应，但文本内容为空"))
    } else {
        Ok(text)
    }
}
