use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};

struct TestDir(PathBuf);

impl TestDir {
    fn new(name: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "shadow_crew_agent_resume_e2e_{}_{}_{}",
            name,
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        std::fs::create_dir_all(&path).expect("create test directory");
        Self(path)
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

struct AgentProc {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    next_id: u64,
}

impl AgentProc {
    fn spawn(home: &Path, agent_id: &str) -> Self {
        let binary = env!("CARGO_BIN_EXE_shadow-crew-agent");
        let mut child = Command::new(binary)
            .env("HOME", home)
            .env("USERPROFILE", home)
            .env("SHADOW_CREW_AGENT_ID", agent_id)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn native ACP agent");
        let stdin = child.stdin.take().expect("agent stdin");
        let stdout = BufReader::new(child.stdout.take().expect("agent stdout"));
        Self {
            child,
            stdin,
            stdout,
            next_id: 0,
        }
    }

    fn rpc(&mut self, method: &str, params: Value) -> Value {
        self.next_id += 1;
        let id = self.next_id;
        let request = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        });
        writeln!(self.stdin, "{}", request).expect("write agent request");
        self.stdin.flush().expect("flush agent request");

        loop {
            let mut line = String::new();
            let read = self
                .stdout
                .read_line(&mut line)
                .expect("read agent response");
            assert!(read > 0, "agent closed stdout while waiting for {method}");
            let value: Value = serde_json::from_str(line.trim()).expect("parse agent response");
            if value.get("id").and_then(Value::as_u64) == Some(id) {
                return value;
            }
        }
    }

    fn stop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl Drop for AgentProc {
    fn drop(&mut self) {
        self.stop();
    }
}

#[test]
fn native_agent_resume_survives_restart_and_persists_active_updates() {
    let test_dir = TestDir::new("active_resume");
    let home = test_dir.path().join("home");
    std::fs::create_dir_all(&home).expect("create agent home");
    let agent_id = format!("agent_e2e_{}", std::process::id());
    let channel_id = "chan-e2e";
    let workspace = home.join(".shadow-crew").join("channels").join(channel_id);
    let subtopic_workspace = workspace.join("sub-topic");
    std::fs::create_dir_all(&subtopic_workspace).expect("create workspace");

    let mut agent = AgentProc::spawn(&home, &agent_id);
    let initialize = agent.rpc(
        "initialize",
        json!({
            "protocolVersion": 1,
            "clientCapabilities": {},
            "clientInfo": { "name": "native-resume-e2e", "version": "1.0.0" }
        }),
    );
    assert!(
        initialize["result"]["agentCapabilities"]["sessionCapabilities"]["resume"].is_object(),
        "native agent must advertise session/resume"
    );

    let created = agent.rpc(
        "session/new",
        json!({
            "cwd": workspace,
            "mcpServers": [],
            "sessionKey": format!("channel:{channel_id}:thread-1"),
            "channelId": channel_id,
            "systemPrompt": "OLD-SYSTEM"
        }),
    );
    let session_id = created["result"]["sessionId"]
        .as_str()
        .expect("session/new must return sessionId")
        .to_string();

    let session_db = home
        .join(".shadow-crew")
        .join("cache")
        .join("native-agent-sessions")
        .join(format!("{agent_id}.sqlite"));
    let conn = rusqlite::Connection::open(&session_db).expect("open native session db");
    conn.execute(
        "INSERT INTO native_agent_messages (session_id, role, content, created_at)
         VALUES (?1, 'user', 'historical user turn', 1000)",
        rusqlite::params![session_id],
    )
    .expect("insert historical message");
    drop(conn);

    let outside_workspace = test_dir.path().join("outside");
    std::fs::create_dir_all(&outside_workspace).expect("create outside workspace");
    let rejected_resume = agent.rpc(
        "session/resume",
        json!({
            "sessionId": session_id,
            "cwd": outside_workspace,
            "mcpServers": [],
            "systemPrompt": "SHOULD-NOT-PERSIST"
        }),
    );
    assert_eq!(rejected_resume["error"]["code"], -32602);

    let active_resume = agent.rpc(
        "session/resume",
        json!({
            "sessionId": session_id,
            "cwd": subtopic_workspace,
            "mcpServers": [],
            "systemPrompt": "NEW-SYSTEM"
        }),
    );
    assert!(
        active_resume.get("error").is_none(),
        "active resume must succeed"
    );
    agent.stop();

    let session_db = home
        .join(".shadow-crew")
        .join("cache")
        .join("native-agent-sessions")
        .join(format!("{agent_id}.sqlite"));
    let conn = rusqlite::Connection::open(&session_db).expect("open native session db");
    let (persisted_cwd, persisted_prompt, persisted_mcp_pool_key): (String, String, String) = conn
        .query_row(
            "SELECT workspace_dir, system_prompt, mcp_pool_key
             FROM native_agent_sessions
             WHERE session_id = ?1",
            rusqlite::params![session_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .expect("query persisted session");
    let msg_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM native_agent_messages WHERE session_id = ?1",
            rusqlite::params![session_id],
            |row| row.get(0),
        )
        .expect("count messages");
    assert_eq!(msg_count, 1, "active resume must preserve historical messages");
    let expected_cwd =
        std::fs::canonicalize(&subtopic_workspace).expect("canonicalize subtopic workspace");
    assert_eq!(PathBuf::from(persisted_cwd), expected_cwd);
    assert_eq!(persisted_prompt, "NEW-SYSTEM");
    assert_eq!(
        persisted_mcp_pool_key,
        format!("{}::{}", channel_id, expected_cwd.to_string_lossy())
    );
    drop(conn);

    let mut restarted = AgentProc::spawn(&home, &agent_id);
    restarted.rpc(
        "initialize",
        json!({
            "protocolVersion": 1,
            "clientCapabilities": {},
            "clientInfo": { "name": "native-resume-e2e", "version": "1.0.0" }
        }),
    );
    let resumed = restarted.rpc(
        "session/resume",
        json!({
            "sessionId": session_id,
            "cwd": subtopic_workspace,
            "mcpServers": []
        }),
    );
    assert!(
        resumed.get("error").is_none(),
        "restart resume must succeed"
    );
    let closed = restarted.rpc("session/close", json!({ "sessionId": session_id }));
    assert_eq!(closed["result"]["closed"], true);
    restarted.stop();

    let conn = rusqlite::Connection::open(&session_db).expect("open native session db after close");
    let closed_msg_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM native_agent_messages WHERE session_id = ?1",
            rusqlite::params![session_id],
            |row| row.get(0),
        )
        .expect("count messages after close");
    assert_eq!(closed_msg_count, 0, "session/close must clean up historical messages");
    drop(conn);

    let mut after_close = AgentProc::spawn(&home, &agent_id);
    after_close.rpc(
        "initialize",
        json!({
            "protocolVersion": 1,
            "clientCapabilities": {},
            "clientInfo": { "name": "native-resume-e2e", "version": "1.0.0" }
        }),
    );
    let closed_resume = after_close.rpc(
        "session/resume",
        json!({
            "sessionId": session_id,
            "cwd": subtopic_workspace,
            "mcpServers": []
        }),
    );
    assert_eq!(closed_resume["error"]["code"], -32002);
}
