mod relay;

use axum::{
    routing::get,
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
        .route("/health", get(|| async { "Shinobi Relay Online (Rust Axum)" }))
        .route("/relay", get(relay::ws_relay_handler))
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(relay_state);

    let addr = SocketAddr::from(([0, 0, 0, 0], 8080));
    tracing::info!("🥷 Shinobi Rust Nostr Relay listening on ws://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
