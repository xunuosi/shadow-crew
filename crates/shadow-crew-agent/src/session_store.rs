use anyhow::Result;
use rusqlite::{params, Connection};
use std::path::PathBuf;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredSession {
    pub session_id: String,
    pub session_key: String,
    pub channel_id: String,
    pub workspace_binding_id: String,
    pub owner_dir: PathBuf,
    pub workspace_dir: PathBuf,
    pub artifact_root: PathBuf,
    pub system_prompt: Option<String>,
    pub mcp_pool_key: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredMessage {
    pub role: String,
    pub content: String,
}

pub struct SessionStore {
    conn: Connection,
}

impl SessionStore {
    pub fn new(db_path: &str) -> Result<Self> {
        if let Some(parent) = std::path::Path::new(db_path).parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(db_path)?;
        conn.execute_batch(
            "
            PRAGMA journal_mode = WAL;
            PRAGMA busy_timeout = 5000;
            CREATE TABLE IF NOT EXISTS native_agent_sessions (
                session_id TEXT PRIMARY KEY,
                session_key TEXT NOT NULL,
                channel_id TEXT NOT NULL,
                workspace_binding_id TEXT NOT NULL DEFAULT '',
                owner_dir TEXT NOT NULL,
                workspace_dir TEXT NOT NULL,
                artifact_root TEXT NOT NULL DEFAULT '',
                system_prompt TEXT,
                mcp_pool_key TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS native_agent_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_native_agent_messages_session
                ON native_agent_messages(session_id, id);
            ",
        )?;
        let _ = conn.execute(
            "ALTER TABLE native_agent_sessions ADD COLUMN workspace_binding_id TEXT NOT NULL DEFAULT ''",
            [],
        );
        let _ = conn.execute(
            "ALTER TABLE native_agent_sessions ADD COLUMN artifact_root TEXT NOT NULL DEFAULT ''",
            [],
        );
        Ok(Self { conn })
    }

    pub fn upsert_session(&mut self, session: &StoredSession, reset_history: bool) -> Result<()> {
        let now = unix_timestamp()?;
        let tx = self.conn.transaction()?;
        tx.execute(
            "INSERT INTO native_agent_sessions (
                session_id, session_key, channel_id, workspace_binding_id, owner_dir, workspace_dir,
                artifact_root, system_prompt, mcp_pool_key, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)
             ON CONFLICT(session_id) DO UPDATE SET
                session_key = excluded.session_key,
                channel_id = excluded.channel_id,
                workspace_binding_id = excluded.workspace_binding_id,
                owner_dir = excluded.owner_dir,
                workspace_dir = excluded.workspace_dir,
                artifact_root = excluded.artifact_root,
                system_prompt = excluded.system_prompt,
                mcp_pool_key = excluded.mcp_pool_key,
                updated_at = excluded.updated_at",
            params![
                session.session_id,
                session.session_key,
                session.channel_id,
                session.workspace_binding_id,
                session.owner_dir.to_string_lossy(),
                session.workspace_dir.to_string_lossy(),
                session.artifact_root.to_string_lossy(),
                session.system_prompt,
                session.mcp_pool_key,
                now
            ],
        )?;
        if reset_history {
            tx.execute(
                "DELETE FROM native_agent_messages WHERE session_id = ?1",
                params![session.session_id],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn get_session(&self, session_id: &str) -> Result<Option<StoredSession>> {
        let mut stmt = self.conn.prepare(
            "SELECT session_id, session_key, channel_id, workspace_binding_id, owner_dir, workspace_dir,
                    artifact_root, system_prompt, mcp_pool_key
             FROM native_agent_sessions
             WHERE session_id = ?1",
        )?;
        let mut rows = stmt.query(params![session_id])?;
        let Some(row) = rows.next()? else {
            return Ok(None);
        };
        Ok(Some(StoredSession {
            session_id: row.get(0)?,
            session_key: row.get(1)?,
            channel_id: row.get(2)?,
            workspace_binding_id: row.get(3)?,
            owner_dir: PathBuf::from(row.get::<_, String>(4)?),
            workspace_dir: PathBuf::from(row.get::<_, String>(5)?),
            artifact_root: PathBuf::from(row.get::<_, String>(6)?),
            system_prompt: row.get(7)?,
            mcp_pool_key: row.get(8)?,
        }))
    }

    pub fn load_recent_messages(
        &self,
        session_id: &str,
        limit: usize,
    ) -> Result<Vec<StoredMessage>> {
        let mut stmt = self.conn.prepare(
            "SELECT role, content
             FROM (
                SELECT id, role, content
                FROM native_agent_messages
                WHERE session_id = ?1
                ORDER BY id DESC
                LIMIT ?2
             )
             ORDER BY id ASC",
        )?;
        let rows = stmt.query_map(params![session_id, limit.max(1) as i64], |row| {
            Ok(StoredMessage {
                role: row.get(0)?,
                content: row.get(1)?,
            })
        })?;
        let mut messages = Vec::new();
        for row in rows {
            messages.push(row?);
        }
        Ok(messages)
    }

    pub fn append_exchange(
        &mut self,
        session_id: &str,
        user_prompt: &str,
        assistant_response: &str,
    ) -> Result<()> {
        let now = unix_timestamp()?;
        let tx = self.conn.transaction()?;
        tx.execute(
            "INSERT INTO native_agent_messages (session_id, role, content, created_at)
             VALUES (?1, 'user', ?2, ?3)",
            params![session_id, user_prompt, now],
        )?;
        tx.execute(
            "INSERT INTO native_agent_messages (session_id, role, content, created_at)
             VALUES (?1, 'assistant', ?2, ?3)",
            params![session_id, assistant_response, now],
        )?;
        tx.execute(
            "DELETE FROM native_agent_messages
             WHERE session_id = ?1
               AND id NOT IN (
                   SELECT id FROM native_agent_messages
                   WHERE session_id = ?1
                   ORDER BY id DESC
                   LIMIT 96
               )",
            params![session_id],
        )?;
        tx.execute(
            "UPDATE native_agent_sessions SET updated_at = ?2 WHERE session_id = ?1",
            params![session_id, now],
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn delete_session(&mut self, session_id: &str) -> Result<()> {
        let tx = self.conn.transaction()?;
        tx.execute(
            "DELETE FROM native_agent_messages WHERE session_id = ?1",
            params![session_id],
        )?;
        tx.execute(
            "DELETE FROM native_agent_sessions WHERE session_id = ?1",
            params![session_id],
        )?;
        tx.commit()?;
        Ok(())
    }
}

fn unix_timestamp() -> Result<i64> {
    Ok(std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)?
        .as_secs() as i64)
}

#[cfg(test)]
mod tests {
    use super::{SessionStore, StoredSession};
    use std::path::PathBuf;

    fn temp_db_path(name: &str) -> String {
        std::env::temp_dir()
            .join(format!(
                "shadow_crew_session_store_{}_{}.sqlite",
                name,
                std::process::id()
            ))
            .to_string_lossy()
            .to_string()
    }

    #[test]
    fn session_store_restores_metadata_and_history_after_reopen() {
        let db_path = temp_db_path("restore");
        let _ = std::fs::remove_file(&db_path);
        let session = StoredSession {
            session_id: "shinobi-session-topic:chan-1:topic-1:standard".to_string(),
            session_key: "topic:chan-1:topic-1:standard".to_string(),
            channel_id: "chan-1".to_string(),
            workspace_binding_id: "ws-topic-1".to_string(),
            owner_dir: PathBuf::from("/tmp/chan-1"),
            workspace_dir: PathBuf::from("/tmp/chan-1"),
            artifact_root: PathBuf::from("/tmp/chan-1/artifacts"),
            system_prompt: Some("system".to_string()),
            mcp_pool_key: "chan-1::/tmp/chan-1".to_string(),
        };

        {
            let mut store = SessionStore::new(&db_path).expect("open store");
            store
                .upsert_session(&session, true)
                .expect("persist session");
            store
                .append_exchange(&session.session_id, "question", "answer")
                .expect("append exchange");
        }

        {
            let store = SessionStore::new(&db_path).expect("reopen store");
            let restored = store
                .get_session(&session.session_id)
                .expect("load session")
                .expect("session should exist");
            assert_eq!(restored, session);
            let messages = store
                .load_recent_messages(&session.session_id, 24)
                .expect("load history");
            assert_eq!(messages.len(), 2);
            assert_eq!(messages[0].role, "user");
            assert_eq!(messages[0].content, "question");
            assert_eq!(messages[1].role, "assistant");
            assert_eq!(messages[1].content, "answer");
        }

        {
            let mut store = SessionStore::new(&db_path).expect("reopen store for delete");
            store
                .delete_session(&session.session_id)
                .expect("delete session");
            assert!(store
                .get_session(&session.session_id)
                .expect("query deleted session")
                .is_none());
            assert!(store
                .load_recent_messages(&session.session_id, 24)
                .expect("history after delete")
                .is_empty());
        }

        let _ = std::fs::remove_file(&db_path);
        let _ = std::fs::remove_file(format!("{}-wal", db_path));
        let _ = std::fs::remove_file(format!("{}-shm", db_path));
    }
}
