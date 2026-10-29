#!/usr/bin/env python3
"""Minimal ACP stdio fixture for exercising session/request_permission."""

import json
import os
import sys
import uuid


def send(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


workspace = os.getcwd()
prompt_request_id = None
permission_request_id = 900001
active_session_id = None
pending_prompt_blocks = []

for line in sys.stdin:
    try:
        message = json.loads(line)
    except json.JSONDecodeError:
        continue

    method = message.get("method")
    request_id = message.get("id")
    params = message.get("params") or {}

    if method == "initialize":
        send({
            "jsonrpc": "2.0",
            "id": request_id,
            "result": {
                "protocolVersion": 1,
                "agentCapabilities": {
                    "loadSession": False,
                    "sessions": {"resume": False},
                    "promptCapabilities": {
                        "image": True,
                        "embeddedContext": True
                    }
                }
            }
        })
    elif method == "session/new":
        workspace = params.get("cwd") or workspace
        active_session_id = str(uuid.uuid4())
        send({
            "jsonrpc": "2.0",
            "id": request_id,
            "result": {"sessionId": active_session_id}
        })
    elif method == "session/prompt":
        prompt_request_id = request_id
        active_session_id = params.get("sessionId") or active_session_id
        pending_prompt_blocks = params.get("prompt") or []
        permission_request_id += 1
        target = os.path.join(workspace, "permission-e2e.txt")
        send({
            "jsonrpc": "2.0",
            "id": permission_request_id,
            "method": "session/request_permission",
            "params": {
                "sessionId": params.get("sessionId"),
                "toolCall": {
                    "toolCallId": "fake-write-1",
                    "name": "Write",
                    "title": "Write permission-e2e.txt",
                    "kind": "edit",
                    "status": "pending",
                    "rawInput": {"file_path": target, "content": "allowed\n"},
                    "locations": [{"path": target}]
                },
                "options": [
                    {
                        "optionId": "allow-once",
                        "name": "Allow once",
                        "kind": "allow_once"
                    },
                    {
                        "optionId": "reject",
                        "name": "Reject",
                        "kind": "reject_once"
                    }
                ],
                "_meta": {
                    "permission": {
                        "version": 1,
                        "title": "Fake ACP write test",
                        "description": "Fixture requests permission before writing a test file."
                    }
                }
            }
        })
    elif request_id == permission_request_id and "result" in message:
        outcome = message["result"].get("outcome") or {}
        selected = outcome.get("optionId")
        target = os.path.join(workspace, "permission-e2e.txt")
        if outcome.get("outcome") == "selected" and selected == "allow-once":
            with open(target, "w", encoding="utf-8") as handle:
                handle.write("allowed\n")
            block_types = ",".join(
                str(block.get("type", "unknown")) for block in pending_prompt_blocks
            )
            reply = f"FAKE_ACP_ALLOWED:{target};blocks={block_types}"
        else:
            reply = "FAKE_ACP_DENIED"
        send({
            "jsonrpc": "2.0",
            "method": "session/update",
            "params": {
                "sessionId": active_session_id,
                "update": {
                    "sessionUpdate": "agent_message_chunk",
                    "content": {"type": "text", "text": reply}
                }
            }
        })
        send({
            "jsonrpc": "2.0",
            "id": prompt_request_id,
            "result": {"text_response": reply, "stopReason": "end_turn"}
        })
        prompt_request_id = None
    elif request_id is not None:
        send({
            "jsonrpc": "2.0",
            "id": request_id,
            "error": {"code": -32601, "message": "Unsupported fixture method"}
        })
