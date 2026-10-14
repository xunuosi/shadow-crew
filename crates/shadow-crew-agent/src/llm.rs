use anyhow::{anyhow, Context, Result};
use serde_json::{json, Value};
use std::time::Duration;
use shadow_crew_protocol::McpCallTrace;
use crate::mcp_client::SharedMcpClient;

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

/// 大模型执行返回结果，包含最终推演正文与 MCP 工具调用链路
#[derive(Debug, Clone)]
pub struct LlmExecutionResult {
    pub text_response: String,
    pub mcp_tool_calls: Vec<McpCallTrace>,
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

/// 快速单轮文本推演包装
#[allow(dead_code)]
pub async fn complete(config: &LlmConfig, system_prompt: &str, user_prompt: &str) -> Result<String> {
    let res = complete_with_tools(config, system_prompt, user_prompt, None, |_, _| {}).await?;
    Ok(res.text_response)
}

/// 支持挂载原生 MCP 工具的多轮 ReAct 推演执行循环
pub async fn complete_with_tools<F>(
    config: &LlmConfig,
    system_prompt: &str,
    user_prompt: &str,
    mcp_client: Option<SharedMcpClient>,
    on_tool_step: F,
) -> Result<LlmExecutionResult>
where
    F: Fn(&str, &str) + Send + Sync,
{
    if config.base_url.trim().is_empty() {
        return Err(anyhow!("模型 Base URL 未配置，请在设置中填写提供商网关地址"));
    }

    let client = build_http_client()?;
    let mut tool_traces: Vec<McpCallTrace> = Vec::new();
    const MAX_REACT_TURNS: usize = 8;

    if config.provider == "anthropic" {
        return run_anthropic_react_loop(
            &client,
            config,
            system_prompt,
            user_prompt,
            mcp_client,
            on_tool_step,
            MAX_REACT_TURNS,
        )
        .await;
    }

    // 默认走 OpenAI 兼容协议 (DeepSeek, 智谱, SiliconFlow, Ollama, 官方 OpenAI, 企业私有 AI 网关等)
    let url = chat_completions_url(&config.base_url);

    // 1. 获取可用 MCP 工具
    let openai_tools: Vec<Value> = if let Some(ref mcp) = mcp_client {
        let locked = mcp.lock().await;
        locked.to_openai_tools()
    } else {
        Vec::new()
    };

    let has_tools = !openai_tools.is_empty();

    let mut messages: Vec<Value> = vec![
        json!({ "role": "system", "content": system_prompt }),
        json!({ "role": "user", "content": user_prompt }),
    ];

    for _turn in 0..MAX_REACT_TURNS {
        let mut body = json!({
            "model": config.model_id,
            "temperature": config.temperature,
            "max_tokens": config.max_tokens,
            "messages": messages,
        });

        if has_tools {
            body["tools"] = json!(openai_tools);
            body["tool_choice"] = json!("auto");
        }

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

        let choice = &value["choices"][0];
        let message = &choice["message"];

        // 检查模型是否发起了工具调用 (Function Calling / Tool Calls)
        let tool_calls = message.get("tool_calls").and_then(|v| v.as_array());

        if let Some(calls) = tool_calls {
            if !calls.is_empty() {
                // 将大模型本轮响应 (含 tool_calls) 追加到历史
                messages.push(message.clone());

                for call in calls {
                    let call_id = call["id"].as_str().unwrap_or("call_default");
                    let func_name = call["function"]["name"].as_str().unwrap_or_default();
                    let func_args_raw = call["function"]["arguments"].as_str().unwrap_or("{}");
                    let parsed_args: Value = serde_json::from_str(func_args_raw).unwrap_or(json!({}));

                    tool_traces.push(McpCallTrace {
                        server_name: "shinobi-dev-mcp".to_string(),
                        tool_name: func_name.to_string(),
                        status: "executed".to_string(),
                    });

                    on_tool_step(func_name, func_args_raw);

                    let tool_output = if let Some(ref mcp) = mcp_client {
                        let mut locked = mcp.lock().await;
                        match locked.call_tool(func_name, &parsed_args).await {
                            Ok(out) => out,
                            Err(e) => format!("工具执行异常: {:#}", e),
                        }
                    } else {
                        "错误: 本地原生 MCP 服务未连接".to_string()
                    };

                    // 将工具执行输出作为 tool 消息压入上下文，供模型下一步推演
                    messages.push(json!({
                        "role": "tool",
                        "tool_call_id": call_id,
                        "name": func_name,
                        "content": tool_output
                    }));
                }

                // 进入下一轮 ReAct 循环，让模型分析工具产物
                continue;
            }
        }

        // 模型未请求工具，提取最终文本回复
        let final_text = message["content"]
            .as_str()
            .unwrap_or_default()
            .to_string();

        return Ok(LlmExecutionResult {
            text_response: non_empty(final_text)?,
            mcp_tool_calls: tool_traces,
        });
    }

    // 若达到最大轮数限制，尝试获取最后一条助手的回复内容
    let last_text = messages
        .iter()
        .rev()
        .find(|m| m["role"] == "assistant")
        .and_then(|m| m["content"].as_str())
        .unwrap_or("【Shinobi】已达到最大工具调用推演轮次上限。")
        .to_string();

    Ok(LlmExecutionResult {
        text_response: last_text,
        mcp_tool_calls: tool_traces,
    })
}

/// Anthropic Messages 协议工具调用 ReAct 循环
async fn run_anthropic_react_loop<F>(
    client: &reqwest::Client,
    config: &LlmConfig,
    system_prompt: &str,
    user_prompt: &str,
    mcp_client: Option<SharedMcpClient>,
    on_tool_step: F,
    max_turns: usize,
) -> Result<LlmExecutionResult>
where
    F: Fn(&str, &str) + Send + Sync,
{
    let url = anthropic_messages_url(&config.base_url);
    let mut tool_traces = Vec::new();

    let anthropic_tools: Vec<Value> = if let Some(ref mcp) = mcp_client {
        let locked = mcp.lock().await;
        locked.to_anthropic_tools()
    } else {
        Vec::new()
    };

    let has_tools = !anthropic_tools.is_empty();
    let mut messages: Vec<Value> = vec![json!({ "role": "user", "content": user_prompt })];

    for _ in 0..max_turns {
        let mut body = json!({
            "model": config.model_id,
            "max_tokens": config.max_tokens,
            "temperature": config.temperature,
            "system": system_prompt,
            "messages": messages,
        });

        if has_tools {
            body["tools"] = json!(anthropic_tools);
        }

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

        let stop_reason = value["stop_reason"].as_str().unwrap_or_default();
        let content_blocks = value["content"].as_array().cloned().unwrap_or_default();

        if stop_reason == "tool_use" {
            messages.push(json!({
                "role": "assistant",
                "content": content_blocks,
            }));

            let mut tool_results = Vec::new();
            for block in &content_blocks {
                if block["type"] == "tool_use" {
                    let tool_id = block["id"].as_str().unwrap_or("tool_default");
                    let tool_name = block["name"].as_str().unwrap_or_default();
                    let input_args = &block["input"];

                    tool_traces.push(McpCallTrace {
                        server_name: "shinobi-dev-mcp".to_string(),
                        tool_name: tool_name.to_string(),
                        status: "executed".to_string(),
                    });

                    on_tool_step(tool_name, &input_args.to_string());

                    let tool_output = if let Some(ref mcp) = mcp_client {
                        let mut locked = mcp.lock().await;
                        match locked.call_tool(tool_name, input_args).await {
                            Ok(out) => out,
                            Err(e) => format!("工具执行异常: {:#}", e),
                        }
                    } else {
                        "错误: 本地原生 MCP 服务未连接".to_string()
                    };

                    tool_results.push(json!({
                        "type": "tool_result",
                        "tool_use_id": tool_id,
                        "content": tool_output
                    }));
                }
            }

            messages.push(json!({
                "role": "user",
                "content": tool_results
            }));

            continue;
        }

        let text = content_blocks
            .iter()
            .filter_map(|b| if b["type"] == "text" { b["text"].as_str() } else { None })
            .collect::<Vec<_>>()
            .join("");

        return Ok(LlmExecutionResult {
            text_response: non_empty(text)?,
            mcp_tool_calls: tool_traces,
        });
    }

    Ok(LlmExecutionResult {
        text_response: "【Shinobi】已完成多轮推演与工具执行。".to_string(),
        mcp_tool_calls: tool_traces,
    })
}

fn non_empty(text: String) -> Result<String> {
    if text.trim().is_empty() {
        Err(anyhow!("模型网关返回了有效 HTTP 响应，但文本内容为空"))
    } else {
        Ok(text)
    }
}
