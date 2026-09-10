#!/usr/bin/env bash
set -e

echo "=== 🥷 Initializing Shinobi Multi-Agent Platform (Rust + Tauri) ==="

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
cargo build -p shinobi-protocol

echo "-> Starting Shinobi Rust Nostr Relay in background (port 8080)..."
cargo run -p shinobi-server &
SERVER_PID=$!
echo "Relay PID: $SERVER_PID"

echo "-> Launching Tauri Desktop Frontend in dev mode..."
npm install
npm run tauri dev || npm run dev

# Clean up background server on exit
kill $SERVER_PID 2>/dev/null || true
echo "=== Shinobi dev session closed. ==="
