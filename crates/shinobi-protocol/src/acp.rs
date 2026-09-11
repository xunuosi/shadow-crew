use serde::{Deserialize, Serialize};

/// 标准 JSON-RPC 2.0 基础信封
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcRequest<T> {
    pub jsonrpc: String,
    pub id: u64,
    pub method: String,
    pub params: T,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcResponse<T> {
    pub jsonrpc: String,
    pub id: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<T>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<JsonRpcError>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcError {
    pub code: i64,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
}

/// 客户端初始化参数 (ACP initialize)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcpInitializeParams {
    pub protocol_version: String,
    pub client_info: ClientInfo,
    pub workspace_root: String,
    pub capabilities: ClientCapabilities,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientInfo {
    pub name: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientCapabilities {
    pub can_apply_edits: bool,
    pub supports_memory_bank: bool,
    pub supports_mcp_routing: bool,
}

/// 团队房间 Prompt 请求 (ACP session/prompt)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcpSessionPromptParams {
    pub session_id: String,
    pub room_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channel_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub topic_head_id: Option<String>,
    pub user_query: String,
    pub conversation_history: Vec<ConversationMessage>,
    pub workspace_cwd: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationMessage {
    pub author_handle: String,
    pub content: String,
    pub signed_nostr_hash: String,
}

/// Agent 执行返回中的 Trace 结构 (汇报 Memory / Workspace / Skill 调用)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcpPromptResult {
    pub text_response: String,
    pub memory_actions: Vec<MemoryTrace>,
    pub workspace_diffs: Vec<WorkspaceDiffTrace>,
    pub mcp_tool_calls: Vec<McpCallTrace>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryTrace {
    pub action: String, // "recall" | "store"
    pub key: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceDiffTrace {
    pub file_path: String,
    pub diff_content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpCallTrace {
    pub server_name: String,
    pub tool_name: String,
    pub status: String,
}
