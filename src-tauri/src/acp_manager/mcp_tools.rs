use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct TrackedMcpToolCall {
    pub tool_call_id: String,
    pub server_name: String,
    pub tool_name: String,
    pub name: String,
    pub status: String,
    pub arguments: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_output: Option<serde_json::Value>,
}

const AUTO_APPROVED_GOVERNANCE_TOOLS: &[&str] = &[
    "submit_arbitration_ruling",
    "submit_role_concurrence",
    "submit_module_decomposition",
    "submit_grounding_evidence",
    "submit_challenge_critique",
    "submit_execution_deliverable",
    "validate_workspace_diff",
];

pub(crate) fn is_known_shadow_crew_mcp_tool(tool_name: &str) -> bool {
    AUTO_APPROVED_GOVERNANCE_TOOLS.contains(&tool_name)
        || matches!(
            tool_name,
            "write_channel_artifact" | "write_agent_artifact"
        )
}

/// 解析 MCP 工具名称，兼容 Claude Code (`mcp__<server>__<tool>`)、Codex (`mcp.<server>.<tool>`) 与裸名
pub fn normalize_mcp_server_and_tool(raw_name: &str) -> (Option<String>, String) {
    let trimmed = raw_name.trim();
    if let Some(rest) = trimmed.strip_prefix("mcp__") {
        if let Some((server, tool)) = rest.split_once("__") {
            let clean_server = server.trim();
            let clean_tool = tool.trim();
            if !clean_server.is_empty() && !clean_tool.is_empty() {
                return (Some(clean_server.to_string()), clean_tool.to_string());
            }
        }
    }
    if let Some(rest) = trimmed.strip_prefix("mcp.") {
        if let Some((server, tool)) = rest.split_once('.') {
            let clean_server = server.trim();
            let clean_tool = tool.trim();
            if !clean_server.is_empty() && !clean_tool.is_empty() {
                return (Some(clean_server.to_string()), clean_tool.to_string());
            }
        }
    }
    if is_known_shadow_crew_mcp_tool(trimmed) {
        return (
            Some("shadow-crew-dev-mcp".to_string()),
            trimmed.to_string(),
        );
    }
    (None, trimmed.to_string())
}

pub(crate) fn is_non_empty_tool_args(val: &serde_json::Value) -> bool {
    match val {
        serde_json::Value::Null => false,
        serde_json::Value::Object(map) => !map.is_empty(),
        serde_json::Value::Array(arr) => !arr.is_empty(),
        serde_json::Value::String(s) => !s.trim().is_empty(),
        serde_json::Value::Bool(_) | serde_json::Value::Number(_) => true,
    }
}

pub(crate) fn extract_mcp_tool_arguments(update_obj: &serde_json::Value) -> serde_json::Value {
    let raw_candidate = if let Some(raw_input) = update_obj.get("rawInput") {
        if let Some(obj) = raw_input.as_object() {
            if obj.contains_key("server") && obj.contains_key("tool") && obj.contains_key("arguments")
            {
                obj.get("arguments").cloned().unwrap_or(serde_json::Value::Null)
            } else {
                raw_input.clone()
            }
        } else {
            raw_input.clone()
        }
    } else {
        update_obj
            .get("arguments")
            .or_else(|| update_obj.get("args"))
            .or_else(|| update_obj.get("input"))
            .cloned()
            .unwrap_or(serde_json::Value::Null)
    };

    if let serde_json::Value::String(ref raw_str) = raw_candidate {
        let trimmed = raw_str.trim();
        if (trimmed.starts_with('{') && trimmed.ends_with('}'))
            || (trimmed.starts_with('[') && trimmed.ends_with(']'))
        {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(trimmed) {
                return parsed;
            }
        }
    }

    raw_candidate
}

pub(crate) fn raw_output_indicates_error(raw_output: &serde_json::Value) -> bool {
    if raw_output
        .get("result")
        .and_then(|r| r.get("isError"))
        .and_then(|v| v.as_bool())
        == Some(true)
    {
        return true;
    }
    if raw_output
        .get("isError")
        .and_then(|v| v.as_bool())
        == Some(true)
    {
        return true;
    }
    if raw_output
        .get("error")
        .map(|v| !v.is_null())
        .unwrap_or(false)
    {
        return true;
    }
    false
}

/// 合并并追踪单次 session/prompt 生命周期内的 `tool_call` / `tool_call_update` 事件
pub fn upsert_tracked_tool_call(
    list: &mut Vec<TrackedMcpToolCall>,
    update_obj: &serde_json::Value,
) {
    let tool_call_id = update_obj
        .get("toolCallId")
        .or_else(|| update_obj.get("id"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("tool-call-{}", list.len() + 1));

    let explicit_server = update_obj
        .get("rawInput")
        .and_then(|v| v.get("server"))
        .and_then(|v| v.as_str())
        .or_else(|| update_obj.get("server_name").and_then(|v| v.as_str()))
        .or_else(|| update_obj.get("serverName").and_then(|v| v.as_str()))
        .or_else(|| update_obj.get("server").and_then(|v| v.as_str()))
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);

    let raw_input_tool = update_obj
        .get("rawInput")
        .and_then(|v| v.get("tool"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty());

    let claude_tool_name = update_obj
        .get("_meta")
        .and_then(|m| m.get("claudeCode"))
        .and_then(|c| c.get("toolName"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty());

    let direct_tool_name = update_obj
        .get("tool_name")
        .and_then(|v| v.as_str())
        .or_else(|| update_obj.get("tool").and_then(|v| v.as_str()))
        .or_else(|| update_obj.get("name").and_then(|v| v.as_str()))
        .map(str::trim)
        .filter(|s| !s.is_empty());

    let title_str = update_obj
        .get("title")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty());

    let mut parsed_server: Option<String> = explicit_server;
    let mut parsed_tool = String::new();

    for candidate in [raw_input_tool, claude_tool_name, direct_tool_name, title_str]
        .into_iter()
        .flatten()
    {
        let (srv_opt, bare_tool) = normalize_mcp_server_and_tool(candidate);
        if parsed_server.is_none() {
            parsed_server = srv_opt;
        }
        if parsed_tool.is_empty() && !bare_tool.is_empty() {
            parsed_tool = bare_tool;
        }
        if parsed_server.is_some() && !parsed_tool.is_empty() {
            break;
        }
    }

    let args = extract_mcp_tool_arguments(update_obj);

    let raw_output = update_obj
        .get("rawOutput")
        .filter(|v| !v.is_null())
        .cloned()
        .or_else(|| update_obj.get("output").filter(|v| !v.is_null()).cloned())
        .or_else(|| {
            update_obj
                .get("_meta")
                .and_then(|m| m.get("claudeCode"))
                .and_then(|c| c.get("toolResponse"))
                .filter(|v| !v.is_null())
                .cloned()
        });

    let mut status = update_obj
        .get("status")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    if let Some(ref out) = raw_output {
        if raw_output_indicates_error(out) {
            status = Some("failed".to_string());
        }
    }

    if let Some(existing) = list.iter_mut().find(|item| item.tool_call_id == tool_call_id) {
        if existing.server_name.is_empty() {
            if let Some(srv) = parsed_server {
                existing.server_name = srv;
            }
        }
        if existing.tool_name.is_empty() && !parsed_tool.is_empty() {
            existing.tool_name = parsed_tool.clone();
            existing.name = parsed_tool;
        } else if !parsed_tool.is_empty()
            && existing.server_name.is_empty()
            && (is_known_shadow_crew_mcp_tool(&parsed_tool)
                || parsed_tool != existing.tool_name)
        {
            // 若前序仅拿到通用 title，后续 update 携带更精确工具名时予以刷新
            if existing.tool_name == "Terminal" || existing.tool_name == "unknown" {
                existing.tool_name = parsed_tool.clone();
                existing.name = parsed_tool;
            }
        }
        if is_non_empty_tool_args(&args) {
            existing.arguments = args;
        }
        if let Some(out) = raw_output {
            existing.raw_output = Some(out);
        }
        if let Some(new_status) = status {
            let existing_terminal =
                existing.status == "completed" || existing.status == "failed";
            let new_terminal = new_status == "completed" || new_status == "failed";
            if !existing_terminal || new_terminal {
                existing.status = new_status;
            }
        }
        return;
    }

    let final_server = parsed_server.unwrap_or_default();
    let final_tool = if parsed_tool.is_empty() {
        "unknown".to_string()
    } else {
        parsed_tool
    };
    list.push(TrackedMcpToolCall {
        tool_call_id,
        server_name: final_server,
        tool_name: final_tool.clone(),
        name: final_tool,
        status: status.unwrap_or_else(|| "pending".to_string()),
        arguments: if args.is_null() {
            serde_json::json!({})
        } else {
            args
        },
        raw_output,
    });
}

/// 判断权限请求是否为无破坏性的治理/契约上报工具，若是则自动放行以保障 4+1 状态机无人值守推演
pub fn is_auto_approved_governance_tool(params_or_tool_call: &serde_json::Value) -> bool {
    let tool_call = params_or_tool_call
        .get("toolCall")
        .or_else(|| {
            params_or_tool_call
                .get("subject")
                .and_then(|subject| subject.get("toolCall"))
        })
        .unwrap_or(params_or_tool_call);

    let candidates = [
        tool_call
            .get("_meta")
            .and_then(|m| m.get("claudeCode"))
            .and_then(|c| c.get("toolName"))
            .and_then(|v| v.as_str()),
        tool_call
            .get("rawInput")
            .and_then(|r| r.get("tool"))
            .and_then(|v| v.as_str()),
        tool_call.get("tool_name").and_then(|v| v.as_str()),
        tool_call.get("tool").and_then(|v| v.as_str()),
        tool_call.get("name").and_then(|v| v.as_str()),
        tool_call.get("title").and_then(|v| v.as_str()),
        params_or_tool_call.get("title").and_then(|v| v.as_str()),
    ];

    for candidate in candidates.into_iter().flatten() {
        let (_, normalized) = normalize_mcp_server_and_tool(candidate);
        if AUTO_APPROVED_GOVERNANCE_TOOLS.contains(&normalized.as_str()) {
            return true;
        }
    }
    false
}

/// 解析内置 `shadow-crew-dev-mcp` 二进制的绝对路径
pub fn resolve_dev_mcp_binary_path_with_overrides(
    cwd: &str,
    host_cwd: &str,
    env_overrides: &[Option<&str>],
) -> Option<String> {
    let mut candidates: Vec<PathBuf> = env_overrides
        .iter()
        .flatten()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
        .collect();

    candidates.extend([
        PathBuf::from(cwd).join("target/debug/shadow-crew-dev-mcp"),
        PathBuf::from(cwd).join("target/release/shadow-crew-dev-mcp"),
        PathBuf::from(host_cwd).join("target/debug/shadow-crew-dev-mcp"),
        PathBuf::from(host_cwd).join("target/release/shadow-crew-dev-mcp"),
        PathBuf::from(host_cwd).join("../target/debug/shadow-crew-dev-mcp"),
        PathBuf::from(host_cwd).join("../target/release/shadow-crew-dev-mcp"),
        PathBuf::from("target/debug/shadow-crew-dev-mcp"),
        PathBuf::from("target/release/shadow-crew-dev-mcp"),
        PathBuf::from("../target/debug/shadow-crew-dev-mcp"),
        PathBuf::from("../../target/debug/shadow-crew-dev-mcp"),
    ]);

    if let Some(workspace_root) = Path::new(env!("CARGO_MANIFEST_DIR")).parent() {
        candidates.push(workspace_root.join("target/debug/shadow-crew-dev-mcp"));
        candidates.push(workspace_root.join("target/release/shadow-crew-dev-mcp"));
    }

    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            candidates.push(exe_dir.join("shadow-crew-dev-mcp"));
            if let Some(contents_dir) = exe_dir.parent() {
                candidates.push(contents_dir.join("Resources/shadow-crew-dev-mcp"));
            }
        }
    }

    candidates.extend([
        PathBuf::from(cwd).join("target/debug/shinobi-dev-mcp"),
        PathBuf::from(cwd).join("target/release/shinobi-dev-mcp"),
        PathBuf::from(host_cwd).join("target/debug/shinobi-dev-mcp"),
        PathBuf::from(host_cwd).join("target/release/shinobi-dev-mcp"),
        PathBuf::from("target/debug/shinobi-dev-mcp"),
        PathBuf::from("target/release/shinobi-dev-mcp"),
        PathBuf::from("../target/debug/shinobi-dev-mcp"),
        PathBuf::from("../../target/debug/shinobi-dev-mcp"),
    ]);

    for candidate in candidates {
        if let Ok(canonical) = std::fs::canonicalize(&candidate) {
            if canonical.is_file() {
                return Some(canonical.to_string_lossy().to_string());
            }
        }
    }
    None
}

/// 解析内置 `shadow-crew-dev-mcp` 二进制的绝对路径（优先读取显式环境变量覆盖）
pub fn resolve_dev_mcp_binary_path(cwd: &str, host_cwd: &str) -> Option<String> {
    let env_primary = std::env::var("SHADOW_CREW_DEV_MCP_PATH").ok();
    let env_legacy = std::env::var("SHINOBI_DEV_MCP_PATH").ok();
    resolve_dev_mcp_binary_path_with_overrides(
        cwd,
        host_cwd,
        &[env_primary.as_deref(), env_legacy.as_deref()],
    )
}

/// 构造挂载到 ACP session (`session/new` / `session/load` / `session/resume`) 的 `mcpServers` 载荷。
/// - ACP v2 (`negotiated_protocol_version == "v2"`) 要求 stdio 服务器显式携带 `"type": "stdio"` (`zMcpServer2`)。
/// - ACP v1 (`claude-agent-acp` 等) 通过 `!("type" in server)` 识别 stdio 服务器，因此必须省略 `"type"` 字段。
pub fn build_session_mcp_servers(
    dev_mcp_path: Option<&str>,
    negotiated_protocol_version: &str,
    agent_id: &str,
    channel_id: Option<&str>,
    effective_cwd: &str,
    env_vars: &Option<HashMap<String, String>>,
) -> serde_json::Value {
    let Some(path) = dev_mcp_path.map(str::trim).filter(|s| !s.is_empty()) else {
        return serde_json::json!([]);
    };

    let home_dir = crate::db_manager::get_shadow_crew_home_dir()
        .to_string_lossy()
        .to_string();

    let mut env_pairs: Vec<(String, String)> = vec![
        ("SHADOW_CREW_HOME".to_string(), home_dir.clone()),
        ("SHINOBI_HOME".to_string(), home_dir),
        (
            "SHADOW_CREW_WORKSPACE_ROOT".to_string(),
            effective_cwd.to_string(),
        ),
        ("SHADOW_CREW_AGENT_ID".to_string(), agent_id.to_string()),
        ("SHINOBI_AGENT_ID".to_string(), agent_id.to_string()),
        (
            "SHADOW_CREW_DEV_MCP_PROFILE".to_string(),
            "governance_only".to_string(),
        ),
    ];

    let resolved_channel_id = channel_id
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .or_else(|| {
            env_vars.as_ref().and_then(|map| {
                map.get("SHADOW_CREW_CHANNEL_ID")
                    .or_else(|| map.get("SHINOBI_CHANNEL_ID"))
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
            })
        });
    if let Some(cid) = resolved_channel_id {
        env_pairs.push(("SHADOW_CREW_CHANNEL_ID".to_string(), cid.clone()));
        env_pairs.push(("SHINOBI_CHANNEL_ID".to_string(), cid));
    }

    if let Some(map) = env_vars {
        for key in [
            "SHADOW_CREW_ARTIFACT_ROOT",
            "SHINOBI_ARTIFACT_ROOT",
            "SHADOW_CREW_WORKSPACE_BINDING_ID",
        ] {
            if let Some(val) = map.get(key).map(|s| s.trim()).filter(|s| !s.is_empty()) {
                env_pairs.push((key.to_string(), val.to_string()));
            }
        }
    }

    let env_array: Vec<serde_json::Value> = env_pairs
        .into_iter()
        .map(|(name, value)| serde_json::json!({ "name": name, "value": value }))
        .collect();

    if negotiated_protocol_version == "v2" {
        serde_json::json!([{
            "type": "stdio",
            "name": "shadow-crew-dev-mcp",
            "command": path,
            "args": [],
            "env": env_array
        }])
    } else {
        serde_json::json!([{
            "name": "shadow-crew-dev-mcp",
            "command": path,
            "args": [],
            "env": env_array
        }])
    }
}


#[cfg(test)]
mod tests {

    #[test]
    fn test_build_session_mcp_servers_v1_and_v2() {
        use super::build_session_mcp_servers;
        use std::collections::HashMap;

        let empty = build_session_mcp_servers(None, "v1", "agent-1", Some("chan-1"), "/ws", &None);
        assert_eq!(empty, serde_json::json!([]));

        let mut env_map = HashMap::new();
        env_map.insert(
            "SHADOW_CREW_ARTIFACT_ROOT".to_string(),
            "/tmp/artifacts".to_string(),
        );
        env_map.insert(
            "SHADOW_CREW_WORKSPACE_BINDING_ID".to_string(),
            "bind-1".to_string(),
        );
        let wrapped_env = Some(env_map);

        // ACP v1 (e.g. claude-agent-acp) MUST omit "type" for stdio servers
        let v1_servers = build_session_mcp_servers(
            Some("/abs/path/shadow-crew-dev-mcp"),
            "v1",
            "agent-claude",
            Some("chan-abc"),
            "/tmp/ws",
            &wrapped_env,
        );
        let v1_arr = v1_servers.as_array().unwrap();
        assert_eq!(v1_arr.len(), 1);
        assert_eq!(v1_arr[0]["name"], "shadow-crew-dev-mcp");
        assert_eq!(v1_arr[0]["command"], "/abs/path/shadow-crew-dev-mcp");
        assert!(
            v1_arr[0].get("type").is_none(),
            "ACP v1 stdio entry must omit 'type' for claude-agent-acp compatibility"
        );
        let env_list = v1_arr[0]["env"].as_array().unwrap();
        assert!(env_list
            .iter()
            .any(|e| e["name"] == "SHADOW_CREW_WORKSPACE_ROOT" && e["value"] == "/tmp/ws"));
        assert!(env_list
            .iter()
            .any(|e| e["name"] == "SHADOW_CREW_ARTIFACT_ROOT" && e["value"] == "/tmp/artifacts"));
        assert!(env_list
            .iter()
            .any(|e| e["name"] == "SHADOW_CREW_WORKSPACE_BINDING_ID" && e["value"] == "bind-1"));

        // ACP v2 (e.g. @agentclientprotocol/codex-acp) REQUIRES "type": "stdio"
        let v2_servers = build_session_mcp_servers(
            Some("/abs/path/shadow-crew-dev-mcp"),
            "v2",
            "agent-codex",
            None,
            "/tmp/ws",
            &wrapped_env,
        );
        let v2_arr = v2_servers.as_array().unwrap();
        assert_eq!(v2_arr.len(), 1);
        assert_eq!(v2_arr[0]["type"], "stdio");
        assert_eq!(v2_arr[0]["name"], "shadow-crew-dev-mcp");
    }


    #[test]
    fn test_resolve_dev_mcp_binary_path_precedence_and_fallback() {
        use super::resolve_dev_mcp_binary_path_with_overrides;

        let temp_dir = std::env::temp_dir().join(format!(
            "sc-dev-mcp-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let override_bin = temp_dir.join("custom-dev-mcp");
        std::fs::write(&override_bin, "#!/bin/sh\nexit 0\n").unwrap();

        let overridden = resolve_dev_mcp_binary_path_with_overrides(
            "/nonexistent-cwd",
            "/nonexistent-host",
            &[Some(override_bin.to_string_lossy().as_ref()), None],
        );
        assert_eq!(
            overridden.as_deref(),
            Some(std::fs::canonicalize(&override_bin).unwrap().to_string_lossy().as_ref()),
            "Explicit SHADOW_CREW_DEV_MCP_PATH override must resolve before workspace fallbacks"
        );

        let fallback = resolve_dev_mcp_binary_path_with_overrides(
            "/nonexistent-cwd",
            "/nonexistent-host",
            &[Some("/nonexistent/override/binary"), None],
        );
        if let Some(workspace_root) = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).parent() {
            let target_debug = workspace_root.join("target/debug/shadow-crew-dev-mcp");
            if target_debug.is_file() {
                assert_eq!(
                    fallback.as_deref(),
                    Some(std::fs::canonicalize(&target_debug).unwrap().to_string_lossy().as_ref()),
                    "Missing override should fall back to CARGO_MANIFEST_DIR workspace binary"
                );
            }
        }

        let _ = std::fs::remove_dir_all(&temp_dir);
    }


    #[test]
    fn test_upsert_tracked_tool_call_claude_and_codex() {
        use super::{upsert_tracked_tool_call, TrackedMcpToolCall};

        let mut list: Vec<TrackedMcpToolCall> = Vec::new();

        // 1. Claude Code ACP: initial tool_call has empty rawInput
        upsert_tracked_tool_call(
            &mut list,
            &serde_json::json!({
                "_meta": { "claudeCode": { "toolName": "mcp__shadow-crew-dev-mcp__submit_arbitration_ruling" } },
                "toolCallId": "call_claude_1",
                "sessionUpdate": "tool_call",
                "rawInput": {},
                "status": "pending",
                "title": "submit_arbitration_ruling"
            }),
        );
        // 2. Claude Code ACP: update provides real rawInput
        upsert_tracked_tool_call(
            &mut list,
            &serde_json::json!({
                "_meta": { "claudeCode": { "toolName": "mcp__shadow-crew-dev-mcp__submit_arbitration_ruling" } },
                "toolCallId": "call_claude_1",
                "sessionUpdate": "tool_call_update",
                "rawInput": {
                    "decision_type": "trade_off_matrix",
                    "summary": "Balanced ruling",
                    "trade_off_points": ["Safety over latency"],
                    "impacted_files": ["src-tauri/src/acp_manager.rs"]
                }
            }),
        );
        // 3. Claude Code ACP: completion update omits rawInput
        upsert_tracked_tool_call(
            &mut list,
            &serde_json::json!({
                "_meta": { "claudeCode": { "toolName": "mcp__shadow-crew-dev-mcp__submit_arbitration_ruling" } },
                "toolCallId": "call_claude_1",
                "sessionUpdate": "tool_call_update",
                "status": "completed",
                "rawOutput": "✓ 【仲裁定案裁决书】已成功提交"
            }),
        );

        assert_eq!(list.len(), 1);
        assert_eq!(list[0].server_name, "shadow-crew-dev-mcp");
        assert_eq!(list[0].tool_name, "submit_arbitration_ruling");
        assert_eq!(list[0].status, "completed");
        assert_eq!(list[0].arguments["decision_type"], "trade_off_matrix");
        assert!(list[0].raw_output.is_some());

        // 4. Codex ACP format with error in rawOutput
        upsert_tracked_tool_call(
            &mut list,
            &serde_json::json!({
                "toolCallId": "call_codex_1",
                "sessionUpdate": "tool_call",
                "title": "mcp.shadow-crew-dev-mcp.submit_role_concurrence",
                "status": "in_progress",
                "rawInput": {
                    "server": "shadow-crew-dev-mcp",
                    "tool": "submit_role_concurrence",
                    "arguments": {
                        "protocol_version": 1,
                        "status": "concurred"
                    }
                }
            }),
        );
        upsert_tracked_tool_call(
            &mut list,
            &serde_json::json!({
                "toolCallId": "call_codex_1",
                "sessionUpdate": "tool_call_update",
                "status": "completed",
                "rawOutput": {
                    "result": { "content": [{"type": "text", "text": "invalid digest"}], "isError": true },
                    "error": null
                }
            }),
        );
        assert_eq!(list.len(), 2);
        assert_eq!(list[1].server_name, "shadow-crew-dev-mcp");
        assert_eq!(list[1].tool_name, "submit_role_concurrence");
        assert_eq!(list[1].arguments["status"], "concurred");
        assert_eq!(list[1].status, "failed");

        // 5. Builtin non-MCP tool (Bash) should have empty server_name so it gets excluded from mcp_tool_calls
        upsert_tracked_tool_call(
            &mut list,
            &serde_json::json!({
                "_meta": { "claudeCode": { "toolName": "Bash" } },
                "toolCallId": "call_bash_1",
                "sessionUpdate": "tool_call",
                "rawInput": { "command": "ls" },
                "status": "completed"
            }),
        );
        assert_eq!(list.len(), 3);
        assert_eq!(list[2].server_name, "");
        assert_eq!(list[2].tool_name, "Bash");
    }


    #[test]
    fn test_is_auto_approved_governance_tool() {
        use super::is_auto_approved_governance_tool;

        let claude_ruling = serde_json::json!({
            "sessionId": "s1",
            "toolCall": {
                "_meta": { "claudeCode": { "toolName": "mcp__shadow-crew-dev-mcp__submit_arbitration_ruling" } },
                "title": "submit_arbitration_ruling"
            }
        });
        assert!(is_auto_approved_governance_tool(&claude_ruling));

        let codex_concurrence = serde_json::json!({
            "sessionId": "s2",
            "subject": {
                "type": "tool_call",
                "toolCall": {
                    "title": "mcp.shadow-crew-dev-mcp.submit_role_concurrence",
                    "rawInput": {
                        "server": "shadow-crew-dev-mcp",
                        "tool": "submit_role_concurrence",
                        "arguments": {}
                    }
                }
            }
        });
        assert!(is_auto_approved_governance_tool(&codex_concurrence));

        let bash_tool = serde_json::json!({
            "sessionId": "s1",
            "toolCall": {
                "_meta": { "claudeCode": { "toolName": "Bash" } },
                "name": "Bash"
            }
        });
        assert!(!is_auto_approved_governance_tool(&bash_tool));

        let write_tool = serde_json::json!({
            "sessionId": "s1",
            "toolCall": {
                "_meta": { "claudeCode": { "toolName": "mcp__shadow-crew-dev-mcp__write_file" } },
                "name": "write_file"
            }
        });
        assert!(!is_auto_approved_governance_tool(&write_tool));
    }

}
