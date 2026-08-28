"""Tests for WebSocket Bridge protocol and remote tool dispatching."""
import json
import pytest
from fastapi.testclient import TestClient
from api.server import app, bridge_manager


def test_websocket_handshake():
    client = TestClient(app)
    with client.websocket_connect("/ws/bridge?client_id=test-client") as websocket:
        # Send handshake
        websocket.send_text(json.dumps({
            "type": "handshake",
            "client_info": {"app": "SageSearch Desktop", "version": "1.0.0"}
        }))

        response = websocket.receive_json()
        assert response["type"] == "handshake_ack"
        assert response["status"] == "ready"
        assert "search_files" in response["supported_tools"]


def test_websocket_tool_call_rpc():
    client = TestClient(app)
    with client.websocket_connect("/ws/bridge?client_id=test-client") as websocket:
        assert bridge_manager.is_client_connected

        # Send ping
        websocket.send_text(json.dumps({"type": "ping", "timestamp": 123456}))
        pong = websocket.receive_json()
        assert pong["type"] == "pong"
        assert pong["timestamp"] == 123456


def test_bridge_fallback_when_no_client():
    import asyncio
    from agent.bridge import WebSocketBridgeManager
    bridge = WebSocketBridgeManager()
    assert not bridge.is_client_connected

    async def _test():
        return await bridge.dispatch_tool_call("search_files", {"query": "receipt gym", "file_types": ["pdf"]})

    result = asyncio.run(_test())
    assert len(result) >= 1
    assert any("fit_gym" in r["path"] for r in result)
