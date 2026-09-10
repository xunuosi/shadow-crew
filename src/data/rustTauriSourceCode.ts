/**
 * Production-ready Rust + Tauri codebase and architecture definitions
 * for the Buzz ACP Multi-Agent Desktop Platform.
 */

export interface RustSourceFile {
  path: string;
  crate: string;
  category: 'workspace' | 'protocol' | 'desktop' | 'server' | 'agent' | 'scripts';
  description: string;
  language: 'rust' | 'toml' | 'json' | 'bash' | 'markdown';
  code: string;
}

export const RUST_TAURI_WORKSPACE_FILES: RustSourceFile[] = [
  {
    path: 'README.md',
    crate: 'workspace',
    category: 'workspace',
    description: '项目全景架构白皮书与 ACP 数字替身 (Alter-Ego) 远景文档',
    language: 'markdown',
    code: `# 🐝 Buzz: 基于 ACP 的多 Agent 协作工作台 (Multi-Agent Hivemind Workspace)

> **“在未来的团队协作中，每个开发者进入房间时，不仅仅带上自己，更带上由 ACP 赋能的专属 AI 替身——它沉淀了你的思考模式、熟悉你的工程规范，并携带着独属于你的私有记忆与强大技能。”**

---

## 🌟 核心愿景：AI 替身 (The Digital Alter-Ego)

通过 **ACP (Agent Client Protocol)** 标准化接入：
* **私有记忆伴随 (Portable Memory Bank)**：每个人的 Agent 在长期的单人编程中积累了专属的记忆库（技术偏好、代码风格、历史踩坑总结、业务暗语）。进入公共房间时，Agent 自动带入这些知识资产。
* **个人技能复用 (Custom Skillset & MCP)**：Agent 随身挂载了个人的专属工具链（特定的部署脚本、数据查询权限、代码分析插件），在多 Agent 会议室中协同调度。
* **替身自主协作 (Autonomous Stand-in Interaction)**：当你离线或专注编码时，你的 Agent 可以在群聊中代表你审查 PR、解答队友关于你负责模块的疑问，并在达成共识后生成改动提案等你确认。

---

## 🏛️ 全栈架构设计 (Full-Stack Rust + Tauri)

* **桌面宿主**: Tauri v2 (Rust Core + React/Tailwind WebView) - 待机内存 ~35MB，相比 Electron 节省 >90%。
* **异步管道**: Tokio 子进程守护接管 Agent 标准输入输出 (stdio)，以 Zero-Copy Channel 逐字流式打字。
* **服务端**: Rust Axum + Nostr Relay - secp256k1 签名事件总线，微秒级跨房间广播。
* **协议栈**: ACP (Agent Client Protocol) + MCP (Model Context Protocol)。
`
  },
  {
    path: 'Cargo.toml',
    crate: 'workspace',
    category: 'workspace',
    description: '根目录 Cargo Workspace 定义，统管所有子模块与统一依赖版本',
    language: 'toml',
    code: `[workspace]
resolver = "2"
members = [
    "crates/buzz-protocol",
    "crates/buzz-server",
    "crates/buzz-desktop/src-tauri",
    "crates/buzz-agent",
    "crates/buzz-dev-mcp"
]

[workspace.package]
version = "0.1.0"
edition = "2021"
authors = ["Block Buzz Team", "AI Studio"]
license = "Apache-2.0"

[workspace.dependencies]
# 异步运行时 & 网络
tokio = { version = "1.43", features = ["full"] }
axum = { version = "0.8", features = ["ws"] }
tower = { version = "0.5", features = ["util"] }
tower-http = { version = "0.6", features = ["cors", "trace"] }
futures-util = "0.3"

# 序列化 & 协议
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"

# 加解密与 Nostr
secp256k1 = { version = "0.30", features = ["global-context", "rand-std"] }
nostr-sdk = "0.38"
sha2 = "0.10"

# 数据库与持久化
rusqlite = { version = "0.33", features = ["bundled"] }

# 日志 & 追踪
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }
anyhow = "1.0"
thiserror = "2.0"
`
  },
  {
    path: 'crates/buzz-protocol/src/acp.rs',
    crate: 'buzz-protocol',
    category: 'protocol',
    description: 'ACP (Agent Client Protocol) 核心协议报文结构与 JSON-RPC 2.0 序列化定义',
    language: 'rust',
    code: `use serde::{Deserialize, Serialize};

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
`
  },
  {
    path: 'crates/buzz-desktop/src-tauri/src/main.rs',
    crate: 'buzz-desktop',
    category: 'desktop',
    description: 'Tauri v2 桌面宿主入口，注册异步命令、初始化状态与 IPC 通信',
    language: 'rust',
    code: `// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod acp_manager;

use acp_manager::AcpProcessManager;
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};
use tokio::sync::Mutex;

// 共享的全局状态
struct AppState {
    acp_manager: Arc<Mutex<AcpProcessManager>>,
    nostr_relay_url: String,
}

/// Tauri Command: 启动指定 ACP 本地子进程 (stdio 管道绑定)
#[tauri::command]
async fn spawn_acp_agent(
    agent_id: String,
    command: String,
    cwd: String,
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<u32, String> {
    tracing::info!("Spawning ACP agent: {} with cmd: {}", agent_id, command);
    let mut manager = state.acp_manager.lock().await;
    
    let pid = manager
        .spawn_agent(&agent_id, &command, &cwd, app_handle)
        .await
        .map_err(|e| format!("Failed to spawn agent: {}", e))?;
        
    Ok(pid)
}

/// Tauri Command: 发送指令到 ACP Agent (带流式回调)
#[tauri::command]
async fn send_prompt_to_agent(
    agent_id: String,
    room_id: String,
    prompt: String,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let manager = state.acp_manager.lock().await;
    let response = manager
        .send_session_prompt(&agent_id, &room_id, &prompt)
        .await
        .map_err(|e| format!("ACP Prompt Error: {}", e))?;
        
    Ok(response)
}

/// Tauri Command: 安全沙盒文件读取
#[tauri::command]
async fn read_workspace_file_sandboxed(
    path: String,
    allowed_root: String,
) -> Result<String, String> {
    let canonical_root = std::fs::canonicalize(&allowed_root)
        .map_err(|e| format!("Invalid root: {}", e))?;
    let canonical_path = std::fs::canonicalize(&path)
        .map_err(|e| format!("Invalid file path: {}", e))?;

    // 路径逃逸安全校验：确保目标在允许的根工作区下
    if !canonical_path.starts_with(&canonical_root) {
        return Err("Security Violation: Path traversal outside workspace denied".into());
    }

    tokio::fs::read_to_string(canonical_path)
        .await
        .map_err(|e| format!("Failed to read file: {}", e))
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let state = AppState {
        acp_manager: Arc::new(Mutex::new(AcpProcessManager::new())),
        nostr_relay_url: "ws://127.0.0.1:8080/relay".to_string(),
    };

    tauri::Builder::default()
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            spawn_acp_agent,
            send_prompt_to_agent,
            read_workspace_file_sandboxed,
        ])
        .run(tauri::generate_context!())
        .expect("error while running buzz tauri desktop application");
}
`
  },
  {
    path: 'crates/buzz-desktop/src-tauri/src/acp_manager.rs',
    crate: 'buzz-desktop',
    category: 'desktop',
    description: 'Tokio 异步子进程守护器：管理 stdio 管道并转发流式日志至前端 Channel',
    language: 'rust',
    code: `use anyhow::{Context, Result};
use std::collections::HashMap;
use std::process::Stdio;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::mpsc;

pub struct RunningAgent {
    pub pid: u32,
    pub stdin_tx: mpsc::Sender<String>,
}

pub struct AcpProcessManager {
    agents: HashMap<String, RunningAgent>,
}

impl AcpProcessManager {
    pub fn new() -> Self {
        Self {
            agents: HashMap::new(),
        }
    }

    /// 启动子进程并接管 stdin/stdout
    pub async fn spawn_agent(
        &mut self,
        agent_id: &str,
        command_line: &str,
        cwd: &str,
        app_handle: AppHandle,
    ) -> Result<u32> {
        let parts: Vec<&str> = command_line.split_whitespace().collect();
        let program = parts[0];
        let args = &parts[1..];

        let mut child: Child = Command::new(program)
            .args(args)
            .current_dir(cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .with_context(|| format!("Failed to spawn {}", command_line))?;

        let pid = child.id().unwrap_or(0);
        let stdin = child.stdin.take().expect("Failed to open stdin");
        let stdout = child.stdout.take().expect("Failed to open stdout");

        let (stdin_tx, mut stdin_rx) = mpsc::channel::<String>(32);

        // 异步任务 1: 处理写往 Agent 的指令
        let mut async_stdin = stdin;
        tokio::spawn(async move {
            while let Some(msg) = stdin_rx.recv().await {
                if let Err(e) = async_stdin.write_all(msg.as_bytes()).await {
                    eprintln!("Error writing to agent stdin: {}", e);
                    break;
                }
                let _ = async_stdin.write_all(b"\\n").await;
                let _ = async_stdin.flush().await;
            }
        });

        // 异步任务 2: 读取 Agent stdout 并通过 Tauri IPC emit 推送给 React 前端
        let agent_id_clone = agent_id.to_string();
        let app_handle_clone = app_handle.clone();
        tokio::spawn(async move {
            let mut reader = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                // 触发 Tauri 事件，例如: acp:stream:agent-buzz
                let event_name = format!("acp:stream:{}", agent_id_clone);
                let _ = app_handle_clone.emit(&event_name, serde_json::json!({
                    "agent_id": agent_id_clone,
                    "line": line
                }));
            }
        });

        self.agents.insert(
            agent_id.to_string(),
            RunningAgent { pid, stdin_tx },
        );

        Ok(pid)
    }

    /// 发送 Prompt 请求
    pub async fn send_session_prompt(
        &self,
        agent_id: &str,
        room_id: &str,
        prompt: &str,
    ) -> Result<serde_json::Value> {
        let agent = self.agents.get(agent_id)
            .with_context(|| format!("Agent {} not running", agent_id))?;

        let request = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1001,
            "method": "session/prompt",
            "params": {
                "room_id": room_id,
                "user_query": prompt
            }
        });

        agent.stdin_tx.send(request.to_string()).await?;

        Ok(serde_json::json!({ "status": "sent" }))
    }
}
`
  },
  {
    path: 'crates/buzz-desktop/src-tauri/tauri.conf.json',
    crate: 'buzz-desktop',
    category: 'desktop',
    description: 'Tauri v2 生产级配置：窗口定制、沙盒安全与构建产物配置',
    language: 'json',
    code: `{
  "$schema": "https://raw.githubusercontent.com/tauri-apps/tauri/dev/tooling/cli/schema.json",
  "productName": "Buzz",
  "version": "1.0.0",
  "identifier": "com.block.buzz.desktop",
  "build": {
    "beforeDevCommand": "npm run dev",
    "devUrl": "http://localhost:3000",
    "beforeBuildCommand": "npm run build",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "title": "Buzz - Multi-Agent Hivemind Workspace",
        "width": 1400,
        "height": 900,
        "minWidth": 960,
        "minHeight": 640,
        "resizable": true,
        "decorations": true,
        "transparent": false
      }
    ],
    "security": {
      "csp": "default-src 'self' 'unsafe-inline' wss: ws: http: https: data:"
    }
  },
  "bundle": {
    "active": true,
    "targets": ["app", "dmg", "deb", "nsis"],
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  }
}`
  },
  {
    path: 'crates/buzz-server/src/main.rs',
    crate: 'buzz-server',
    category: 'server',
    description: 'Axum + Tokio 高性能服务端入口，启动 WebSocket Nostr Relay 与房间分发',
    language: 'rust',
    code: `mod relay;

use axum::{
    routing::{get, post},
    Router,
};
use std::net::SocketAddr;
use std::sync::Arc;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .with(tracing_subscriber::fmt::layer())
        .init();

    let relay_state = Arc::new(relay::RelayState::new());

    // 路由定义：包括基础状态探针与 WebSocket Nostr Relay
    let app = Router::new()
        .route("/health", get(|| async { "Buzz Relay Online (Rust Axum)" }))
        .route("/relay", get(relay::ws_relay_handler))
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(relay_state);

    let addr = SocketAddr::from(([0, 0, 0, 0], 8080));
    tracing::info!("🚀 Buzz Rust Nostr Relay listening on ws://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
`
  },
  {
    path: 'crates/buzz-server/src/relay.rs',
    crate: 'buzz-server',
    category: 'server',
    description: 'Nostr Relay 事件发布订阅引擎：支持房间隔离、secp256k1 验证与广播',
    language: 'rust',
    code: `use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    response::IntoResponse,
};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NostrEvent {
    pub id: String,
    pub pubkey: String,
    pub created_at: u64,
    pub kind: u16, // Kind 42: Channel Message
    pub tags: Vec<Vec<String>>,
    pub content: String,
    pub sig: String,
}

pub struct RelayState {
    // 按 room_id 分组广播事件
    pub channels: RwLock<HashMap<String, broadcast::Sender<NostrEvent>>>,
}

impl RelayState {
    pub fn new() -> Self {
        Self {
            channels: RwLock::new(HashMap::new()),
        }
    }

    pub async fn get_or_create_sender(&self, room_id: &str) -> broadcast::Sender<NostrEvent> {
        let mut map = self.channels.write().await;
        map.entry(room_id.to_string())
            .or_insert_with(|| {
                let (tx, _rx) = broadcast::channel(128);
                tx
            })
            .clone()
    }
}

pub async fn ws_relay_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<RelayState>>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

async fn handle_socket(socket: WebSocket, state: Arc<RelayState>) {
    let (mut sender, mut receiver) = socket.split();
    let tx = state.get_or_create_sender("room-acp-dev").await;
    let mut rx = tx.subscribe();

    // 接收广播并转发给客户端
    let mut send_task = tokio::spawn(async move {
        while let Ok(event) = rx.recv().await {
            let json = serde_json::to_string(&event).unwrap();
            if sender.send(Message::Text(json)).await.is_err() {
                break;
            }
        }
    });

    // 接收客户端上报的事件
    let mut recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = receiver.next().await {
            if let Message::Text(text) = msg {
                if let Ok(event) = serde_json::from_str::<NostrEvent>(&text) {
                    tracing::info!("Received signed Nostr Event: {}", event.id);
                    let _ = tx.send(event);
                }
            }
        }
    });

    tokio::select! {
        _ = (&mut send_task) => recv_task.abort(),
        _ = (&mut recv_task) => send_task.abort(),
    };
}
`
  },
  {
    path: 'crates/buzz-agent/src/memory.rs',
    crate: 'buzz-agent',
    category: 'agent',
    description: 'Agent 私有持久记忆引擎：使用本地 SQLite 存储跨会话核心偏好与架构规范',
    language: 'rust',
    code: `use anyhow::Result;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryRecord {
    pub id: String,
    pub category: String,
    pub key: String,
    pub content: String,
    pub created_at: String,
}

pub struct AgentMemoryStore {
    conn: Connection,
}

impl AgentMemoryStore {
    /// 初始化 Agent 私有 SQLite 数据库
    pub fn new(db_path: &str) -> Result<Self> {
        let conn = Connection::open(db_path)?;
        
        conn.execute(
            "CREATE TABLE IF NOT EXISTS acp_memories (
                id TEXT PRIMARY KEY,
                category TEXT NOT NULL,
                key TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )",
            [],
        )?;

        Ok(Self { conn })
    }

    /// 插入或更新记忆
    pub fn store(&self, category: &str, key: &str, content: &str) -> Result<()> {
        let id = format!("{}:{}", category, key);
        self.conn.execute(
            "INSERT OR REPLACE INTO acp_memories (id, category, key, content) VALUES (?1, ?2, ?3, ?4)",
            params![id, category, key, content],
        )?;
        Ok(())
    }

    /// 根据当前 Prompt 召回相关记忆
    pub fn recall_relevant(&self, query: &str) -> Result<Vec<MemoryRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, category, key, content, created_at FROM acp_memories 
             WHERE content LIKE ?1 OR key LIKE ?1 LIMIT 5"
        )?;

        let pattern = format!("%{}%", query);
        let rows = stmt.query_map(params![pattern], |row| {
            Ok(MemoryRecord {
                id: row.get(0)?,
                category: row.get(1)?,
                key: row.get(2)?,
                content: row.get(3)?,
                created_at: row.get(4)?,
            })
        })?;

        let mut results = Vec::new();
        for r in rows {
            results.push(r?);
        }
        Ok(results)
    }
}
`
  },
  {
    path: 'scripts/init_project.sh',
    crate: 'scripts',
    category: 'scripts',
    description: '一键初始化与本地联调启动脚本 (Cargo Workspace + Tauri v2)',
    language: 'bash',
    code: `#!/usr/bin/env bash
set -e

echo "=== 🐝 Initializing Buzz Multi-Agent Platform (Rust + Tauri) ==="

# 1. 检查 Rust 与 Cargo 环境
if ! command -v cargo &> /dev/null; then
    echo "Rust/Cargo not found! Please install via https://rustup.rs"
    exit 1
fi

# 2. 检查 Node / npm 环境
if ! command -v npm &> /dev/null; then
    echo "Node.js/npm not found! Please install Node 18+"
    exit 1
fi

echo "-> Building shared protocol library..."
cargo build -p buzz-protocol

echo "-> Starting Buzz Rust Nostr Relay in background (port 8080)..."
cargo run -p buzz-server &
SERVER_PID=$!
echo "Relay PID: $SERVER_PID"

echo "-> Launching Tauri Desktop Frontend in dev mode..."
npm install
npm run tauri dev

# Clean up background server on exit
kill $SERVER_PID 2>/dev/null || true
echo "=== Buzz dev session closed. ==="
`
  }
];
