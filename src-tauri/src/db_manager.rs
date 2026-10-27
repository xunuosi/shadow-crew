use anyhow::Result;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageStatsDto {
    pub database_path: String,
    pub database_size_bytes: u64,
    pub logs_path: String,
    pub logs_size_bytes: u64,
    pub total_messages_count: usize,
    pub total_memories_count: usize,
    pub safe_cleanable_bytes: u64,
    pub archivable_bytes: u64,
    pub protected_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AcpSessionRecord {
    pub agent_id: String,
    pub session_key: String,
    pub session_id: String,
    pub workspace_cwd: String,
    pub system_prompt: String,
    pub created_at: String,
    pub updated_at: String,
}

pub struct DatabaseManager {
    conn: Mutex<Connection>,
    db_path: String,
}

/// 获取用户级全局 Shadow Crew 根目录 (~/.shadow-crew)
pub fn get_shadow_crew_home_dir() -> std::path::PathBuf {
    let base = std::env::var("SHADOW_CREW_HOME")
        .or_else(|_| std::env::var("SHINOBI_HOME"))
        .ok()
        .map(std::path::PathBuf::from)
        .or_else(|| {
            if cfg!(target_os = "windows") {
                std::env::var("USERPROFILE").ok().map(std::path::PathBuf::from)
            } else {
                std::env::var("HOME").ok().map(std::path::PathBuf::from)
            }
        })
        .unwrap_or_else(|| std::path::PathBuf::from("."));

    if base.ends_with(".shadow-crew") {
        base
    } else {
        base.join(".shadow-crew")
    }
}

pub use get_shadow_crew_home_dir as get_shinobi_home_dir;

/// 获取指定频道的私有工作区目录 (~/.shadow-crew/channels/<channel_id>)
pub fn get_channel_dir(channel_id: &str) -> std::path::PathBuf {
    let clean_id = if channel_id.trim().is_empty() {
        "chan-default"
    } else {
        channel_id.trim()
    };
    let channels_dir = get_shadow_crew_home_dir().join("channels").join(clean_id);
    let _ = std::fs::create_dir_all(&channels_dir);
    let _ = std::fs::create_dir_all(channels_dir.join("artifacts"));
    let _ = std::fs::create_dir_all(channels_dir.join("scratch"));
    channels_dir
}

/// 获取指定 Agent 的独立私有工作区目录 (~/.shadow-crew/agents/<agent_id>)
pub fn get_agent_dir(agent_id: &str) -> std::path::PathBuf {
    let clean_id = if agent_id.trim().is_empty() {
        "agent-default"
    } else {
        agent_id.trim()
    };
    let agents_dir = get_shadow_crew_home_dir().join("agents").join(clean_id);
    let _ = std::fs::create_dir_all(&agents_dir);
    let _ = std::fs::create_dir_all(agents_dir.join("artifacts"));
    let _ = std::fs::create_dir_all(agents_dir.join("scratch"));
    agents_dir
}

/// 解析默认 SQLite 记忆与数据持久化路径 (收敛至 ~/.shadow-crew/global_memory.sqlite)
pub fn get_default_db_path() -> String {
    if let Ok(env_path) = std::env::var("SHADOW_CREW_MEMORY_DB").or_else(|_| std::env::var("SHINOBI_MEMORY_DB")) {
        if !env_path.trim().is_empty() {
            return env_path;
        }
    }

    let home_dir = get_shadow_crew_home_dir();
    let _ = std::fs::create_dir_all(&home_dir);

    let target_db = home_dir.join("global_memory.sqlite");
    target_db.to_string_lossy().to_string()
}

impl DatabaseManager {
    /// 初始化 SQLite 数据库连接并确保必要数据表与索引就绪
    pub fn new(db_path: &str) -> Result<Self> {
        let conn = match Connection::open(db_path) {
            Ok(c) => c,
            Err(e) => {
                tracing::warn!("Failed to open SQLite file at {}, fallback to in-memory: {}", db_path, e);
                Connection::open_in_memory()?
            }
        };

        // 启用 WAL 模式保障并发读写与 5000ms 繁忙等待
        let _ = conn.execute_batch("
            PRAGMA journal_mode = WAL;
            PRAGMA busy_timeout = 5000;

            -- 1. Agent 核心长期记忆表 (不可清理资产)
            CREATE TABLE IF NOT EXISTS acp_memories (
                id TEXT PRIMARY KEY,
                category TEXT NOT NULL,
                key TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            -- 2. 团队与多 Agent 会话历史表 (半持久化，可导出备份)
            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                thread_id TEXT NOT NULL,
                channel_id TEXT,
                project_id TEXT,
                author_id TEXT NOT NULL,
                author_name TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                content TEXT NOT NULL,
                message_json TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id);
            CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id);
            CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);

            -- 3. 核心领域实体表 (工作区与实体状态唯一真值来源)
            CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                data_json TEXT NOT NULL,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS channels (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                name TEXT NOT NULL,
                data_json TEXT NOT NULL,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_channels_project ON channels(project_id);

            CREATE TABLE IF NOT EXISTS threads (
                id TEXT PRIMARY KEY,
                channel_id TEXT NOT NULL,
                title TEXT,
                data_json TEXT NOT NULL,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_threads_channel ON threads(channel_id);

            CREATE TABLE IF NOT EXISTS agents (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                handle TEXT,
                data_json TEXT NOT NULL,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS teams (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                data_json TEXT NOT NULL,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            -- 4. 活跃工作区状态与全局模型配置键值表
            CREATE TABLE IF NOT EXISTS workspace_state (
                key TEXT PRIMARY KEY,
                value_json TEXT NOT NULL,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            -- 5. ACP 会话状态持久化映射表 (跨进程重启与会话接续恢复真值表)
            CREATE TABLE IF NOT EXISTS acp_sessions (
                agent_id TEXT NOT NULL,
                session_key TEXT NOT NULL,
                session_id TEXT NOT NULL,
                workspace_cwd TEXT NOT NULL,
                system_prompt TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (agent_id, session_key)
            );
            CREATE INDEX IF NOT EXISTS idx_acp_sessions_agent ON acp_sessions(agent_id);
        ");

        Ok(Self {
            conn: Mutex::new(conn),
            db_path: db_path.to_string(),
        })
    }

    /// 插入或更新单条消息
    pub fn save_message(&self, val: &serde_json::Value) -> Result<()> {
        let id = val.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
        if id.is_empty() {
            return Err(anyhow::anyhow!("Message id is required"));
        }

        let thread_id = val.get("threadId").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let channel_id = val.get("channelId").and_then(|v| v.as_str()).map(|s| s.to_string());
        let project_id = val.get("projectId").and_then(|v| v.as_str()).map(|s| s.to_string());
        let author_id = val.get("authorId").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let author_name = val.get("authorName").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let timestamp = val.get("timestamp").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let content = val.get("content").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let message_json = serde_json::to_string(val)?;

        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO messages (id, thread_id, channel_id, project_id, author_id, author_name, timestamp, content, message_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(id) DO UPDATE SET
                thread_id = excluded.thread_id,
                channel_id = excluded.channel_id,
                project_id = excluded.project_id,
                author_id = excluded.author_id,
                author_name = excluded.author_name,
                timestamp = excluded.timestamp,
                content = excluded.content,
                message_json = excluded.message_json",
            params![
                id,
                thread_id,
                channel_id,
                project_id,
                author_id,
                author_name,
                timestamp,
                content,
                message_json
            ],
        )?;

        Ok(())
    }

    /// 批量事务写入消息（用于首次启动从 localStorage 平滑迁移）
    pub fn save_messages_batch(&self, messages: &[serde_json::Value]) -> Result<usize> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        let mut count = 0;

        {
            let mut stmt = tx.prepare(
                "INSERT INTO messages (id, thread_id, channel_id, project_id, author_id, author_name, timestamp, content, message_json)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                 ON CONFLICT(id) DO UPDATE SET
                    thread_id = excluded.thread_id,
                    channel_id = excluded.channel_id,
                    project_id = excluded.project_id,
                    author_id = excluded.author_id,
                    author_name = excluded.author_name,
                    timestamp = excluded.timestamp,
                    content = excluded.content,
                    message_json = excluded.message_json"
            )?;

            for val in messages {
                if let Some(id) = val.get("id").and_then(|v| v.as_str()) {
                    if id.is_empty() {
                        continue;
                    }
                    let thread_id = val.get("threadId").and_then(|v| v.as_str()).unwrap_or("");
                    let channel_id = val.get("channelId").and_then(|v| v.as_str());
                    let project_id = val.get("projectId").and_then(|v| v.as_str());
                    let author_id = val.get("authorId").and_then(|v| v.as_str()).unwrap_or("");
                    let author_name = val.get("authorName").and_then(|v| v.as_str()).unwrap_or("");
                    let timestamp = val.get("timestamp").and_then(|v| v.as_str()).unwrap_or("");
                    let content = val.get("content").and_then(|v| v.as_str()).unwrap_or("");
                    let message_json = serde_json::to_string(val)?;

                    let _ = stmt.execute(params![
                        id,
                        thread_id,
                        channel_id,
                        project_id,
                        author_id,
                        author_name,
                        timestamp,
                        content,
                        message_json
                    ]);
                    count += 1;
                }
            }
        }

        tx.commit()?;
        Ok(count)
    }

    /// 查询消息列表（支持按 thread_id 或 channel_id 过滤，支持 limit 与 offset）
    pub fn get_messages(
        &self,
        thread_id: Option<String>,
        channel_id: Option<String>,
        limit: Option<usize>,
        offset: Option<usize>,
    ) -> Result<Vec<serde_json::Value>> {
        let conn = self.conn.lock().unwrap();

        let mut query = "SELECT message_json FROM messages WHERE 1=1".to_string();
        let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

        if let Some(ref tid) = thread_id {
            query.push_str(" AND thread_id = ?");
            params_vec.push(Box::new(tid.clone()));
        }

        if let Some(ref cid) = channel_id {
            query.push_str(" AND channel_id = ?");
            params_vec.push(Box::new(cid.clone()));
        }

        query.push_str(" ORDER BY timestamp ASC");

        if let Some(l) = limit {
            query.push_str(&format!(" LIMIT {}", l));
            if let Some(o) = offset {
                query.push_str(&format!(" OFFSET {}", o));
            }
        }

        let mut stmt = conn.prepare(&query)?;
        let rusqlite_params: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|b| b.as_ref()).collect();

        let rows = stmt.query_map(rusqlite_params.as_slice(), |row| {
            let json_str: String = row.get(0)?;
            Ok(json_str)
        })?;

        let mut results = Vec::new();
        for r in rows {
            if let Ok(json_str) = r {
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&json_str) {
                    results.push(val);
                }
            }
        }

        Ok(results)
    }

    /// 删除指定线程或频道的历史消息
    pub fn delete_messages(&self, thread_id: Option<String>, channel_id: Option<String>) -> Result<usize> {
        let conn = self.conn.lock().unwrap();
        let mut count = 0;

        if let Some(tid) = thread_id {
            count += conn.execute("DELETE FROM messages WHERE thread_id = ?1", params![tid])?;
        } else if let Some(cid) = channel_id {
            count += conn.execute("DELETE FROM messages WHERE channel_id = ?1", params![cid])?;
        }

        Ok(count)
    }

    /// 清空所有消息历史（保留 acp_memories 核心记忆）
    pub fn clear_all_messages(&self) -> Result<usize> {
        let conn = self.conn.lock().unwrap();
        let count = conn.execute("DELETE FROM messages", [])?;
        let _ = conn.execute_batch("VACUUM;");
        Ok(count)
    }

    /// 汇总计算存储统计指标（区分可清理、半持久历史、受保护核心）
    pub fn get_storage_stats(&self, logs_path: &str) -> Result<StorageStatsDto> {
        let conn = self.conn.lock().unwrap();

        // 1. 统计消息条数
        let total_messages: usize = conn
            .query_row("SELECT COUNT(*) FROM messages", [], |row| row.get(0))
            .unwrap_or(0);

        // 2. 统计核心记忆条目数
        let total_memories: usize = conn
            .query_row("SELECT COUNT(*) FROM acp_memories", [], |row| row.get(0))
            .unwrap_or(0);

        // 3. 计算数据库物理大小 (包括 db 文件与 wal 文件)
        let mut db_size_bytes = 0u64;
        let db_path_obj = Path::new(&self.db_path);
        if let Ok(meta) = std::fs::metadata(db_path_obj) {
            db_size_bytes += meta.len();
        }
        let wal_path = format!("{}-wal", self.db_path);
        if let Ok(meta) = std::fs::metadata(&wal_path) {
            db_size_bytes += meta.len();
        }

        // 4. 计算日志物理大小
        let mut logs_size_bytes = 0u64;
        let logs_path_obj = Path::new(logs_path);
        if let Ok(meta) = std::fs::metadata(logs_path_obj) {
            logs_size_bytes = meta.len();
        }

        // 5. 分类估算
        let safe_cleanable_bytes = logs_size_bytes; // 日志完全安全清理

        // 历史消息在数据库中的大概占比
        let archivable_bytes = if total_messages + total_memories > 0 {
            (db_size_bytes as f64 * (total_messages as f64 / (total_messages + total_memories) as f64)) as u64
        } else {
            db_size_bytes / 2
        };

        let protected_bytes = db_size_bytes.saturating_sub(archivable_bytes);

        Ok(StorageStatsDto {
            database_path: self.db_path.clone(),
            database_size_bytes: db_size_bytes,
            logs_path: logs_path.to_string(),
            logs_size_bytes,
            total_messages_count: total_messages,
            total_memories_count: total_memories,
            safe_cleanable_bytes,
            archivable_bytes,
            protected_bytes,
        })
    }

    /// 安全清理缓存：截断清空日志文件，并执行 SQLite WAL 压缩
    pub fn clear_safe_cache(&self, logs_path: &str) -> Result<u64> {
        let mut freed_bytes = 0u64;

        // 1. 截断清空日志
        let logs_path_obj = Path::new(logs_path);
        if let Ok(meta) = std::fs::metadata(logs_path_obj) {
            freed_bytes += meta.len();
            let _ = std::fs::write(logs_path_obj, "");
        }

        // 2. 压缩 SQLite WAL 文件
        let conn = self.conn.lock().unwrap();
        let _ = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");

        let wal_path = format!("{}-wal", self.db_path);
        if let Ok(meta) = std::fs::metadata(&wal_path) {
            freed_bytes += meta.len().saturating_sub(4096);
        }

        Ok(freed_bytes)
    }

    /// 保存项目列表
    pub fn save_projects(&self, projects: &[serde_json::Value]) -> Result<()> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        tx.execute("DELETE FROM projects", [])?;
        {
            let mut stmt = tx.prepare(
                "INSERT INTO projects (id, name, data_json) VALUES (?1, ?2, ?3)",
            )?;
            for val in projects {
                let id = val.get("id").and_then(|v| v.as_str()).unwrap_or("");
                let name = val.get("name").and_then(|v| v.as_str()).unwrap_or("");
                if !id.is_empty() {
                    let json_str = serde_json::to_string(val)?;
                    let _ = stmt.execute(params![id, name, json_str]);
                }
            }
        }
        tx.commit()?;
        Ok(())
    }

    /// 查询项目列表
    pub fn get_projects(&self) -> Result<Vec<serde_json::Value>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT data_json FROM projects ORDER BY updated_at ASC")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        let mut list = Vec::new();
        for r in rows.flatten() {
            if let Ok(v) = serde_json::from_str(&r) {
                list.push(v);
            }
        }
        Ok(list)
    }

    /// 保存频道列表
    pub fn save_channels(&self, channels: &[serde_json::Value]) -> Result<()> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        tx.execute("DELETE FROM channels", [])?;
        {
            let mut stmt = tx.prepare(
                "INSERT INTO channels (id, project_id, name, data_json) VALUES (?1, ?2, ?3, ?4)",
            )?;
            for val in channels {
                let id = val.get("id").and_then(|v| v.as_str()).unwrap_or("");
                let project_id = val.get("projectId").and_then(|v| v.as_str()).unwrap_or("");
                let name = val.get("name").and_then(|v| v.as_str()).unwrap_or("");
                if !id.is_empty() {
                    let json_str = serde_json::to_string(val)?;
                    let _ = stmt.execute(params![id, project_id, name, json_str]);
                }
            }
        }
        tx.commit()?;
        Ok(())
    }

    /// 查询频道列表
    pub fn get_channels(&self) -> Result<Vec<serde_json::Value>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT data_json FROM channels ORDER BY updated_at ASC")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        let mut list = Vec::new();
        for r in rows.flatten() {
            if let Ok(v) = serde_json::from_str(&r) {
                list.push(v);
            }
        }
        Ok(list)
    }

    /// 保存话题/议题列表
    pub fn save_threads(&self, threads: &[serde_json::Value]) -> Result<()> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        tx.execute("DELETE FROM threads", [])?;
        {
            let mut stmt = tx.prepare(
                "INSERT INTO threads (id, channel_id, title, data_json) VALUES (?1, ?2, ?3, ?4)",
            )?;
            for val in threads {
                let id = val.get("id").and_then(|v| v.as_str()).unwrap_or("");
                let channel_id = val.get("channelId").and_then(|v| v.as_str()).unwrap_or("");
                let title = val.get("title").and_then(|v| v.as_str()).unwrap_or("");
                if !id.is_empty() {
                    let json_str = serde_json::to_string(val)?;
                    let _ = stmt.execute(params![id, channel_id, title, json_str]);
                }
            }
        }
        tx.commit()?;
        Ok(())
    }

    /// 查询话题/议题列表
    pub fn get_threads(&self) -> Result<Vec<serde_json::Value>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT data_json FROM threads ORDER BY updated_at ASC")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        let mut list = Vec::new();
        for r in rows.flatten() {
            if let Ok(v) = serde_json::from_str(&r) {
                list.push(v);
            }
        }
        Ok(list)
    }

    /// 保存 Agent 列表
    pub fn save_agents(&self, agents: &[serde_json::Value]) -> Result<()> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        tx.execute("DELETE FROM agents", [])?;
        {
            let mut stmt = tx.prepare(
                "INSERT INTO agents (id, name, handle, data_json) VALUES (?1, ?2, ?3, ?4)",
            )?;
            for val in agents {
                let id = val.get("id").and_then(|v| v.as_str()).unwrap_or("");
                let name = val.get("name").and_then(|v| v.as_str()).unwrap_or("");
                let handle = val.get("handle").and_then(|v| v.as_str()).unwrap_or("");
                if !id.is_empty() {
                    let json_str = serde_json::to_string(val)?;
                    let _ = stmt.execute(params![id, name, handle, json_str]);
                }
            }
        }
        tx.commit()?;
        Ok(())
    }

    /// 查询 Agent 列表
    pub fn get_agents(&self) -> Result<Vec<serde_json::Value>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT data_json FROM agents ORDER BY updated_at ASC")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        let mut list = Vec::new();
        for r in rows.flatten() {
            if let Ok(v) = serde_json::from_str(&r) {
                list.push(v);
            }
        }
        Ok(list)
    }

    /// 保存 Team 编队列表
    pub fn save_teams(&self, teams: &[serde_json::Value]) -> Result<()> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        tx.execute("DELETE FROM teams", [])?;
        {
            let mut stmt = tx.prepare(
                "INSERT INTO teams (id, name, data_json) VALUES (?1, ?2, ?3)",
            )?;
            for val in teams {
                let id = val.get("id").and_then(|v| v.as_str()).unwrap_or("");
                let name = val.get("name").and_then(|v| v.as_str()).unwrap_or("");
                if !id.is_empty() {
                    let json_str = serde_json::to_string(val)?;
                    let _ = stmt.execute(params![id, name, json_str]);
                }
            }
        }
        tx.commit()?;
        Ok(())
    }

    /// 查询 Team 编队列表
    pub fn get_teams(&self) -> Result<Vec<serde_json::Value>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT data_json FROM teams ORDER BY updated_at ASC")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        let mut list = Vec::new();
        for r in rows.flatten() {
            if let Ok(v) = serde_json::from_str(&r) {
                list.push(v);
            }
        }
        Ok(list)
    }

    /// 保存工作区状态键值对 (activeProjectId, activeChannelId, activeThreadId, globalModelConfig, subThreads)
    pub fn save_workspace_state(&self, key: &str, value: &serde_json::Value) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let json_str = serde_json::to_string(value)?;
        conn.execute(
            "INSERT INTO workspace_state (key, value_json) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = CURRENT_TIMESTAMP",
            params![key, json_str],
        )?;
        Ok(())
    }

    /// 获取单个工作区状态
    pub fn get_workspace_state(&self, key: &str) -> Result<Option<serde_json::Value>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT value_json FROM workspace_state WHERE key = ?1")?;
        let mut rows = stmt.query(params![key])?;
        if let Some(row) = rows.next()? {
            let json_str: String = row.get(0)?;
            if let Ok(val) = serde_json::from_str(&json_str) {
                return Ok(Some(val));
            }
        }
        Ok(None)
    }

    /// 聚合获取工作区全部核心资产（一次调用毫秒级全量返回）
    pub fn get_full_workspace_data(&self) -> Result<serde_json::Value> {
        let projects = self.get_projects()?;
        let channels = self.get_channels()?;
        let threads = self.get_threads()?;
        let agents = self.get_agents()?;
        let teams = self.get_teams()?;

        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT key, value_json FROM workspace_state")?;
        let state_rows = stmt.query_map([], |row| {
            let k: String = row.get(0)?;
            let v: String = row.get(1)?;
            Ok((k, v))
        })?;

        let mut state_map = serde_json::Map::new();
        for r in state_rows.flatten() {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&r.1) {
                state_map.insert(r.0, parsed);
            }
        }

        Ok(serde_json::json!({
            "projects": projects,
            "channels": channels,
            "threads": threads,
            "agents": agents,
            "teams": teams,
            "workspaceState": state_map,
        }))
    }

    /// 插入或更新指定 Agent 与 session_key 对应的 ACP 会话映射
    pub fn save_acp_session(
        &self,
        agent_id: &str,
        session_key: &str,
        session_id: &str,
        workspace_cwd: &str,
        system_prompt: &str,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO acp_sessions (agent_id, session_key, session_id, workspace_cwd, system_prompt, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, CURRENT_TIMESTAMP)
             ON CONFLICT(agent_id, session_key) DO UPDATE SET
                session_id = excluded.session_id,
                workspace_cwd = excluded.workspace_cwd,
                system_prompt = excluded.system_prompt,
                updated_at = CURRENT_TIMESTAMP",
            params![agent_id, session_key, session_id, workspace_cwd, system_prompt],
        )?;
        Ok(())
    }

    /// 获取指定 Agent 与 session_key 的持久化会话记录
    pub fn get_acp_session(&self, agent_id: &str, session_key: &str) -> Result<Option<AcpSessionRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT agent_id, session_key, session_id, workspace_cwd, system_prompt, created_at, updated_at
             FROM acp_sessions
             WHERE agent_id = ?1 AND session_key = ?2",
        )?;
        let mut rows = stmt.query(params![agent_id, session_key])?;
        if let Some(row) = rows.next()? {
            Ok(Some(AcpSessionRecord {
                agent_id: row.get(0)?,
                session_key: row.get(1)?,
                session_id: row.get(2)?,
                workspace_cwd: row.get(3)?,
                system_prompt: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            }))
        } else {
            Ok(None)
        }
    }

    /// 清理指定 Agent 或指定 session_key 前缀的持久化会话映射，并返回被删除的 session_id 列表
    pub fn delete_acp_session(
        &self,
        agent_id: Option<&str>,
        session_key_or_prefix: Option<&str>,
    ) -> Result<Vec<String>> {
        let conn = self.conn.lock().unwrap();
        let mut removed_sids = Vec::new();

        let (select_sql, delete_sql, params_vec): (String, String, Vec<String>) = match (agent_id, session_key_or_prefix) {
            (Some(a), Some(p)) => {
                let clean_p = p.trim();
                let colon_prefix = if clean_p.ends_with(':') {
                    format!("{}%", clean_p)
                } else {
                    format!("{}:%", clean_p)
                };
                (
                    "SELECT session_id FROM acp_sessions WHERE agent_id = ?1 AND (session_key = ?2 OR session_key LIKE ?3)".to_string(),
                    "DELETE FROM acp_sessions WHERE agent_id = ?1 AND (session_key = ?2 OR session_key LIKE ?3)".to_string(),
                    vec![a.to_string(), clean_p.to_string(), colon_prefix],
                )
            }
            (Some(a), None) => (
                "SELECT session_id FROM acp_sessions WHERE agent_id = ?1".to_string(),
                "DELETE FROM acp_sessions WHERE agent_id = ?1".to_string(),
                vec![a.to_string()],
            ),
            (None, Some(p)) => {
                let clean_p = p.trim();
                let colon_prefix = if clean_p.ends_with(':') {
                    format!("{}%", clean_p)
                } else {
                    format!("{}:%", clean_p)
                };
                (
                    "SELECT session_id FROM acp_sessions WHERE session_key = ?1 OR session_key LIKE ?2".to_string(),
                    "DELETE FROM acp_sessions WHERE session_key = ?1 OR session_key LIKE ?2".to_string(),
                    vec![clean_p.to_string(), colon_prefix],
                )
            }
            (None, None) => (
                "SELECT session_id FROM acp_sessions".to_string(),
                "DELETE FROM acp_sessions".to_string(),
                vec![],
            ),
        };

        {
            let mut stmt = conn.prepare(&select_sql)?;
            let rusqlite_params = rusqlite::params_from_iter(params_vec.iter());
            let mut rows = stmt.query(rusqlite_params)?;
            while let Some(row) = rows.next()? {
                let sid: String = row.get(0)?;
                removed_sids.push(sid);
            }
        }

        {
            let rusqlite_params = rusqlite::params_from_iter(params_vec.iter());
            conn.execute(&delete_sql, rusqlite_params)?;
        }

        Ok(removed_sids)
    }

    /// 列出指定 Agent 的所有持久化会话记录
    pub fn list_acp_sessions(&self, agent_id: Option<&str>) -> Result<Vec<AcpSessionRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut records = Vec::new();

        if let Some(a) = agent_id {
            let mut stmt = conn.prepare(
                "SELECT agent_id, session_key, session_id, workspace_cwd, system_prompt, created_at, updated_at
                 FROM acp_sessions WHERE agent_id = ?1 ORDER BY updated_at DESC",
            )?;
            let mut rows = stmt.query(params![a])?;
            while let Some(row) = rows.next()? {
                records.push(AcpSessionRecord {
                    agent_id: row.get(0)?,
                    session_key: row.get(1)?,
                    session_id: row.get(2)?,
                    workspace_cwd: row.get(3)?,
                    system_prompt: row.get(4)?,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                });
            }
        } else {
            let mut stmt = conn.prepare(
                "SELECT agent_id, session_key, session_id, workspace_cwd, system_prompt, created_at, updated_at
                 FROM acp_sessions ORDER BY updated_at DESC",
            )?;
            let mut rows = stmt.query([])?;
            while let Some(row) = rows.next()? {
                records.push(AcpSessionRecord {
                    agent_id: row.get(0)?,
                    session_key: row.get(1)?,
                    session_id: row.get(2)?,
                    workspace_cwd: row.get(3)?,
                    system_prompt: row.get(4)?,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                });
            }
        }

        Ok(records)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_workspace_entities_persistence() {
        let mgr = DatabaseManager::new(":memory:").expect("Failed to create in-memory db");

        // 1. Projects
        let projects = vec![serde_json::json!({ "id": "p1", "name": "Project Alpha" })];
        mgr.save_projects(&projects).expect("save_projects failed");
        let loaded_projects = mgr.get_projects().expect("get_projects failed");
        assert_eq!(loaded_projects.len(), 1);
        assert_eq!(loaded_projects[0]["name"], "Project Alpha");

        // 2. Channels
        let channels = vec![serde_json::json!({ "id": "c1", "projectId": "p1", "name": "general" })];
        mgr.save_channels(&channels).expect("save_channels failed");
        let loaded_channels = mgr.get_channels().expect("get_channels failed");
        assert_eq!(loaded_channels.len(), 1);
        assert_eq!(loaded_channels[0]["name"], "general");

        // 3. Threads
        let threads = vec![serde_json::json!({ "id": "t1", "channelId": "c1", "title": "Topic 1" })];
        mgr.save_threads(&threads).expect("save_threads failed");
        let loaded_threads = mgr.get_threads().expect("get_threads failed");
        assert_eq!(loaded_threads.len(), 1);

        // 4. Agents
        let agents = vec![serde_json::json!({ "id": "a1", "name": "Agent 1", "handle": "@agent1" })];
        mgr.save_agents(&agents).expect("save_agents failed");
        let loaded_agents = mgr.get_agents().expect("get_agents failed");
        assert_eq!(loaded_agents.len(), 1);

        // 5. Teams
        let teams = vec![serde_json::json!({ "id": "team1", "name": "Core Squad" })];
        mgr.save_teams(&teams).expect("save_teams failed");
        let loaded_teams = mgr.get_teams().expect("get_teams failed");
        assert_eq!(loaded_teams.len(), 1);

        // 6. Workspace State
        mgr.save_workspace_state("activeProjectId", &serde_json::json!("p1")).expect("save_workspace_state failed");
        let state_val = mgr.get_workspace_state("activeProjectId").expect("get_workspace_state failed");
        assert_eq!(state_val, Some(serde_json::json!("p1")));

        // 7. Full Workspace Aggregate
        let full = mgr.get_full_workspace_data().expect("get_full_workspace_data failed");
        assert_eq!(full["projects"].as_array().unwrap().len(), 1);
        assert_eq!(full["channels"].as_array().unwrap().len(), 1);
        assert_eq!(full["threads"].as_array().unwrap().len(), 1);
        assert_eq!(full["agents"].as_array().unwrap().len(), 1);
        assert_eq!(full["teams"].as_array().unwrap().len(), 1);
        assert_eq!(full["workspaceState"]["activeProjectId"], "p1");
    }

    #[test]
    fn test_acp_session_persistence_lifecycle() {
        let mgr = DatabaseManager::new(":memory:").expect("Failed to create in-memory db");

        // 1. 保存 3 个不同维度的 ACP 会话映射
        mgr.save_acp_session(
            "agent_alpha",
            "dm:agent_alpha:thread_1",
            "sess_dm_01",
            "/tmp/agent_alpha",
            "system_prompt_v1",
        ).expect("save dm session failed");

        mgr.save_acp_session(
            "agent_alpha",
            "channel:chan_1:thread_2",
            "sess_chan_01",
            "/tmp/chan_1",
            "system_prompt_v1",
        ).expect("save channel session failed");

        mgr.save_acp_session(
            "agent_alpha",
            "topic:chan_1:topic_3:standard",
            "sess_topic_01",
            "/tmp/chan_1",
            "system_prompt_v1",
        ).expect("save topic session failed");

        // 2. 精确读取验证
        let dm_sess = mgr.get_acp_session("agent_alpha", "dm:agent_alpha:thread_1")
            .expect("get dm session query failed")
            .expect("dm session should exist");
        assert_eq!(dm_sess.session_id, "sess_dm_01");
        assert_eq!(dm_sess.workspace_cwd, "/tmp/agent_alpha");

        // 3. 覆盖更新 (session_id 轮转或 cwd 变更)
        mgr.save_acp_session(
            "agent_alpha",
            "dm:agent_alpha:thread_1",
            "sess_dm_02",
            "/tmp/agent_alpha_v2",
            "system_prompt_v2",
        ).expect("update dm session failed");

        let updated_dm = mgr.get_acp_session("agent_alpha", "dm:agent_alpha:thread_1")
            .expect("query updated dm session failed")
            .unwrap();
        assert_eq!(updated_dm.session_id, "sess_dm_02");
        assert_eq!(updated_dm.workspace_cwd, "/tmp/agent_alpha_v2");
        assert_eq!(updated_dm.system_prompt, "system_prompt_v2");

        // 4. 按作用域前缀删除 (清理 topic:chan_1:)
        let deleted = mgr.delete_acp_session(Some("agent_alpha"), Some("topic:chan_1:"))
            .expect("delete by prefix failed");
        assert_eq!(deleted, vec!["sess_topic_01"]);
        assert!(mgr.get_acp_session("agent_alpha", "topic:chan_1:topic_3:standard").unwrap().is_none());
        assert!(mgr.get_acp_session("agent_alpha", "channel:chan_1:thread_2").unwrap().is_some());

        // 5. 按 Agent 全量清理
        let deleted_all = mgr.delete_acp_session(Some("agent_alpha"), None)
            .expect("delete all agent sessions failed");
        assert_eq!(deleted_all.len(), 2);
        assert!(mgr.list_acp_sessions(Some("agent_alpha")).unwrap().is_empty());
    }
}
