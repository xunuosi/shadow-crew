use anyhow::Result;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AcpPermissionOptionView {
    pub option_id: String,
    pub name: String,
    pub kind: String,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpPermissionRequestView {
    pub request_id: String,
    pub agent_id: String,
    pub session_id: String,
    pub session_key: String,
    pub scope_type: String,
    pub scope_id: String,
    pub workspace_binding_id: String,
    pub cwd: String,
    pub capability: String,
    pub tool_name: String,
    pub tool_title: String,
    pub tool_kind: String,
    pub command: Option<String>,
    pub paths: Vec<String>,
    pub outside_workspace_paths: Vec<String>,
    pub description: Option<String>,
    pub supports_allow_once: bool,
    pub supports_reject: bool,
    pub options: Vec<AcpPermissionOptionView>,
    pub created_at: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PermissionScopeContext {
    pub scope_type: String,
    pub scope_id: String,
    pub workspace_binding_id: String,
    pub session_key: String,
    pub cwd: String,
}

#[derive(Debug, Clone, Hash, PartialEq, Eq)]
pub struct PermissionGrantKey {
    pub scope_type: String,
    pub scope_id: String,
    pub workspace_binding_id: String,
    pub capability: String,
}

#[derive(Debug, Clone, Hash, PartialEq, Eq)]
pub struct SessionPermissionGrantKey {
    pub session_id: String,
    pub grant: PermissionGrantKey,
}

#[derive(Debug, Clone)]
pub struct PendingAcpPermission {
    pub rpc_id: serde_json::Value,
    pub view: AcpPermissionRequestView,
    pub options: Vec<AcpPermissionOptionView>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AcpPermissionDecision {
    Deny,
    AllowOnce,
    AllowSession,
    AllowScope,
}


impl AcpPermissionDecision {
    pub fn parse(raw: &str) -> Result<Self> {
        match raw.trim() {
            "deny" => Ok(Self::Deny),
            "allow_once" => Ok(Self::AllowOnce),
            "allow_session" => Ok(Self::AllowSession),
            "allow_scope" => Ok(Self::AllowScope),
            other => anyhow::bail!("Unsupported ACP permission decision: {}", other),
        }
    }

    pub(crate) fn is_allow(self) -> bool {
        !matches!(self, Self::Deny)
    }
}

pub(crate) fn classify_permission_capability(tool_call: &serde_json::Value) -> String {
    let kind = tool_call
        .get("kind")
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    let name = tool_call
        .get("name")
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();

    match kind.as_str() {
        "read" | "search" => "fs.read",
        "edit" | "write" => "fs.write",
        "delete" | "move" => "fs.delete",
        "execute" => "shell.execute",
        "fetch" => "network.access",
        _ if name.contains("write")
            || name.contains("edit")
            || name.contains("replace")
            || name.contains("patch") =>
        {
            "fs.write"
        }
        _ if name.contains("delete")
            || name.contains("remove")
            || name.contains("unlink") =>
        {
            "fs.delete"
        }
        _ if name.contains("read")
            || name.contains("grep")
            || name.contains("search")
            || name.contains("glob")
            || name.contains("list") =>
        {
            "fs.read"
        }
        _ if name.contains("bash")
            || name.contains("shell")
            || name.contains("terminal")
            || name.contains("execute") =>
        {
            "shell.execute"
        }
        _ if name.contains("fetch")
            || name.contains("http")
            || name.contains("browser")
            || name.contains("web") =>
        {
            "network.access"
        }
        _ => "other",
    }
    .to_string()
}

pub(crate) fn permission_path_candidates(tool_call: &serde_json::Value) -> Vec<String> {
    let mut candidates = Vec::new();
    if let Some(locations) = tool_call.get("locations").and_then(|value| value.as_array()) {
        for location in locations {
            if let Some(path) = location.get("path").and_then(|value| value.as_str()) {
                if !path.trim().is_empty() {
                    candidates.push(path.trim().to_string());
                }
            }
        }
    }

    if let Some(raw_input) = tool_call.get("rawInput").and_then(|value| value.as_object()) {
        for key in [
            "file_path",
            "filePath",
            "path",
            "target_file",
            "targetFile",
            "target_path",
            "targetPath",
            "directory",
            "dir",
            "notebook_path",
            "notebookPath",
            "cwd",
            "workdir",
        ] {
            if let Some(path) = raw_input.get(key).and_then(|value| value.as_str()) {
                if !path.trim().is_empty() {
                    candidates.push(path.trim().to_string());
                }
            }
        }
    }

    let mut seen = HashSet::new();
    candidates
        .into_iter()
        .filter(|path| seen.insert(path.clone()))
        .collect()
}

pub(crate) fn expand_permission_path(raw: &str, cwd: &Path) -> PathBuf {
    let trimmed = raw.trim();
    let expanded = crate::db_manager::expand_tilde_path(trimmed)
        .unwrap_or_else(|_| PathBuf::from(trimmed));

    if expanded.is_absolute() {
        expanded
    } else {
        cwd.join(expanded)
    }
}

pub(crate) fn normalize_lexical_path(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            std::path::Component::Prefix(prefix) => normalized.push(prefix.as_os_str()),
            std::path::Component::RootDir => normalized.push(component.as_os_str()),
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                normalized.pop();
            }
            std::path::Component::Normal(value) => normalized.push(value),
        }
    }
    normalized
}

pub(crate) fn resolve_permission_path(path: &Path) -> PathBuf {
    if let Ok(canonical) = crate::db_manager::canonicalize_clean_path(path) {
        return canonical;
    }
    if let (Some(parent), Some(name)) = (path.parent(), path.file_name()) {
        if let Ok(canonical_parent) = crate::db_manager::canonicalize_clean_path(parent) {
            return canonical_parent.join(name);
        }
    }
    normalize_lexical_path(path)
}

pub(crate) fn partition_permission_paths(
    paths: &[String],
    cwd: &Path,
) -> (Vec<String>, Vec<String>) {
    let canonical_cwd = crate::db_manager::canonicalize_clean_path(cwd)
        .unwrap_or_else(|_| cwd.to_path_buf());
    let mut inside = Vec::new();
    let mut outside = Vec::new();
    for raw in paths {
        let resolved = resolve_permission_path(&expand_permission_path(raw, &canonical_cwd));
        let display = resolved.to_string_lossy().to_string();
        if resolved.starts_with(&canonical_cwd) {
            inside.push(display);
        } else {
            outside.push(display);
        }
    }
    (inside, outside)
}

pub(crate) fn parse_permission_options(params: &serde_json::Value) -> Vec<AcpPermissionOptionView> {
    params
        .get("options")
        .and_then(|value| value.as_array())
        .map(|options| {
            options
                .iter()
                .filter_map(|option| {
                    let option_id = option
                        .get("optionId")
                        .and_then(|value| value.as_str())
                        .filter(|value| !value.trim().is_empty())?
                        .to_string();
                    Some(AcpPermissionOptionView {
                        option_id,
                        name: option
                            .get("name")
                            .and_then(|value| value.as_str())
                            .unwrap_or_default()
                            .to_string(),
                        kind: option
                            .get("kind")
                            .and_then(|value| value.as_str())
                            .unwrap_or_default()
                            .to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

pub(crate) fn select_permission_option(
    options: &[AcpPermissionOptionView],
    decision: AcpPermissionDecision,
) -> Option<String> {
    if decision.is_allow() {
        return options
            .iter()
            .find(|option| option.kind == "allow_once")
            .or_else(|| {
                options.iter().find(|option| {
                    let option_id = option.option_id.to_ascii_lowercase();
                    option_id == "allow-once" || option_id == "allow_once"
                })
            })
            .map(|option| option.option_id.clone());
    }

    options
        .iter()
        .find(|option| option.kind == "reject_once")
        .or_else(|| {
            options.iter().find(|option| {
                option.kind.starts_with("reject")
                    || option.option_id.to_ascii_lowercase().contains("reject")
            })
        })
        .map(|option| option.option_id.clone())
}

pub(crate) fn permission_selected_response(
    rpc_id: serde_json::Value,
    option_id: &str,
) -> serde_json::Value {
    serde_json::json!({
        "jsonrpc": "2.0",
        "id": rpc_id,
        "result": {
            "outcome": {
                "outcome": "selected",
                "optionId": option_id
            }
        }
    })
}

pub(crate) fn permission_cancelled_response(rpc_id: serde_json::Value) -> serde_json::Value {
    serde_json::json!({
        "jsonrpc": "2.0",
        "id": rpc_id,
        "result": {
            "outcome": {
                "outcome": "cancelled"
            }
        }
    })
}

pub(crate) fn build_permission_grant_id(
    agent_id: &str,
    scope: &PermissionScopeContext,
    capability: &str,
) -> String {
    format!(
        "acp-grant:{}:{}:{}:{}:{}",
        agent_id, scope.scope_type, scope.scope_id, scope.workspace_binding_id, capability
    )
}

pub(crate) fn build_permission_request_view(
    agent_id: &str,
    request_id: String,
    session_id: String,
    scope: PermissionScopeContext,
    params: &serde_json::Value,
    options: Vec<AcpPermissionOptionView>,
) -> AcpPermissionRequestView {
    let tool_call = params
        .get("toolCall")
        .or_else(|| {
            params
                .get("subject")
                .and_then(|subject| subject.get("toolCall"))
        })
        .cloned()
        .unwrap_or_else(|| {
            if let Some(subject) = params.get("subject") {
                if subject.get("type").and_then(|t| t.as_str()) == Some("command") {
                    let cmd = subject.get("command").cloned().unwrap_or(serde_json::Value::Null);
                    return serde_json::json!({
                        "kind": "execute",
                        "rawInput": {
                            "command": cmd,
                            "cwd": subject.get("cwd").cloned().unwrap_or(serde_json::Value::Null)
                        }
                    });
                }
            }
            serde_json::json!({})
        });
    let capability = classify_permission_capability(&tool_call);
    let raw_paths = permission_path_candidates(&tool_call);
    let (paths, outside_workspace_paths) =
        partition_permission_paths(&raw_paths, Path::new(&scope.cwd));
    let command = tool_call
        .get("rawInput")
        .and_then(|value| value.get("command"))
        .and_then(|value| value.as_str())
        .or_else(|| {
            params
                .get("subject")
                .and_then(|subject| subject.get("command"))
                .and_then(|value| value.as_str())
        })
        .map(|value| value.to_string());
    let description = params
        .get("description")
        .and_then(|value| value.as_str())
        .or_else(|| {
            params
                .get("_meta")
                .and_then(|value| value.get("permission"))
                .and_then(|value| value.get("description"))
                .and_then(|value| value.as_str())
        })
        .map(|value| value.to_string());
    let supports_allow_once = options
        .iter()
        .any(|option| option.kind == "allow_once");
    let supports_reject = options.iter().any(|option| {
        option.kind.starts_with("reject")
            || option.option_id.to_ascii_lowercase().contains("reject")
    });

    AcpPermissionRequestView {
        request_id,
        agent_id: agent_id.to_string(),
        session_id,
        session_key: scope.session_key,
        scope_type: scope.scope_type,
        scope_id: scope.scope_id,
        workspace_binding_id: scope.workspace_binding_id,
        cwd: scope.cwd,
        capability,
        tool_name: tool_call
            .get("name")
            .and_then(|value| value.as_str())
            .unwrap_or("unknown")
            .to_string(),
        tool_title: tool_call
            .get("title")
            .and_then(|value| value.as_str())
            .or_else(|| params.get("title").and_then(|value| value.as_str()))
            .unwrap_or_default()
            .to_string(),
        tool_kind: tool_call
            .get("kind")
            .and_then(|value| value.as_str())
            .unwrap_or("other")
            .to_string(),
        command,
        paths,
        outside_workspace_paths,
        description,
        supports_allow_once,
        supports_reject,
        options,
        created_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64,
    }
}


#[cfg(test)]
mod tests {
    use super::*;
    use super::super::protocol::{
        acp_client_capabilities, check_supports_embedded_context, check_supports_prompt_image,
        jsonrpc_id_key,
    };

    #[test]
    fn permission_capabilities_and_options_fail_closed_without_allow_once() {
        let capabilities = acp_client_capabilities();
        assert_eq!(capabilities["fs"]["readTextFile"], false);
        assert_eq!(capabilities["fs"]["writeTextFile"], false);
        assert_eq!(capabilities["terminal"], false);
        let prompt_capabilities = serde_json::json!({
            "agentCapabilities": {
                "promptCapabilities": {
                    "image": true,
                    "embeddedContext": true
                }
            }
        });
        assert!(check_supports_prompt_image(&prompt_capabilities));
        assert!(check_supports_embedded_context(&prompt_capabilities));
        assert_eq!(
            classify_permission_capability(&serde_json::json!({
                "name": "Read",
                "kind": "read"
            })),
            "fs.read"
        );
        assert_eq!(
            classify_permission_capability(&serde_json::json!({
                "name": "MultiEdit",
                "kind": "edit"
            })),
            "fs.write"
        );
        assert_eq!(
            classify_permission_capability(&serde_json::json!({
                "name": "Bash",
                "kind": "execute"
            })),
            "shell.execute"
        );

        let params = serde_json::json!({
            "options": [
                { "optionId": "allow-always", "name": "Always", "kind": "allow_always" },
                { "optionId": "allow-once", "name": "Once", "kind": "allow_once" },
                { "optionId": "reject", "name": "No", "kind": "reject_once" }
            ]
        });
        let options = parse_permission_options(&params);
        assert_eq!(
            select_permission_option(&options, AcpPermissionDecision::AllowOnce),
            Some("allow-once".to_string())
        );
        assert_eq!(
            select_permission_option(&options, AcpPermissionDecision::Deny),
            Some("reject".to_string())
        );

        let always_only = parse_permission_options(&serde_json::json!({
            "options": [
                { "optionId": "allow-always", "name": "Always", "kind": "allow_always" }
            ]
        }));
        assert_eq!(
            select_permission_option(&always_only, AcpPermissionDecision::AllowOnce),
            None,
            "allow_always must not be silently substituted for one-time approval"
        );
    }


    #[test]
    fn permission_request_detects_paths_outside_workspace_and_preserves_jsonrpc_id() {
        let root = std::env::temp_dir().join(format!(
            "shadow_crew_permission_scope_test_{}",
            std::process::id()
        ));
        let inside = root.join("src/app.ts");
        let outside = std::env::temp_dir().join("shadow_crew_permission_outside.ts");
        std::fs::create_dir_all(inside.parent().unwrap()).unwrap();
        std::fs::write(&inside, "inside").unwrap();
        std::fs::write(&outside, "outside").unwrap();

        let params = serde_json::json!({
            "sessionId": "session-1",
            "toolCall": {
                "name": "Write",
                "title": "Write files",
                "kind": "edit",
                "rawInput": { "file_path": outside.to_string_lossy() },
                "locations": [{ "path": inside.to_string_lossy() }]
            },
            "options": [
                { "optionId": "allow-once", "name": "Once", "kind": "allow_once" },
                { "optionId": "reject", "name": "No", "kind": "reject_once" }
            ],
            "_meta": {
                "permission": {
                    "description": "writes source files"
                }
            }
        });
        let scope = PermissionScopeContext {
            scope_type: "topic".to_string(),
            scope_id: "topic-1".to_string(),
            workspace_binding_id: "ws-topic-1".to_string(),
            session_key: "topic:channel-1:topic-1:standard:ws-ws-topic-1".to_string(),
            cwd: root.to_string_lossy().to_string(),
        };
        let view = build_permission_request_view(
            "agent-1",
            "7".to_string(),
            "session-1".to_string(),
            scope,
            &params,
            parse_permission_options(&params),
        );

        assert_eq!(view.capability, "fs.write");
        assert_eq!(view.paths.len(), 1);
        assert_eq!(view.outside_workspace_paths.len(), 1);
        assert!(view.supports_allow_once);
        assert!(view.supports_reject);
        let serialized_view = serde_json::to_value(&view).unwrap();
        assert_eq!(serialized_view["requestId"], "7");
        assert_eq!(serialized_view["workspaceBindingId"], "ws-topic-1");
        assert_eq!(serialized_view["supportsAllowOnce"], true);
        assert_eq!(
            jsonrpc_id_key(&serde_json::json!("string-id")),
            Some("string-id".to_string())
        );
        assert_eq!(
            permission_selected_response(serde_json::json!(7), "allow-once")["result"]["outcome"]
                ["optionId"],
            "allow-once"
        );
        assert_eq!(
            permission_cancelled_response(serde_json::json!(7))["result"]["outcome"]["outcome"],
            "cancelled"
        );

        let traversal = root.join("missing/../../outside.ts");
        let (_, traversal_outside) = partition_permission_paths(
            &[traversal.to_string_lossy().to_string()],
            &root,
        );
        assert_eq!(
            traversal_outside.len(),
            1,
            "lexical '..' traversal must remain outside the workspace"
        );

        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_file(outside);
    }

}
