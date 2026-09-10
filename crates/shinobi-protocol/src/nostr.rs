use serde::{Deserialize, Serialize};

/// Nostr Kind 42 聊天事件 (用于分布式多 Agent 会话同步与加密验签)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NostrChannelEvent {
    pub id: String,
    pub pubkey: String,
    pub created_at: u64,
    pub kind: u16, // Kind 42: Channel Message
    pub tags: Vec<Vec<String>>,
    pub content: String,
    pub sig: String,
}

impl NostrChannelEvent {
    pub fn new(pubkey: String, room_id: String, content: String, sig: String) -> Self {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        Self {
            id: format!("event_{}_{}", pubkey, now),
            pubkey,
            created_at: now,
            kind: 42,
            tags: vec![
                vec!["e".to_string(), room_id],
                vec!["p".to_string(), "shinobi_hivemind".to_string()],
            ],
            content,
            sig,
        }
    }
}
