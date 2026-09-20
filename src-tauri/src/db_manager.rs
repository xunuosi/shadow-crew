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

pub struct DatabaseManager {
    conn: Mutex<Connection>,
    db_path: String,
}

/// 解析默认 SQLite 记忆与数据持久化路径
pub fn get_default_db_path() -> String {
    if let Ok(env_path) = std::env::var("SHINOBI_MEMORY_DB") {
        return env_path;
    }
    if let Ok(curr) = std::env::current_dir() {
        let direct = curr.join("shinobi_agent_memory.db");
        if direct.exists() {
            return direct.to_string_lossy().to_string();
        }
        if curr.ends_with("src-tauri") {
            let parent_db = curr.join("../shinobi_agent_memory.db");
            if parent_db.exists() {
                return parent_db.to_string_lossy().to_string();
            }
        }
        direct.to_string_lossy().to_string()
    } else {
        "shinobi_agent_memory.db".to_string()
    }
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
}
