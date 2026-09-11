use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    response::IntoResponse,
};
use futures_util::{SinkExt, StreamExt};
use shinobi_protocol::NostrChannelEvent;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};

pub struct RelayState {
    // 按 room_id 分组广播事件
    pub channels: RwLock<HashMap<String, broadcast::Sender<NostrChannelEvent>>>,
}

impl RelayState {
    pub fn new() -> Self {
        Self {
            channels: RwLock::new(HashMap::new()),
        }
    }

    pub async fn get_or_create_sender(&self, room_id: &str) -> broadcast::Sender<NostrChannelEvent> {
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
            if sender.send(Message::Text(json.into())).await.is_err() {
                break;
            }
        }
    });

    // 接收客户端上报的事件
    let mut recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = receiver.next().await {
            if let Message::Text(text) = msg {
                if let Ok(event) = serde_json::from_str::<NostrChannelEvent>(&text) {
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
