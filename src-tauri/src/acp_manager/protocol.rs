use anyhow::{Context, Result};
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

use super::logging::now_millis;

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
#[serde(untagged)]
pub enum AcpEnvVar {
    Pair(String, String),
    Object { key: String, value: String },
}

impl AcpEnvVar {
    pub fn into_pair(self) -> (String, String) {
        match self {
            AcpEnvVar::Pair(k, v) => (k, v),
            AcpEnvVar::Object { key, value } => (key, value),
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpNativeMemoryCapability {
    pub status: String,
    pub persistent: Option<bool>,
    pub cross_thread: Option<bool>,
    pub provider: Option<String>,
    pub scope: Option<String>,
    pub detail: Option<String>,
    pub last_checked_at: u64,
}

impl Default for AcpNativeMemoryCapability {
    fn default() -> Self {
        Self {
            status: "unknown".to_string(),
            persistent: None,
            cross_thread: None,
            provider: None,
            scope: Some("unknown".to_string()),
            detail: Some("等待 ACP 端点握手声明".to_string()),
            last_checked_at: 0,
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AgentRuntimeStatus {
    pub agent_id: String,
    pub pid: u32,
    pub is_alive: bool,
    pub is_initialized: bool,
    pub auth_state: String, // "ok" | "auth_required" | "missing_key" | "unknown"
    pub status: String,     // "running" | "auth_required" | "starting" | "error" | "idle"
    pub status_detail: Option<String>,
    pub supports_load_session: Option<bool>,
    pub supports_resume_session: Option<bool>,
    pub native_memory: Option<AcpNativeMemoryCapability>,
    pub negotiated_protocol_version: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionEntry {
    pub session_id: String,
    pub system_prompt: String,
    pub created_gen: u64,
}

#[derive(Debug, Default, Clone)]
pub struct SessionRegistry {
    pub entries: HashMap<String, SessionEntry>,
    pub latest_clear_generation: u64,
}

impl SessionRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn get(&self, session_key: &str) -> Option<&SessionEntry> {
        self.entries.get(session_key)
    }

    pub fn insert(
        &mut self,
        session_key: String,
        session_id: String,
        system_prompt: String,
    ) -> u64 {
        let created_gen = self.latest_clear_generation + 1;
        self.entries.insert(
            session_key,
            SessionEntry {
                session_id,
                system_prompt,
                created_gen,
            },
        );
        created_gen
    }

    pub fn remove(&mut self, session_key: &str) -> Option<SessionEntry> {
        self.entries.remove(session_key)
    }

    /// 按作用域与清理代际（`clear_generation`）原子裁剪会话映射表：
    /// 1. 若 `clear_generation < latest_clear_generation`，判定为已超时/被新请求取代的迟到清理，直接返回空列表且不修改任何状态；
    /// 2. 否则推进 `latest_clear_generation`，并仅移除匹配作用域且 `created_gen <= clear_generation` 的会话，保护清理发起后新建的会话不被误删。
    pub fn prune_with_generation(
        &mut self,
        key_or_prefix: Option<&str>,
        clear_generation: Option<u64>,
    ) -> Vec<String> {
        if let Some(gen) = clear_generation {
            if gen < self.latest_clear_generation {
                tracing::warn!(
                    "[ACP Manager] Ignoring stale clear_sessions request (gen {} < latest {})",
                    gen,
                    self.latest_clear_generation
                );
                return Vec::new();
            }
            self.latest_clear_generation = self.latest_clear_generation.max(gen);
        }

        let mut removed_sessions: Vec<String> = Vec::new();

        if let Some(target) = key_or_prefix {
            let t = target.trim();
            // 精确 key 匹配或冒号前缀边界匹配 (如 "topic:c1:" 或 "channel:c1:")，杜绝 contains 模糊误删相邻键
            let colon_prefix = if t.ends_with(':') {
                t.to_string()
            } else {
                format!("{}:", t)
            };
            let mut keys_to_remove = Vec::new();

            for (k, entry) in self.entries.iter() {
                if k == t || k.starts_with(&colon_prefix) {
                    if let Some(max_gen) = clear_generation {
                        if entry.created_gen > max_gen {
                            continue;
                        }
                    }
                    keys_to_remove.push(k.clone());
                    removed_sessions.push(entry.session_id.clone());
                }
            }

            for k in keys_to_remove {
                self.entries.remove(&k);
            }
        } else if let Some(max_gen) = clear_generation {
            let mut keys_to_remove = Vec::new();
            for (k, entry) in self.entries.iter() {
                if entry.created_gen > max_gen {
                    continue;
                }
                keys_to_remove.push(k.clone());
                removed_sessions.push(entry.session_id.clone());
            }
            for k in keys_to_remove {
                self.entries.remove(&k);
            }
        } else {
            removed_sessions.extend(self.entries.values().map(|e| e.session_id.clone()));
            self.entries.clear();
        }

        removed_sessions
    }
}

/// 从 ACP initialize 响应中提取协商确定的协议版本 ("v2" 或 "v1")
pub fn parse_negotiated_protocol_version(result: &serde_json::Value) -> String {
    let ver_val = result
        .get("protocolVersion")
        .or_else(|| result.get("_meta").and_then(|m| m.get("negotiatedProtocolVersion")));
    if let Some(n) = ver_val.and_then(|v| v.as_i64().or_else(|| v.as_f64().map(|f| f as i64))) {
        if n >= 2 {
            return "v2".to_string();
        } else {
            return "v1".to_string();
        }
    }
    if let Some(s) = ver_val.and_then(|v| v.as_str()) {
        let s_trimmed = s.trim();
        if s_trimmed.starts_with('2') && !s_trimmed.starts_with("202") {
            return "v2".to_string();
        }
        return "v1".to_string();
    }
    "v1".to_string()
}

pub(crate) fn is_acp_capability_enabled(val: &serde_json::Value) -> bool {
    val.as_bool() == Some(true) || val.is_object()
}

/// 构造符合官方 ACP v1/v2 Schema (`zSystemPrompt` / `zSystemPrompt2`) 的 systemPrompt 对象载荷。
/// 若输入为空或纯空白字符，则返回 `None`（调用方不应挂载 `systemPrompt` 字段，避免触发空内容块校验错误）。
pub fn build_acp_system_prompt_param(sp: &str) -> Option<serde_json::Value> {
    if sp.trim().is_empty() {
        None
    } else {
        Some(serde_json::json!({
            "mode": "append",
            "content": [
                {
                    "type": "text",
                    "text": sp
                }
            ]
        }))
    }
}

/// 检查 ACP initialize 响应中是否声明了 loadSession 能力 (支持 capabilities.loadSession 或 agentCapabilities.loadSession)
pub fn check_supports_load_session(result: &serde_json::Value) -> bool {
    result
        .get("capabilities")
        .and_then(|c| c.get("loadSession"))
        .and_then(|v| v.as_bool())
        .or_else(|| {
            result
                .get("agentCapabilities")
                .and_then(|c| c.get("loadSession"))
                .and_then(|v| v.as_bool())
        })
        .or_else(|| {
            result
                .get("capabilities")
                .and_then(|c| c.get("sessions"))
                .and_then(|s| s.get("load"))
                .and_then(|v| v.as_bool())
        })
        .or_else(|| {
            result
                .get("agentCapabilities")
                .and_then(|c| c.get("sessions"))
                .and_then(|s| s.get("load"))
                .and_then(|v| v.as_bool())
        })
        .unwrap_or(false)
}

/// 检查 ACP initialize 响应中是否声明了 session/resume 能力
/// (兼容 ACP v1 agentCapabilities.sessionCapabilities.resume、平铺拓展，以及 ACP v2 标准 capabilities.session)
pub fn check_supports_resume_session(result: &serde_json::Value) -> bool {
    let explicit_candidates = [
        result
            .get("agentCapabilities")
            .and_then(|c| c.get("sessionCapabilities"))
            .and_then(|s| s.get("resume")),
        result
            .get("sessionCapabilities")
            .and_then(|c| c.get("resume")),
        result
            .get("capabilities")
            .and_then(|c| c.get("sessionCapabilities"))
            .and_then(|s| s.get("resume")),
        result
            .get("capabilities")
            .and_then(|c| c.get("session"))
            .and_then(|s| s.get("resume")),
        result
            .get("capabilities")
            .and_then(|c| c.get("sessions"))
            .and_then(|s| s.get("resume")),
        result
            .get("agentCapabilities")
            .and_then(|c| c.get("sessions"))
            .and_then(|s| s.get("resume")),
        result.get("capabilities").and_then(|c| c.get("resume")),
        result
            .get("agentCapabilities")
            .and_then(|c| c.get("resume")),
    ];

    for candidate in explicit_candidates.iter().flatten() {
        if candidate.as_bool() == Some(false) {
            return false;
        }
        if is_acp_capability_enabled(candidate) {
            return true;
        }
    }

    // 在 ACP v2 规范中，若 capabilities.session 存在且未显式禁用 resume，则原生支持 session/resume
    if parse_negotiated_protocol_version(result) == "v2"
        && result
            .get("capabilities")
            .and_then(|c| c.get("session"))
            .and_then(|s| s.as_object())
            .is_some()
    {
        return true;
    }

    false
}

/// 解析 ACP 可选扩展 agentCapabilities.nativeMemory。
///
/// 契约示例：
/// ```json
/// {
///   "agentCapabilities": {
///     "nativeMemory": {
///       "supported": true,
///       "enabled": true,
///       "persistent": true,
///       "crossThread": true,
///       "scope": "runtime",
///       "provider": "codex-memories"
///     }
///   }
/// }
/// ```
pub fn check_native_memory_capability(result: &serde_json::Value) -> AcpNativeMemoryCapability {
    let raw_opt = result
        .get("capabilities")
        .and_then(|capabilities| capabilities.get("nativeMemory"))
        .and_then(|value| value.as_object())
        .or_else(|| {
            result
                .get("agentCapabilities")
                .and_then(|capabilities| capabilities.get("nativeMemory"))
                .and_then(|value| value.as_object())
        });

    let Some(raw) = raw_opt else {
        return AcpNativeMemoryCapability {
            status: "unknown".to_string(),
            persistent: None,
            cross_thread: None,
            provider: None,
            scope: Some("unknown".to_string()),
            detail: Some("ACP 端点未声明 nativeMemory 扩展".to_string()),
            last_checked_at: now_millis(),
        };
    };

    let supported = raw.get("supported").and_then(|value| value.as_bool());
    let enabled = raw.get("enabled").and_then(|value| value.as_bool());
    let status = match (supported, enabled) {
        (Some(false), _) => "unsupported",
        (Some(true), Some(false)) => "disabled",
        (Some(true), Some(true)) => "enabled",
        _ => "unknown",
    };
    let scope = raw
        .get("scope")
        .and_then(|value| value.as_str())
        .filter(|value| matches!(*value, "agent" | "workspace" | "runtime"))
        .unwrap_or("unknown")
        .to_string();

    AcpNativeMemoryCapability {
        status: status.to_string(),
        persistent: raw.get("persistent").and_then(|value| value.as_bool()),
        cross_thread: raw.get("crossThread").and_then(|value| value.as_bool()),
        provider: raw
            .get("provider")
            .and_then(|value| value.as_str())
            .map(str::to_string),
        scope: Some(scope),
        detail: raw
            .get("detail")
            .and_then(|value| value.as_str())
            .map(str::to_string)
            .or_else(|| {
                (status == "unknown")
                    .then(|| "ACP 端点 nativeMemory 声明缺少有效的 supported/enabled 布尔字段".to_string())
            }),
        last_checked_at: now_millis(),
    }
}

pub fn maybe_refresh_native_memory_capability(
    result: &serde_json::Value,
) -> Option<AcpNativeMemoryCapability> {
    result
        .get("agentCapabilities")
        .and_then(|capabilities| capabilities.get("nativeMemory"))
        .and_then(|value| value.as_object())?;
    Some(check_native_memory_capability(result))
}

pub(crate) fn build_native_memory_prompt_meta(
    enabled: Option<bool>,
    auto_generate: Option<bool>,
) -> serde_json::Value {
    let enabled = enabled.unwrap_or(false);
    serde_json::json!({
        "shadowCrew": {
            "nativeMemory": {
                "enabled": enabled,
                "autoGenerate": enabled && auto_generate.unwrap_or(false)
            }
        }
    })
}

/// 从 ACP session/update 载荷中提取文本内容
pub fn extract_update_text(update: &serde_json::Value) -> Option<String> {
    if let Some(text) = update
        .get("content")
        .and_then(|c| c.get("text"))
        .and_then(|t| t.as_str())
    {
        Some(text.to_string())
    } else if let Some(s) = update.get("content").and_then(|c| c.as_str()) {
        Some(s.to_string())
    } else if let Some(text) = update
        .get("delta")
        .and_then(|d| d.get("text"))
        .and_then(|t| t.as_str())
    {
        Some(text.to_string())
    } else if let Some(s) = update.get("delta").and_then(|d| d.as_str()) {
        Some(s.to_string())
    } else if let Some(arr) = update.get("content").and_then(|c| c.as_array()) {
        let mut combined = String::new();
        for item in arr {
            if let Some(t) = item.get("text").and_then(|t| t.as_str()) {
                combined.push_str(t);
            } else if let Some(s) = item.as_str() {
                combined.push_str(s);
            }
        }
        if !combined.is_empty() {
            Some(combined)
        } else {
            None
        }
    } else if let Some(text) = update
        .get("item")
        .and_then(|i| i.get("text"))
        .and_then(|t| t.as_str())
    {
        Some(text.to_string())
    } else {
        None
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayMessageItem {
    pub message_id: String,
    pub role: String,
    pub content: String,
    pub timestamp: u64,
}

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct ReplaySinkState {
    pub session_id: String,
    pub session_key: String,
    pub agent_id: String,
    pub room_id: String,
    pub messages: Vec<ReplayMessageItem>,
    pub current_chunk_buffer: String,
    pub current_message_id: Option<String>,
    pub current_role: Option<String>,
}

impl ReplaySinkState {
    pub fn new(session_id: String, session_key: String, agent_id: String, room_id: String) -> Self {
        Self {
            session_id,
            session_key,
            agent_id,
            room_id,
            messages: Vec::new(),
            current_chunk_buffer: String::new(),
            current_message_id: None,
            current_role: None,
        }
    }

    pub fn flush_current_chunk(&mut self) {
        if !self.current_chunk_buffer.trim().is_empty() {
            let role = self
                .current_role
                .clone()
                .unwrap_or_else(|| "assistant".to_string());
            let msg_id = self.current_message_id.clone().unwrap_or_else(|| {
                format!("msg-replay-{}-{}", &self.session_id, self.messages.len())
            });
            let content = std::mem::take(&mut self.current_chunk_buffer);
            self.messages.push(ReplayMessageItem {
                message_id: msg_id,
                role,
                content,
                timestamp: std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as u64,
            });
            self.current_message_id = None;
            self.current_role = None;
        } else {
            self.current_chunk_buffer.clear();
            self.current_message_id = None;
            self.current_role = None;
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnsureSessionResult {
    pub session_id: String,
    pub is_new: bool,
    pub load_failed: bool,
    pub recovery_mode: Option<String>,
}


#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpPromptAttachment {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub mime_type: String,
    pub size: u64,
    pub path: String,
    pub uri: String,
}

pub(crate) fn jsonrpc_id_key(id: &serde_json::Value) -> Option<String> {
    if let Some(value) = id.as_str() {
        return Some(value.to_string());
    }
    if let Some(value) = id.as_u64() {
        return Some(value.to_string());
    }
    if let Some(value) = id.as_i64() {
        return Some(value.to_string());
    }
    None
}

pub(crate) fn acp_client_capabilities() -> serde_json::Value {
    serde_json::json!({
        "fs": {
            "readTextFile": false,
            "writeTextFile": false
        },
        "terminal": false
    })
}

pub(crate) fn acp_client_capabilities_v2() -> serde_json::Value {
    serde_json::json!({
        "tools": false
    })
}

pub fn check_supports_prompt_image(result: &serde_json::Value) -> bool {
    let candidates = [
        result
            .get("capabilities")
            .and_then(|value| value.get("promptCapabilities"))
            .and_then(|value| value.get("image")),
        result
            .get("agentCapabilities")
            .and_then(|value| value.get("promptCapabilities"))
            .and_then(|value| value.get("image")),
        result
            .get("promptCapabilities")
            .and_then(|value| value.get("image")),
        result
            .get("capabilities")
            .and_then(|value| value.get("session"))
            .and_then(|value| value.get("prompt"))
            .and_then(|value| value.get("image")),
        result
            .get("agentCapabilities")
            .and_then(|value| value.get("session"))
            .and_then(|value| value.get("prompt"))
            .and_then(|value| value.get("image")),
    ];
    for candidate in candidates.iter().flatten() {
        if candidate.as_bool() == Some(false) {
            return false;
        }
        if is_acp_capability_enabled(candidate) {
            return true;
        }
    }
    false
}

pub fn check_supports_embedded_context(result: &serde_json::Value) -> bool {
    let candidates = [
        result
            .get("capabilities")
            .and_then(|value| value.get("promptCapabilities"))
            .and_then(|value| value.get("embeddedContext")),
        result
            .get("agentCapabilities")
            .and_then(|value| value.get("promptCapabilities"))
            .and_then(|value| value.get("embeddedContext")),
        result
            .get("promptCapabilities")
            .and_then(|value| value.get("embeddedContext")),
        result
            .get("capabilities")
            .and_then(|value| value.get("session"))
            .and_then(|value| value.get("prompt"))
            .and_then(|value| value.get("embeddedContext")),
        result
            .get("agentCapabilities")
            .and_then(|value| value.get("session"))
            .and_then(|value| value.get("prompt"))
            .and_then(|value| value.get("embeddedContext")),
    ];
    for candidate in candidates.iter().flatten() {
        if candidate.as_bool() == Some(false) {
            return false;
        }
        if is_acp_capability_enabled(candidate) {
            return true;
        }
    }
    false
}

pub(crate) fn attachment_file_uri(path: &Path) -> String {
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

pub(crate) fn resolve_acp_attachment_path(
    raw_path: &str,
    attachment_root: &Path,
) -> Result<PathBuf> {
    let canonical_root = std::fs::canonicalize(attachment_root)
        .with_context(|| format!("Attachment root is unavailable: {}", attachment_root.display()))?;
    let canonical_path = std::fs::canonicalize(raw_path)
        .with_context(|| format!("Attachment does not exist: {}", raw_path))?;
    if !canonical_path.starts_with(&canonical_root) {
        anyhow::bail!(
            "Attachment path escapes Shadow Crew attachment root: {}",
            raw_path
        );
    }
    if !canonical_path.is_file() {
        anyhow::bail!("Attachment is not a regular file: {}", raw_path);
    }
    Ok(canonical_path)
}

pub(crate) fn build_prompt_content_blocks(
    prompt: &str,
    attachments: &[AcpPromptAttachment],
    supports_image: bool,
    supports_embedded_context: bool,
) -> Result<Vec<serde_json::Value>> {
    let attachment_root = crate::db_manager::get_shadow_crew_home_dir().join("attachments");
    build_prompt_content_blocks_from_root(
        prompt,
        attachments,
        supports_image,
        supports_embedded_context,
        &attachment_root,
    )
}

pub(crate) fn build_prompt_content_blocks_from_root(
    prompt: &str,
    attachments: &[AcpPromptAttachment],
    supports_image: bool,
    supports_embedded_context: bool,
    attachment_root: &Path,
) -> Result<Vec<serde_json::Value>> {
    let mut blocks = vec![serde_json::json!({
        "type": "text",
        "text": prompt
    })];

    for attachment in attachments {
        let path = resolve_acp_attachment_path(&attachment.path, attachment_root)?;
        let bytes = std::fs::read(&path)
            .with_context(|| format!("Failed to read ACP attachment: {}", path.display()))?;
        if bytes.len() as u64 != attachment.size {
            anyhow::bail!(
                "Attachment size changed after upload: {} (expected {}, actual {})",
                attachment.name,
                attachment.size,
                bytes.len()
            );
        }
        if attachment.uri.trim().is_empty() {
            anyhow::bail!("Attachment URI is missing for '{}'", attachment.name);
        }
        let uri = attachment_file_uri(&path);

        if attachment.kind == "image" {
            if !supports_image {
                anyhow::bail!(
                    "当前 ACP Agent 未声明 promptCapabilities.image，无法发送图片附件 '{}'",
                    attachment.name
                );
            }
            blocks.push(serde_json::json!({
                "type": "image",
                "data": BASE64_STANDARD.encode(&bytes),
                "mimeType": attachment.mime_type,
                "uri": uri,
                "_meta": {
                    "shadowCrewAttachmentId": attachment.id,
                    "name": attachment.name
                }
            }));
            continue;
        }

        if supports_embedded_context {
            let resource = if let Ok(text) = String::from_utf8(bytes.clone()) {
                serde_json::json!({
                    "uri": uri,
                    "mimeType": attachment.mime_type,
                    "text": text
                })
            } else {
                serde_json::json!({
                    "uri": uri,
                    "mimeType": attachment.mime_type,
                    "blob": BASE64_STANDARD.encode(&bytes)
                })
            };
            blocks.push(serde_json::json!({
                "type": "resource",
                "resource": resource
            }));
        } else {
            blocks.push(serde_json::json!({
                "type": "resource_link",
                "uri": uri,
                "name": attachment.name,
                "title": attachment.name,
                "description": "User-attached file from Shadow Crew",
                "mimeType": attachment.mime_type,
                "size": attachment.size
            }));
        }
    }
    Ok(blocks)
}


pub(crate) fn resolve_v2_terminal_text(
    stop_reason: &str,
    accumulated_text: &str,
    terminal_update: &serde_json::Value,
) -> String {
    let fallback_text = terminal_update
        .get("error")
        .and_then(|err| {
            err.as_str()
                .or_else(|| err.get("message").and_then(|m| m.as_str()))
        })
        .or_else(|| {
            terminal_update
                .get("text_response")
                .or_else(|| terminal_update.get("text"))
                .and_then(|text| text.as_str())
        })
        .unwrap_or("");
    if stop_reason == "error" && !fallback_text.trim().is_empty() {
        fallback_text.to_string()
    } else if accumulated_text.trim().is_empty() && !fallback_text.trim().is_empty() {
        fallback_text.to_string()
    } else {
        accumulated_text.to_string()
    }
}

/// 判断 session/prompt 返回的 JSON-RPC 错误是否属于明确的会话失效/不存在。
/// 仅当错误码为 -32001 (Session not found) 或 -32002 (Invalid session)，
/// 或错误提示包含 session not found / invalid session / unknown session / session expired 时，
/// 才认定底层会话已失效并执行作废。瞬态网络、鉴权、限流或工具调用错误绝不作废会话。
pub fn is_session_invalid_error(err: &serde_json::Value) -> bool {
    if let Some(code) = err.get("code").and_then(|c| c.as_i64()) {
        if code == -32001 || code == -32002 {
            return true;
        }
    }
    let msg = err
        .get("message")
        .and_then(|m| m.as_str())
        .unwrap_or_default()
        .to_lowercase();
    msg.contains("session not found")
        || msg.contains("invalid session")
        || msg.contains("unknown session")
        || msg.contains("session expired")
}

/// 由「进程存活 / 鉴权 / ACP 握手」三要素推导对外运行态。
///
/// 关键约束：进程存活但 ACP initialize 被拒绝时（例如适配器后端二进制缺失）必须是 error，
/// 绝不允许上报 running——进程活着只证明适配器在监听，不证明它能承载任何 prompt。
pub(crate) fn derive_runtime_status(is_alive: bool, auth_state: &str, has_init_error: bool) -> &'static str {
    if !is_alive {
        "idle"
    } else if auth_state == "auth_required" {
        "auth_required"
    } else if has_init_error {
        "error"
    } else {
        "running"
    }
}


#[cfg(test)]
mod tests {
    use super::*;
    use super::super::permission::{
        build_permission_request_view, parse_permission_options, PermissionScopeContext,
    };

    #[test]
    fn dead_process_is_idle() {
        assert_eq!(derive_runtime_status(false, "ok", false), "idle");
        assert_eq!(derive_runtime_status(false, "ok", true), "idle");
    }


    #[test]
    fn rejected_handshake_never_reports_running() {
        // 复现 MyCodex 场景：codex-acp 适配器进程存活，但 initialize 因 codex 缺失返回 JSON-RPC error
        assert_eq!(derive_runtime_status(true, "ok", true), "error");
    }


    #[test]
    fn healthy_handshake_is_running() {
        assert_eq!(derive_runtime_status(true, "ok", false), "running");
    }


    #[test]
    fn v2_terminal_text_falls_back_only_when_stream_is_empty() {
        let update = serde_json::json!({
            "stopReason": "end_turn",
            "text_response": "fallback result"
        });
        assert_eq!(
            resolve_v2_terminal_text("end_turn", "", &update),
            "fallback result"
        );
        assert_eq!(
            resolve_v2_terminal_text("end_turn", "streamed result", &update),
            "streamed result"
        );
    }


    #[test]
    fn v2_terminal_error_takes_precedence_over_progress_chunks() {
        let update = serde_json::json!({
            "stopReason": "error",
            "error": "permission denied by host policy"
        });
        assert_eq!(
            resolve_v2_terminal_text(
                "error",
                "\n> ⚙️ 正在执行: `cargo test`\n",
                &update
            ),
            "permission denied by host policy"
        );
    }


    #[test]
    fn prompt_content_blocks_include_images_and_embedded_files_without_path_escape() {
        let root = std::env::temp_dir().join(format!(
            "shadow_crew_prompt_attachment_test_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        let attachment_root = root.join("attachments");
        std::fs::create_dir_all(&attachment_root).unwrap();
        let image_path = attachment_root.join("image.png");
        let file_path = attachment_root.join("notes.txt");
        let outside_path = root.join("outside.txt");
        std::fs::write(&image_path, b"\x89PNG\r\n\x1a\nfake-image").unwrap();
        std::fs::write(&file_path, b"hello attachment").unwrap();
        std::fs::write(&outside_path, b"outside").unwrap();

        let image = AcpPromptAttachment {
            id: "img-1".to_string(),
            kind: "image".to_string(),
            name: "image.png".to_string(),
            mime_type: "image/png".to_string(),
            size: std::fs::metadata(&image_path).unwrap().len(),
            path: image_path.to_string_lossy().to_string(),
            uri: attachment_file_uri(&image_path),
        };
        let file = AcpPromptAttachment {
            id: "file-1".to_string(),
            kind: "file".to_string(),
            name: "notes.txt".to_string(),
            mime_type: "text/plain".to_string(),
            size: std::fs::metadata(&file_path).unwrap().len(),
            path: file_path.to_string_lossy().to_string(),
            uri: attachment_file_uri(&file_path),
        };

        let blocks = build_prompt_content_blocks_from_root(
            "review attachments",
            &[image.clone(), file],
            true,
            true,
            &attachment_root,
        )
        .unwrap();
        assert_eq!(blocks.len(), 3);
        assert_eq!(blocks[0]["type"], "text");
        assert_eq!(blocks[1]["type"], "image");
        assert_eq!(blocks[1]["mimeType"], "image/png");
        assert_eq!(blocks[2]["type"], "resource");
        assert_eq!(blocks[2]["resource"]["text"], "hello attachment");

        let linked_file = AcpPromptAttachment {
            id: "file-link".to_string(),
            kind: "file".to_string(),
            name: "linked.txt".to_string(),
            mime_type: "text/plain".to_string(),
            size: std::fs::metadata(&file_path).unwrap().len(),
            path: file_path.to_string_lossy().to_string(),
            uri: attachment_file_uri(&file_path),
        };
        let linked_blocks = build_prompt_content_blocks_from_root(
            "linked file",
            &[linked_file],
            false,
            false,
            &attachment_root,
        )
        .unwrap();
        assert_eq!(linked_blocks[1]["type"], "resource_link");

        assert!(
            build_prompt_content_blocks_from_root(
                "image unsupported",
                &[image],
                false,
                false,
                &attachment_root,
            )
            .is_err()
        );

        let escaped = AcpPromptAttachment {
            id: "bad".to_string(),
            kind: "file".to_string(),
            name: "outside.txt".to_string(),
            mime_type: "text/plain".to_string(),
            size: std::fs::metadata(&outside_path).unwrap().len(),
            path: outside_path.to_string_lossy().to_string(),
            uri: attachment_file_uri(&outside_path),
        };
        assert!(
            build_prompt_content_blocks_from_root(
                "escape",
                &[escaped],
                true,
                true,
                &attachment_root,
            )
            .is_err()
        );

        let _ = std::fs::remove_dir_all(root);
    }


    #[test]
    fn auth_required_outranks_init_error() {
        assert_eq!(
            derive_runtime_status(true, "auth_required", false),
            "auth_required"
        );
        assert_eq!(
            derive_runtime_status(true, "auth_required", true),
            "auth_required"
        );
    }


    #[test]
    fn test_check_supports_load_session() {
        use super::check_supports_load_session;

        let with_capabilities = serde_json::json!({
            "capabilities": {
                "loadSession": true
            }
        });
        assert!(check_supports_load_session(&with_capabilities));

        let with_agent_capabilities = serde_json::json!({
            "agentCapabilities": {
                "loadSession": true
            }
        });
        assert!(check_supports_load_session(&with_agent_capabilities));

        let with_nested_sessions = serde_json::json!({
            "capabilities": {
                "sessions": {
                    "load": true
                }
            }
        });
        assert!(check_supports_load_session(&with_nested_sessions));

        let without_support = serde_json::json!({
            "capabilities": {
                "prompts": { "listChanged": true }
            }
        });
        assert!(!check_supports_load_session(&without_support));
    }


    #[test]
    fn test_check_native_memory_capability_contract() {
        use super::check_native_memory_capability;

        let enabled = serde_json::json!({
            "agentCapabilities": {
                "nativeMemory": {
                    "supported": true,
                    "enabled": true,
                    "persistent": true,
                    "crossThread": true,
                    "scope": "runtime",
                    "provider": "codex-memories"
                }
            }
        });
        let capability = check_native_memory_capability(&enabled);
        assert_eq!(capability.status, "enabled");
        assert_eq!(capability.persistent, Some(true));
        assert_eq!(capability.cross_thread, Some(true));
        assert_eq!(capability.provider.as_deref(), Some("codex-memories"));
        assert_eq!(capability.scope.as_deref(), Some("runtime"));

        // ACP v2 统一 capabilities 契约验证
        let v2_enabled = serde_json::json!({
            "capabilities": {
                "nativeMemory": {
                    "supported": true,
                    "enabled": true,
                    "persistent": true,
                    "crossThread": true,
                    "scope": "workspace",
                    "provider": "codex-memories"
                }
            }
        });
        let cap_v2 = check_native_memory_capability(&v2_enabled);
        assert_eq!(cap_v2.status, "enabled");
        assert_eq!(cap_v2.scope.as_deref(), Some("workspace"));

        let disabled = serde_json::json!({
            "agentCapabilities": {
                "nativeMemory": {
                    "supported": true,
                    "enabled": false,
                    "persistent": true,
                    "crossThread": true
                }
            }
        });
        assert_eq!(
            check_native_memory_capability(&disabled).status,
            "disabled"
        );

        let unsupported = serde_json::json!({
            "agentCapabilities": {
                "nativeMemory": {
                    "supported": false
                }
            }
        });
        assert_eq!(
            check_native_memory_capability(&unsupported).status,
            "unsupported"
        );

        let undeclared = serde_json::json!({
            "agentCapabilities": {
                "loadSession": true
            }
        });
        let unknown = check_native_memory_capability(&undeclared);
        assert_eq!(unknown.status, "unknown");
        assert!(unknown.persistent.is_none());
        assert!(unknown.cross_thread.is_none());
        assert_eq!(unknown.scope.as_deref(), Some("unknown"));

        let missing_enabled = serde_json::json!({
            "agentCapabilities": {
                "nativeMemory": {
                    "supported": true
                }
            }
        });
        assert_eq!(
            check_native_memory_capability(&missing_enabled).status,
            "unknown"
        );
    }


    #[test]
    fn test_native_memory_prompt_meta_contract() {
        use super::build_native_memory_prompt_meta;

        let enabled = build_native_memory_prompt_meta(Some(true), Some(false));
        assert_eq!(
            enabled["shadowCrew"]["nativeMemory"]["enabled"],
            serde_json::Value::Bool(true)
        );
        assert_eq!(
            enabled["shadowCrew"]["nativeMemory"]["autoGenerate"],
            serde_json::Value::Bool(false)
        );

        let disabled = build_native_memory_prompt_meta(Some(false), Some(true));
        assert_eq!(
            disabled["shadowCrew"]["nativeMemory"]["enabled"],
            serde_json::Value::Bool(false)
        );
        assert_eq!(
            disabled["shadowCrew"]["nativeMemory"]["autoGenerate"],
            serde_json::Value::Bool(false)
        );

        let defaults = build_native_memory_prompt_meta(None, None);
        assert_eq!(
            defaults["shadowCrew"]["nativeMemory"]["enabled"],
            serde_json::Value::Bool(false)
        );
        assert_eq!(
            defaults["shadowCrew"]["nativeMemory"]["autoGenerate"],
            serde_json::Value::Bool(false)
        );
    }


    #[test]
    fn test_is_session_invalid_error_detection() {
        use super::is_session_invalid_error;

        // 1. 标准错误码 -32001 (Session not found)
        let err_32001 = serde_json::json!({
            "code": -32001,
            "message": "Session not found: session-abc"
        });
        assert!(is_session_invalid_error(&err_32001));

        // 2. 标准错误码 -32002 (Invalid session)
        let err_32002 = serde_json::json!({
            "code": -32002,
            "message": "Session invalid or closed"
        });
        assert!(is_session_invalid_error(&err_32002));

        // 3. 错误码为通用错误，但文案明确提示 session unknown / expired
        let err_msg_unknown = serde_json::json!({
            "code": -32603,
            "message": "Unknown session identifier session-123"
        });
        assert!(is_session_invalid_error(&err_msg_unknown));

        let err_msg_expired = serde_json::json!({
            "code": -32000,
            "message": "The session expired due to timeout"
        });
        assert!(is_session_invalid_error(&err_msg_expired));

        // 4. 瞬态错误（限流、鉴权、工具失败、语法错误等）绝不误判为会话失效
        let err_rate_limit = serde_json::json!({
            "code": 429,
            "message": "Rate limit exceeded, please retry later"
        });
        assert!(!is_session_invalid_error(&err_rate_limit));

        let err_auth = serde_json::json!({
            "code": -32000,
            "message": "Authentication required: missing ANTHROPIC_API_KEY"
        });
        assert!(!is_session_invalid_error(&err_auth));

        let err_tool = serde_json::json!({
            "code": -32603,
            "message": "Tool execution failed: cargo check failed"
        });
        assert!(!is_session_invalid_error(&err_tool));
    }


    #[test]
    fn test_check_supports_resume_session() {
        use super::check_supports_resume_session;

        let with_standard_agent_capabilities = serde_json::json!({
            "agentCapabilities": {
                "sessionCapabilities": {
                    "resume": {}
                }
            }
        });
        assert!(check_supports_resume_session(&with_standard_agent_capabilities));

        let with_session_capabilities = serde_json::json!({
            "sessionCapabilities": {
                "resume": {}
            }
        });
        assert!(check_supports_resume_session(&with_session_capabilities));

        let with_session_capabilities_bool = serde_json::json!({
            "sessionCapabilities": {
                "resume": true
            }
        });
        assert!(check_supports_resume_session(
            &with_session_capabilities_bool
        ));

        let with_capabilities_nested = serde_json::json!({
            "capabilities": {
                "sessionCapabilities": {
                    "resume": {}
                }
            }
        });
        assert!(check_supports_resume_session(&with_capabilities_nested));

        let with_capabilities_resume = serde_json::json!({
            "capabilities": {
                "resume": true
            }
        });
        assert!(check_supports_resume_session(&with_capabilities_resume));

        let without_support = serde_json::json!({
            "capabilities": {
                "prompts": { "listChanged": true }
            }
        });
        assert!(!check_supports_resume_session(&without_support));
    }


    #[test]
    fn test_ensure_session_result_serialization() {
        use super::EnsureSessionResult;

        let res = EnsureSessionResult {
            session_id: "sid-123".to_string(),
            is_new: true,
            load_failed: false,
            recovery_mode: Some("resume".to_string()),
        };
        let json_val = serde_json::to_value(&res).unwrap();
        assert_eq!(json_val["sessionId"], "sid-123");
        assert_eq!(json_val["isNew"], true);
        assert_eq!(json_val["loadFailed"], false);
        assert_eq!(json_val["recoveryMode"], "resume");
    }


    #[test]
    fn test_maybe_refresh_native_memory_capability_on_prompt_result() {
        use super::maybe_refresh_native_memory_capability;

        let plain_prompt_result = serde_json::json!({
            "text_response": "OK",
            "stopReason": "completed"
        });
        assert!(maybe_refresh_native_memory_capability(&plain_prompt_result).is_none());

        let recovered_prompt_result = serde_json::json!({
            "text_response": "OK",
            "stopReason": "completed",
            "agentCapabilities": {
                "nativeMemory": {
                    "supported": true,
                    "enabled": true,
                    "persistent": true,
                    "crossThread": true,
                    "provider": "codex-memories",
                    "scope": "runtime"
                }
            }
        });
        let refreshed =
            maybe_refresh_native_memory_capability(&recovered_prompt_result).unwrap();
        assert_eq!(refreshed.status, "enabled");
        assert_eq!(refreshed.provider.as_deref(), Some("codex-memories"));
    }


    #[test]
    fn test_acp_v2_capabilities_and_receipt_detection() {
        use super::{check_supports_prompt_image, check_supports_embedded_context};

        // 1. 测试 ACP v2 单一 capabilities 结构声明
        let v2_resp = serde_json::json!({
            "protocolVersion": 2,
            "capabilities": {
                "promptCapabilities": {
                    "image": true,
                    "embeddedContext": true
                }
            }
        });
        assert!(check_supports_prompt_image(&v2_resp));
        assert!(check_supports_embedded_context(&v2_resp));

        // 2. 测试 ACP v2 Insertion-Receipt 判别逻辑
        let receipt_result = serde_json::json!({
            "messageId": "msg-v2-001",
            "status": "accepted"
        });
        let has_receipt = receipt_result.get("messageId").is_some()
            || receipt_result.get("status").and_then(|s| s.as_str()) == Some("accepted");
        let has_terminal = receipt_result.get("stopReason").is_some()
            || receipt_result.get("text_response").is_some()
            || receipt_result.get("response").is_some();
        let is_v2_receipt = has_receipt && !has_terminal;
        assert!(is_v2_receipt, "纯 messageId + status 回执必须被正确判定为 v2 receipt");

        // 3. 测试带有 stopReason 的终结结果不能误判为 receipt
        let terminal_result = serde_json::json!({
            "messageId": "msg-v2-001",
            "status": "accepted",
            "stopReason": "end_turn"
        });
        let has_receipt = terminal_result.get("messageId").is_some()
            || terminal_result.get("status").and_then(|s| s.as_str()) == Some("accepted");
        let has_terminal = terminal_result.get("stopReason").is_some()
            || terminal_result.get("text_response").is_some()
            || terminal_result.get("response").is_some();
        let is_v2_receipt = has_receipt && !has_terminal;
        assert!(!is_v2_receipt, "含有 stopReason 的终态响应绝不可误判为 pending receipt");
    }


    #[test]
    fn test_parse_negotiated_protocol_version() {
        use super::parse_negotiated_protocol_version;

        // 数值测试
        assert_eq!(parse_negotiated_protocol_version(&serde_json::json!({ "protocolVersion": 2 })), "v2");
        assert_eq!(parse_negotiated_protocol_version(&serde_json::json!({ "protocolVersion": 1 })), "v1");
        assert_eq!(parse_negotiated_protocol_version(&serde_json::json!({ "protocolVersion": 2.0 })), "v2");

        // 字符串测试
        assert_eq!(parse_negotiated_protocol_version(&serde_json::json!({ "protocolVersion": "2" })), "v2");
        assert_eq!(parse_negotiated_protocol_version(&serde_json::json!({ "protocolVersion": "2.0.0" })), "v2");
        assert_eq!(parse_negotiated_protocol_version(&serde_json::json!({ "protocolVersion": "1.0.4" })), "v1");
        assert_eq!(parse_negotiated_protocol_version(&serde_json::json!({ "protocolVersion": "2025-01-01 (ACP v1.0.4)" })), "v1");
        assert_eq!(parse_negotiated_protocol_version(&serde_json::json!({ "protocolVersion": "2024-11-05" })), "v1");
        assert_eq!(parse_negotiated_protocol_version(&serde_json::json!({})), "v1");

        // 元数据 fallback 测试
        assert_eq!(
            parse_negotiated_protocol_version(&serde_json::json!({
                "_meta": { "negotiatedProtocolVersion": 2 }
            })),
            "v2"
        );
        assert_eq!(
            parse_negotiated_protocol_version(&serde_json::json!({
                "_meta": { "negotiatedProtocolVersion": 1 }
            })),
            "v1"
        );
    }


    #[test]
    fn test_build_acp_system_prompt_param_and_official_v2_capabilities() {
        use super::{
            build_acp_system_prompt_param, check_supports_embedded_context,
            check_supports_prompt_image, check_supports_resume_session, resolve_v2_terminal_text,
        };

        // 1. 空字符串或纯空白不挂载 systemPrompt 对象，防止官方 codex-acp 报 "systemPrompt content must not be empty"
        assert!(build_acp_system_prompt_param("").is_none());
        assert!(build_acp_system_prompt_param("   \n\t ").is_none());

        // 2. 非空 systemPrompt 构造符合 zSystemPrompt / zSystemPrompt2 的标准结构
        let sp_obj = build_acp_system_prompt_param("你是安全审计专家").expect("should build object");
        assert_eq!(sp_obj["mode"], "append");
        assert_eq!(sp_obj["content"][0]["type"], "text");
        assert_eq!(sp_obj["content"][0]["text"], "你是安全审计专家");

        // 3. 官方 @agentclientprotocol/codex-acp initializeV2 响应能力探测
        let official_v2_init = serde_json::json!({
            "protocolVersion": 2,
            "info": {
                "name": "@agentclientprotocol/codex-acp",
                "title": "Codex",
                "version": "2.6.0"
            },
            "capabilities": {
                "auth": {},
                "providers": {},
                "session": {
                    "prompt": {
                        "embeddedContext": {},
                        "image": {}
                    },
                    "mcp": {
                        "stdio": {},
                        "http": {}
                    },
                    "delete": {},
                    "additionalDirectories": {},
                    "fork": {},
                    "title": {},
                    "systemPrompt": {}
                }
            }
        });
        assert!(
            check_supports_resume_session(&official_v2_init),
            "官方 ACP v2 capabilities.session 应识别支持 session/resume"
        );
        assert!(
            check_supports_prompt_image(&official_v2_init),
            "官方 ACP v2 capabilities.session.prompt.image 对象应识别支持图片"
        );
        assert!(
            check_supports_embedded_context(&official_v2_init),
            "官方 ACP v2 capabilities.session.prompt.embeddedContext 对象应识别支持内嵌上下文"
        );

        // 4. 官方 ACP v2 session/request_permission (subject.toolCall + 顶层 title/description) 解析验证
        let v2_perm_params = serde_json::json!({
            "sessionId": "019a0000-0000-7000-8000-000000000001",
            "title": "Run command?",
            "description": "Execute cargo test in workspace",
            "subject": {
                "type": "tool_call",
                "toolCall": {
                    "toolCallId": "call-v2-1",
                    "name": "Bash",
                    "kind": "execute",
                    "status": "pending",
                    "rawInput": {
                        "command": "cargo test -p shadow-crew-protocol"
                    },
                    "locations": [
                        { "path": "/tmp/ws/crates/shadow-crew-protocol/src/lib.rs" },
                        { "path": "/Users/test/.codex/auth.json" }
                    ]
                }
            },
            "options": [
                { "optionId": "allow-once", "name": "Allow once", "kind": "allow_once" },
                { "optionId": "reject", "name": "Reject", "kind": "reject_once" }
            ]
        });
        let opts = parse_permission_options(&v2_perm_params);
        let view = build_permission_request_view(
            "agent-codex-v2",
            "req-99".to_string(),
            "019a0000-0000-7000-8000-000000000001".to_string(),
            PermissionScopeContext {
                scope_type: "topic".to_string(),
                scope_id: "topic-1".to_string(),
                workspace_binding_id: "ws-1".to_string(),
                session_key: "agent-codex-v2:topic:topic-1:ws-1".to_string(),
                cwd: "/tmp/ws".to_string(),
            },
            &v2_perm_params,
            opts,
        );
        assert_eq!(view.capability, "shell.execute");
        assert_eq!(view.tool_name, "Bash");
        assert_eq!(view.tool_title, "Run command?");
        assert_eq!(
            view.description.as_deref(),
            Some("Execute cargo test in workspace")
        );
        assert_eq!(
            view.command.as_deref(),
            Some("cargo test -p shadow-crew-protocol")
        );
        assert!(
            view.outside_workspace_paths
                .iter()
                .any(|p| p.contains(".codex/auth.json")),
            "ACP v2 subject.toolCall 越界敏感路径必须被准确提取并拦截"
        );

        // 5. 官方 ACP v2 state_update 错误对象文本提取验证
        let v2_err_state = serde_json::json!({
            "sessionUpdate": "state_update",
            "state": "idle",
            "stopReason": "error",
            "error": {
                "code": -32603,
                "message": "Connection to Codex was lost."
            }
        });
        assert_eq!(
            resolve_v2_terminal_text("error", "", &v2_err_state),
            "Connection to Codex was lost."
        );
    }

}
