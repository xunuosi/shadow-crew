use anyhow::Result;
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
