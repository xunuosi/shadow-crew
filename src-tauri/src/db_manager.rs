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
    pub workspace_binding_id: String,
    pub workspace_cwd: String,
    pub system_prompt: String,
    pub created_gen: u64,
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

/// 解析、校验并按需创建 Workspace cwd。自定义目录要求已存在；系统默认目录允许创建。
pub fn resolve_workspace_cwd_input(raw_cwd: &str, create_missing: bool) -> Result<String> {
    let trimmed = raw_cwd.trim();
    if trimmed.is_empty() {
        return Err(anyhow::anyhow!("Workspace cwd cannot be empty"));
    }

    let expanded = if trimmed == "~" || trimmed.starts_with("~/") {
        let user_home = std::env::var("HOME")
            .or_else(|_| std::env::var("USERPROFILE"))
            .map_err(|_| anyhow::anyhow!("Cannot resolve user home directory"))?;
        if trimmed == "~" {
            user_home
        } else {
            format!("{}{}", user_home, &trimmed[1..])
        }
    } else {
        trimmed.to_string()
    };

    let path = Path::new(&expanded);
    if !path.is_absolute() {
        return Err(anyhow::anyhow!("Workspace cwd must be an absolute path: {}", raw_cwd));
    }

    let metadata = match std::fs::symlink_metadata(path) {
        Ok(meta) => {
            if meta.file_type().is_symlink() {
                return Err(anyhow::anyhow!("Workspace cwd cannot be a symbolic link: {}", path.display()));
            }
            Some(meta)
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound && create_missing => {
            std::fs::create_dir_all(path)
                .map_err(|e| anyhow::anyhow!("Failed to create workspace cwd {}: {}", path.display(), e))?;
            Some(std::fs::symlink_metadata(path)?)
        }
        Err(err) => {
            return Err(anyhow::anyhow!(
                "Workspace cwd does not exist or is inaccessible [{}]: {}",
                path.display(),
                err
            ));
        }
    };

    if metadata.as_ref().is_some_and(|meta| !meta.is_dir()) {
        return Err(anyhow::anyhow!("Workspace cwd is not a directory: {}", path.display()));
    }

    let canonical = std::fs::canonicalize(path)
        .map_err(|e| anyhow::anyhow!("Failed to canonicalize workspace cwd {}: {}", path.display(), e))?;
    let shadow_home = get_shadow_crew_home_dir();
    let user_home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .ok()
        .map(std::path::PathBuf::from);

    if canonical.parent().is_none() {
        return Err(anyhow::anyhow!("Filesystem root cannot be used as a workspace"));
    }
    if canonical == shadow_home {
        return Err(anyhow::anyhow!("Shadow Crew global root cannot be used as a workspace"));
    }
    if user_home.as_ref().is_some_and(|home| canonical == *home) {
        return Err(anyhow::anyhow!("User home directory cannot be used as a workspace"));
    }

    Ok(canonical.to_string_lossy().to_string())
}

/// 转义 SQL LIKE 查询中的通配符 (% 与 _)
pub fn escape_sql_like(input: &str) -> String {
    input
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

fn table_has_column(conn: &Connection, table: &str, column: &str) -> Result<bool> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({})", table))?;
    let mut rows = stmt.query([])?;
    while let Some(row) = rows.next()? {
        let name: String = row.get(1)?;
        if name == column {
            return Ok(true);
        }
    }
    Ok(false)
}

/// 一次性移除旧 Project 领域概念及其持久化残留。
fn migrate_remove_project_concept(conn: &mut Connection) -> Result<()> {
    let migration_name = "20261029_remove_project_concept";
    let already_applied: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE name = ?1)",
        params![migration_name],
        |row| row.get(0),
    )?;
    if already_applied {
        return Ok(());
    }

    let tx = conn.transaction()?;
    tx.execute("DROP INDEX IF EXISTS idx_channels_project", [])?;

    if table_has_column(&tx, "channels", "project_id")? {
        tx.execute("ALTER TABLE channels DROP COLUMN project_id", [])?;
    }
    if table_has_column(&tx, "messages", "project_id")? {
        tx.execute("ALTER TABLE messages DROP COLUMN project_id", [])?;
    }

    tx.execute(
        "UPDATE channels
         SET data_json = json_remove(data_json, '$.projectId')
         WHERE json_type(data_json, '$.projectId') IS NOT NULL",
        [],
    )?;
    tx.execute(
        "UPDATE messages
         SET message_json = json_remove(message_json, '$.projectId')
         WHERE json_type(message_json, '$.projectId') IS NOT NULL",
        [],
    )?;
    tx.execute("DELETE FROM workspace_state WHERE key = 'activeProjectId'", [])?;
    tx.execute("DROP TABLE IF EXISTS projects", [])?;
    tx.execute(
        "INSERT INTO schema_migrations (name) VALUES (?1)",
        params![migration_name],
    )?;
    tx.commit()?;
    Ok(())
}

impl DatabaseManager {
    /// 初始化 SQLite 数据库连接并确保必要数据表与索引就绪
    pub fn new(db_path: &str) -> Result<Self> {
        let mut conn = match Connection::open(db_path) {
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
            CREATE TABLE IF NOT EXISTS channels (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                data_json TEXT NOT NULL,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS workspace_bindings (
                id TEXT PRIMARY KEY,
                owner_type TEXT NOT NULL,
                owner_id TEXT NOT NULL,
                mode TEXT NOT NULL,
                origin TEXT NOT NULL,
                cwd TEXT NOT NULL,
                artifact_root TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                UNIQUE(owner_type, owner_id)
            );

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
                workspace_binding_id TEXT NOT NULL DEFAULT '',
                workspace_cwd TEXT NOT NULL,
                system_prompt TEXT NOT NULL,
                created_gen INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (agent_id, session_key)
            );
            CREATE INDEX IF NOT EXISTS idx_acp_sessions_agent ON acp_sessions(agent_id);

            CREATE TABLE IF NOT EXISTS schema_migrations (
                name TEXT PRIMARY KEY,
                applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        ");

        // 平滑升级已有历史数据库结构
        let _ = conn.execute("ALTER TABLE acp_sessions ADD COLUMN created_gen INTEGER DEFAULT 0", []);
        let _ = conn.execute(
            "ALTER TABLE acp_sessions ADD COLUMN workspace_binding_id TEXT NOT NULL DEFAULT ''",
            [],
        );
        migrate_remove_project_concept(&mut conn)?;

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
        let author_id = val.get("authorId").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let author_name = val.get("authorName").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let timestamp = val.get("timestamp").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let content = val.get("content").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let message_json = serde_json::to_string(val)?;

        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO messages (id, thread_id, channel_id, author_id, author_name, timestamp, content, message_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(id) DO UPDATE SET
                thread_id = excluded.thread_id,
                channel_id = excluded.channel_id,
                author_id = excluded.author_id,
                author_name = excluded.author_name,
                timestamp = excluded.timestamp,
                content = excluded.content,
                message_json = excluded.message_json",
            params![
                id,
                thread_id,
                channel_id,
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
                "INSERT INTO messages (id, thread_id, channel_id, author_id, author_name, timestamp, content, message_json)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                 ON CONFLICT(id) DO UPDATE SET
                    thread_id = excluded.thread_id,
                    channel_id = excluded.channel_id,
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
                    let author_id = val.get("authorId").and_then(|v| v.as_str()).unwrap_or("");
                    let author_name = val.get("authorName").and_then(|v| v.as_str()).unwrap_or("");
                    let timestamp = val.get("timestamp").and_then(|v| v.as_str()).unwrap_or("");
                    let content = val.get("content").and_then(|v| v.as_str()).unwrap_or("");
                    let message_json = serde_json::to_string(val)?;

                    let _ = stmt.execute(params![
                        id,
                        thread_id,
                        channel_id,
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

    /// 保存频道列表
    pub fn save_channels(&self, channels: &[serde_json::Value]) -> Result<()> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        tx.execute("DELETE FROM channels", [])?;
        {
            let mut stmt = tx.prepare(
                "INSERT INTO channels (id, name, data_json) VALUES (?1, ?2, ?3)",
            )?;
            for val in channels {
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

    /// 保存 Workspace Binding 列表。
    pub fn save_workspace_bindings(&self, bindings: &[serde_json::Value]) -> Result<()> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        {
            let mut stmt = tx.prepare(
                "INSERT INTO workspace_bindings
                 (id, owner_type, owner_id, mode, origin, cwd, artifact_root, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            )?;
            for binding in bindings {
                let id = binding.get("id").and_then(|v| v.as_str()).unwrap_or("");
                if id.is_empty() {
                    continue;
                }
                let owner_type = binding.get("ownerType").and_then(|v| v.as_str()).unwrap_or("");
                let owner_id = binding.get("ownerId").and_then(|v| v.as_str()).unwrap_or("");
                let mode = binding.get("mode").and_then(|v| v.as_str()).unwrap_or("");
                let origin = binding.get("origin").and_then(|v| v.as_str()).unwrap_or("");
                let cwd_raw = binding.get("cwd").and_then(|v| v.as_str()).unwrap_or("");
                let artifact_root_raw = binding.get("artifactRoot").and_then(|v| v.as_str()).unwrap_or("");
                let create_missing = mode == "default"
                    || cwd_raw.starts_with("~/.shadow-crew")
                    || cwd_raw.starts_with("~/.shinobi");
                let cwd = resolve_workspace_cwd_input(cwd_raw, create_missing)?;
                let artifact_root = resolve_workspace_cwd_input(artifact_root_raw, true)?;
                let created_at = binding.get("createdAt").and_then(|v| v.as_i64()).unwrap_or(0);

                let existing = tx.query_row(
                    "SELECT owner_type, owner_id, mode, origin, cwd, artifact_root, created_at
                     FROM workspace_bindings WHERE id = ?1",
                    params![id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, String>(3)?,
                            row.get::<_, String>(4)?,
                            row.get::<_, String>(5)?,
                            row.get::<_, i64>(6)?,
                        ))
                    },
                ).ok();
                if let Some(existing) = existing {
                    let expected = (
                        owner_type.to_string(),
                        owner_id.to_string(),
                        mode.to_string(),
                        origin.to_string(),
                        cwd.clone(),
                        artifact_root.clone(),
                        created_at,
                    );
                    if existing != expected {
                        anyhow::bail!(
                            "Workspace Binding {} is immutable and cannot be updated",
                            id
                        );
                    }
                    continue;
                }

                stmt.execute(params![
                    id,
                    owner_type,
                    owner_id,
                    mode,
                    origin,
                    cwd,
                    artifact_root,
                    created_at
                ])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    pub fn delete_workspace_bindings(&self, binding_ids: &[String]) -> Result<()> {
        if binding_ids.is_empty() {
            return Ok(());
        }
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        for binding_id in binding_ids {
            tx.execute(
                "DELETE FROM workspace_bindings WHERE id = ?1",
                params![binding_id],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    /// 查询全部 Workspace Binding。
    pub fn get_workspace_bindings(&self) -> Result<Vec<serde_json::Value>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, owner_type, owner_id, mode, origin, cwd, artifact_root, created_at
             FROM workspace_bindings ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?,
                "ownerType": row.get::<_, String>(1)?,
                "ownerId": row.get::<_, String>(2)?,
                "mode": row.get::<_, String>(3)?,
                "origin": row.get::<_, String>(4)?,
                "cwd": row.get::<_, String>(5)?,
                "artifactRoot": row.get::<_, String>(6)?,
                "createdAt": row.get::<_, i64>(7)?,
            }))
        })?;
        Ok(rows.flatten().collect())
    }

    /// 查询单个 Workspace Binding。
    pub fn get_workspace_binding(&self, binding_id: &str) -> Result<Option<serde_json::Value>> {
        Ok(self
            .get_workspace_bindings()?
            .into_iter()
            .find(|binding| binding.get("id").and_then(|v| v.as_str()) == Some(binding_id)))
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

    /// 保存工作区状态键值对 (activeChannelId, activeThreadId, globalModelConfig, subThreads)
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
        let channels = self.get_channels()?;
        let workspace_bindings = self.get_workspace_bindings()?;
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
            "channels": channels,
            "workspaceBindings": workspace_bindings,
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
        workspace_binding_id: &str,
        workspace_cwd: &str,
        system_prompt: &str,
        created_gen: u64,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO acp_sessions (agent_id, session_key, session_id, workspace_binding_id, workspace_cwd, system_prompt, created_gen, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, CURRENT_TIMESTAMP)
             ON CONFLICT(agent_id, session_key) DO UPDATE SET
                session_id = excluded.session_id,
                workspace_binding_id = excluded.workspace_binding_id,
                workspace_cwd = excluded.workspace_cwd,
                system_prompt = excluded.system_prompt,
                created_gen = excluded.created_gen,
                updated_at = CURRENT_TIMESTAMP",
            params![agent_id, session_key, session_id, workspace_binding_id, workspace_cwd, system_prompt, created_gen],
        )?;
        Ok(())
    }

    /// 获取指定 Agent 与 session_key 的持久化会话记录
    pub fn get_acp_session(&self, agent_id: &str, session_key: &str) -> Result<Option<AcpSessionRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT agent_id, session_key, session_id, workspace_binding_id, workspace_cwd, system_prompt, created_gen, created_at, updated_at
             FROM acp_sessions
             WHERE agent_id = ?1 AND session_key = ?2",
        )?;
        let mut rows = stmt.query(params![agent_id, session_key])?;
        if let Some(row) = rows.next()? {
            Ok(Some(AcpSessionRecord {
                agent_id: row.get(0)?,
                session_key: row.get(1)?,
                session_id: row.get(2)?,
                workspace_binding_id: row.get(3)?,
                workspace_cwd: row.get(4)?,
                system_prompt: row.get(5)?,
                created_gen: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            }))
        } else {
            Ok(None)
        }
    }

    /// 清理指定 Agent 或指定 session_key 前缀的持久化会话映射，并返回被删除的 session_id 列表。
    /// 若提供了 `max_created_gen`，则仅删除 `created_gen <= max_created_gen` 的记录，严格保护清理请求发起后新建的会话！
    pub fn delete_acp_session(
        &self,
        agent_id: Option<&str>,
        session_key_or_prefix: Option<&str>,
        max_created_gen: Option<u64>,
    ) -> Result<Vec<String>> {
        let conn = self.conn.lock().unwrap();
        let mut removed_sids = Vec::new();

        let (select_sql, delete_sql, params_vec): (String, String, Vec<String>) = match (agent_id, session_key_or_prefix) {
            (Some(a), Some(p)) => {
                let clean_p = p.trim();
                let escaped_p = escape_sql_like(clean_p);
                let colon_prefix = if escaped_p.ends_with(':') {
                    format!("{}%", escaped_p)
                } else {
                    format!("{}:%", escaped_p)
                };
                let mut v = vec![a.to_string(), clean_p.to_string(), colon_prefix];
                let gen_clause = if let Some(g) = max_created_gen {
                    v.push(g.to_string());
                    " AND created_gen <= ?4"
                } else {
                    ""
                };
                (
                    format!("SELECT session_id FROM acp_sessions WHERE agent_id = ?1 AND (session_key = ?2 OR session_key LIKE ?3 ESCAPE '\\'){}", gen_clause),
                    format!("DELETE FROM acp_sessions WHERE agent_id = ?1 AND (session_key = ?2 OR session_key LIKE ?3 ESCAPE '\\'){}", gen_clause),
                    v,
                )
            }
            (Some(a), None) => {
                let mut v = vec![a.to_string()];
                let gen_clause = if let Some(g) = max_created_gen {
                    v.push(g.to_string());
                    " AND created_gen <= ?2"
                } else {
                    ""
                };
                (
                    format!("SELECT session_id FROM acp_sessions WHERE agent_id = ?1{}", gen_clause),
                    format!("DELETE FROM acp_sessions WHERE agent_id = ?1{}", gen_clause),
                    v,
                )
            }
            (None, Some(p)) => {
                let clean_p = p.trim();
                let escaped_p = escape_sql_like(clean_p);
                let colon_prefix = if escaped_p.ends_with(':') {
                    format!("{}%", escaped_p)
                } else {
                    format!("{}:%", escaped_p)
                };
                let mut v = vec![clean_p.to_string(), colon_prefix];
                let gen_clause = if let Some(g) = max_created_gen {
                    v.push(g.to_string());
                    " AND created_gen <= ?3"
                } else {
                    ""
                };
                (
                    format!("SELECT session_id FROM acp_sessions WHERE (session_key = ?1 OR session_key LIKE ?2 ESCAPE '\\'){}", gen_clause),
                    format!("DELETE FROM acp_sessions WHERE (session_key = ?1 OR session_key LIKE ?2 ESCAPE '\\'){}", gen_clause),
                    v,
                )
            }
            (None, None) => {
                let mut v = Vec::new();
                let gen_clause = if let Some(g) = max_created_gen {
                    v.push(g.to_string());
                    " WHERE created_gen <= ?1"
                } else {
                    ""
                };
                (
                    format!("SELECT session_id FROM acp_sessions{}", gen_clause),
                    format!("DELETE FROM acp_sessions{}", gen_clause),
                    v,
                )
            }
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
    #[allow(dead_code)]
    pub fn list_acp_sessions(&self, agent_id: Option<&str>) -> Result<Vec<AcpSessionRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut records = Vec::new();

        if let Some(a) = agent_id {
            let mut stmt = conn.prepare(
                "SELECT agent_id, session_key, session_id, workspace_binding_id, workspace_cwd, system_prompt, created_gen, created_at, updated_at
                 FROM acp_sessions WHERE agent_id = ?1 ORDER BY updated_at DESC",
            )?;
            let mut rows = stmt.query(params![a])?;
            while let Some(row) = rows.next()? {
                records.push(AcpSessionRecord {
                    agent_id: row.get(0)?,
                    session_key: row.get(1)?,
                    session_id: row.get(2)?,
                    workspace_binding_id: row.get(3)?,
                    workspace_cwd: row.get(4)?,
                    system_prompt: row.get(5)?,
                    created_gen: row.get(6)?,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                });
            }
        } else {
            let mut stmt = conn.prepare(
                "SELECT agent_id, session_key, session_id, workspace_binding_id, workspace_cwd, system_prompt, created_gen, created_at, updated_at
                 FROM acp_sessions ORDER BY updated_at DESC",
            )?;
            let mut rows = stmt.query([])?;
            while let Some(row) = rows.next()? {
                records.push(AcpSessionRecord {
                    agent_id: row.get(0)?,
                    session_key: row.get(1)?,
                    session_id: row.get(2)?,
                    workspace_binding_id: row.get(3)?,
                    workspace_cwd: row.get(4)?,
                    system_prompt: row.get(5)?,
                    created_gen: row.get(6)?,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
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

        // 1. Channels
        let channels = vec![serde_json::json!({ "id": "c1", "name": "general" })];
        mgr.save_channels(&channels).expect("save_channels failed");
        let loaded_channels = mgr.get_channels().expect("get_channels failed");
        assert_eq!(loaded_channels.len(), 1);
        assert_eq!(loaded_channels[0]["name"], "general");

        // 2. Threads
        let threads = vec![serde_json::json!({ "id": "t1", "channelId": "c1", "title": "Topic 1" })];
        mgr.save_threads(&threads).expect("save_threads failed");
        let loaded_threads = mgr.get_threads().expect("get_threads failed");
        assert_eq!(loaded_threads.len(), 1);

        // 3. Agents
        let agents = vec![serde_json::json!({ "id": "a1", "name": "Agent 1", "handle": "@agent1" })];
        mgr.save_agents(&agents).expect("save_agents failed");
        let loaded_agents = mgr.get_agents().expect("get_agents failed");
        assert_eq!(loaded_agents.len(), 1);

        // 4. Teams
        let teams = vec![serde_json::json!({ "id": "team1", "name": "Core Squad" })];
        mgr.save_teams(&teams).expect("save_teams failed");
        let loaded_teams = mgr.get_teams().expect("get_teams failed");
        assert_eq!(loaded_teams.len(), 1);

        // 5. Workspace State
        mgr.save_workspace_state("activeChannelId", &serde_json::json!("c1")).expect("save_workspace_state failed");
        let state_val = mgr.get_workspace_state("activeChannelId").expect("get_workspace_state failed");
        assert_eq!(state_val, Some(serde_json::json!("c1")));

        // 6. Workspace Bindings
        let binding_root = std::env::temp_dir().join(format!(
            "shadow_crew_workspace_binding_db_test_{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&binding_root).unwrap();
        let binding_root = std::fs::canonicalize(&binding_root).unwrap();
        let binding_artifact_root = binding_root.join("artifacts");
        let binding = serde_json::json!({
            "id": "ws-channel-c1",
            "ownerType": "channel",
            "ownerId": "c1",
            "mode": "custom",
            "origin": "created_default",
            "cwd": binding_root.to_string_lossy(),
            "artifactRoot": binding_artifact_root.to_string_lossy(),
            "createdAt": 1
        });
        mgr.save_workspace_bindings(&[binding.clone()]).expect("save_workspace_bindings failed");
        assert_eq!(
            mgr.get_workspace_binding("ws-channel-c1").unwrap(),
            Some(binding.clone())
        );
        let mut changed_binding = binding.clone();
        changed_binding["cwd"] = serde_json::json!(binding_root.join("mutated").to_string_lossy());
        assert!(mgr.save_workspace_bindings(&[changed_binding]).is_err());
        assert_eq!(
            mgr.get_workspace_binding("ws-channel-c1").unwrap().unwrap()["cwd"].as_str(),
            Some(binding_root.to_str().unwrap())
        );

        // 7. Full Workspace Aggregate
        let full = mgr.get_full_workspace_data().expect("get_full_workspace_data failed");
        assert!(full.get("projects").is_none());
        assert_eq!(full["channels"].as_array().unwrap().len(), 1);
        assert_eq!(full["threads"].as_array().unwrap().len(), 1);
        assert_eq!(full["agents"].as_array().unwrap().len(), 1);
        assert_eq!(full["teams"].as_array().unwrap().len(), 1);
        assert_eq!(full["workspaceState"]["activeChannelId"], "c1");
        assert_eq!(full["workspaceBindings"].as_array().unwrap().len(), 1);

        mgr.delete_workspace_bindings(&["ws-channel-c1".to_string()]).expect("delete binding failed");
        assert!(mgr.get_workspace_binding("ws-channel-c1").unwrap().is_none());
        let _ = std::fs::remove_dir_all(&binding_root);
    }

    #[test]
    fn test_remove_project_concept_migration_is_complete_and_idempotent() {
        let mut conn = Connection::open_in_memory().expect("Failed to create in-memory db");
        conn.execute_batch(
            "
            CREATE TABLE messages (
                id TEXT PRIMARY KEY,
                thread_id TEXT NOT NULL,
                channel_id TEXT,
                project_id TEXT,
                author_id TEXT NOT NULL,
                author_name TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                content TEXT NOT NULL,
                message_json TEXT NOT NULL
            );
            CREATE TABLE channels (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                name TEXT NOT NULL,
                data_json TEXT NOT NULL
            );
            CREATE INDEX idx_channels_project ON channels(project_id);
            CREATE TABLE workspace_state (
                key TEXT PRIMARY KEY,
                value_json TEXT NOT NULL
            );
            CREATE TABLE projects (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                data_json TEXT NOT NULL
            );
            CREATE TABLE schema_migrations (
                name TEXT PRIMARY KEY,
                applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            ",
        ).expect("Failed to create legacy schema");
        conn.execute(
            "INSERT INTO channels (id, project_id, name, data_json) VALUES (?1, ?2, ?3, ?4)",
            params![
                "c1",
                "p1",
                "general",
                serde_json::json!({ "id": "c1", "projectId": "p1", "name": "general" }).to_string()
            ],
        ).expect("Failed to seed legacy channel");
        conn.execute(
            "INSERT INTO messages (id, thread_id, channel_id, project_id, author_id, author_name, timestamp, content, message_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                "m1",
                "c1",
                "c1",
                "p1",
                "user",
                "User",
                "now",
                "hello",
                serde_json::json!({ "id": "m1", "threadId": "c1", "projectId": "p1", "content": "hello" }).to_string()
            ],
        ).expect("Failed to seed legacy message");
        conn.execute(
            "INSERT INTO workspace_state (key, value_json) VALUES ('activeProjectId', ?1)",
            params![serde_json::json!("p1").to_string()],
        ).expect("Failed to seed legacy workspace state");

        migrate_remove_project_concept(&mut conn).expect("Migration failed");
        migrate_remove_project_concept(&mut conn).expect("Idempotent migration failed");

        assert!(!table_has_column(&conn, "channels", "project_id").unwrap());
        assert!(!table_has_column(&conn, "messages", "project_id").unwrap());

        let channel_json: String = conn.query_row(
            "SELECT data_json FROM channels WHERE id = 'c1'",
            [],
            |row| row.get(0),
        ).unwrap();
        let channel: serde_json::Value = serde_json::from_str(&channel_json).unwrap();
        assert!(channel.get("projectId").is_none());

        let message_json: String = conn.query_row(
            "SELECT message_json FROM messages WHERE id = 'm1'",
            [],
            |row| row.get(0),
        ).unwrap();
        let message: serde_json::Value = serde_json::from_str(&message_json).unwrap();
        assert!(message.get("projectId").is_none());

        let project_table_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'projects'",
            [],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(project_table_count, 0);

        let legacy_state_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM workspace_state WHERE key = 'activeProjectId'",
            [],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(legacy_state_count, 0);
    }

    #[test]
    fn workspace_cwd_resolution_creates_only_when_allowed_and_rejects_unsafe_roots() {
        let temp_root = std::env::temp_dir().join(format!(
            "shadow_crew_resolve_cwd_test_{}",
            std::process::id()
        ));
        let target = temp_root.join("topic-cwd");
        let raw = target.to_string_lossy().to_string();

        assert!(resolve_workspace_cwd_input(&raw, false).is_err());
        let resolved = resolve_workspace_cwd_input(&raw, true).unwrap();
        assert_eq!(
            Some(resolved.as_str()),
            std::fs::canonicalize(&target).unwrap().to_str()
        );
        assert!(resolve_workspace_cwd_input("/", false).is_err());
        assert!(resolve_workspace_cwd_input("~/", false).is_err());

        let _ = std::fs::remove_dir_all(&temp_root);
    }

    #[test]
    fn test_acp_session_persistence_lifecycle() {
        let mgr = DatabaseManager::new(":memory:").expect("Failed to create in-memory db");

        // 1. 保存 3 个不同维度的 ACP 会话映射
        mgr.save_acp_session(
            "agent_alpha",
            "dm:agent_alpha:thread_1",
            "sess_dm_01",
            "",
            "/tmp/agent_alpha",
            "system_prompt_v1",
            1,
        ).expect("save dm session failed");

        mgr.save_acp_session(
            "agent_alpha",
            "channel:chan_1:thread_2",
            "sess_chan_01",
            "ws-channel-chan_1",
            "/tmp/chan_1",
            "system_prompt_v1",
            1,
        ).expect("save channel session failed");

        mgr.save_acp_session(
            "agent_alpha",
            "topic:chan_1:topic_3:standard",
            "sess_topic_01",
            "ws-topic-topic_3",
            "/tmp/chan_1",
            "system_prompt_v1",
            1,
        ).expect("save topic session failed");

        // 2. 精确读取验证
        let dm_sess = mgr.get_acp_session("agent_alpha", "dm:agent_alpha:thread_1")
            .expect("get dm session query failed")
            .expect("dm session should exist");
        assert_eq!(dm_sess.session_id, "sess_dm_01");
        assert_eq!(dm_sess.workspace_cwd, "/tmp/agent_alpha");
        assert_eq!(dm_sess.workspace_binding_id, "");
        assert_eq!(dm_sess.created_gen, 1);
        let topic_sess = mgr
            .get_acp_session("agent_alpha", "topic:chan_1:topic_3:standard")
            .expect("get topic session query failed")
            .expect("topic session should exist");
        assert_eq!(topic_sess.workspace_binding_id, "ws-topic-topic_3");

        // 3. 覆盖更新 (session_id 轮转或 cwd 变更)
        mgr.save_acp_session(
            "agent_alpha",
            "dm:agent_alpha:thread_1",
            "sess_dm_02",
            "",
            "/tmp/agent_alpha_v2",
            "system_prompt_v2",
            2,
        ).expect("update dm session failed");

        let updated_dm = mgr.get_acp_session("agent_alpha", "dm:agent_alpha:thread_1")
            .expect("query updated dm session failed")
            .unwrap();
        assert_eq!(updated_dm.session_id, "sess_dm_02");
        assert_eq!(updated_dm.workspace_cwd, "/tmp/agent_alpha_v2");
        assert_eq!(updated_dm.system_prompt, "system_prompt_v2");
        assert_eq!(updated_dm.created_gen, 2);

        // 4. 按作用域前缀删除 (清理 topic:chan_1:)
        let deleted = mgr.delete_acp_session(Some("agent_alpha"), Some("topic:chan_1:"), None)
            .expect("delete by prefix failed");
        assert_eq!(deleted, vec!["sess_topic_01"]);
        assert!(mgr.get_acp_session("agent_alpha", "topic:chan_1:topic_3:standard").unwrap().is_none());
        assert!(mgr.get_acp_session("agent_alpha", "channel:chan_1:thread_2").unwrap().is_some());

        // 验证 LIKE 转义：下划线 '_' 绝不作为单字符通配符误删其它频道 (如 chanA1)
        mgr.save_acp_session(
            "agent_alpha",
            "channel:chanA1:thread_2",
            "sess_chan_other",
            "ws-channel-chanA1",
            "/tmp/chanA1",
            "system_prompt_v1",
            1,
        ).expect("save chanA1 session failed");

        let deleted_wildcard = mgr.delete_acp_session(Some("agent_alpha"), Some("channel:chan_1:"), None)
            .expect("delete by exact prefix failed");
        assert_eq!(deleted_wildcard, vec!["sess_chan_01"]);
        // chanA1 必须完好保留，未被当成 chan_1 误删
        assert!(mgr.get_acp_session("agent_alpha", "channel:chanA1:thread_2").unwrap().is_some());

        // 5. 验证 Generation 屏障防护：若旧清理请求 (gen=1) 迟到到达，绝不能删除代际为 2 的新建会话
        let late_deleted = mgr.delete_acp_session(Some("agent_alpha"), Some("dm:agent_alpha:thread_1"), Some(1))
            .expect("late clear query should succeed");
        assert!(late_deleted.is_empty(), "迟到的旧清理 (gen=1) 严禁删除 created_gen=2 的新会话");
        assert!(mgr.get_acp_session("agent_alpha", "dm:agent_alpha:thread_1").unwrap().is_some());

        // 6. 按 Agent 全量清理 (无 generation 限制)
        let deleted_all = mgr.delete_acp_session(Some("agent_alpha"), None, None)
            .expect("delete all agent sessions failed");
        assert_eq!(deleted_all.len(), 2);
        assert!(mgr.list_acp_sessions(Some("agent_alpha")).unwrap().is_empty());
    }
}
