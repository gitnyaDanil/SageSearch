"""End-to-end integration test for WebSocket Bridge tool execution."""
import json
import pytest
from fastapi.testclient import TestClient
from api.server import app, bridge_manager, agent


def test_full_bridge_tool_execution_flow():
    client = TestClient(app)

    with client.websocket_connect("/ws/bridge?client_id=desktop-e2e") as ws:
        assert bridge_manager.is_client_connected

        # Send handshake
        ws.send_text(json.dumps({
            "type": "handshake",
            "client_info": {"app": "SageSearch Desktop", "version": "1.0.0"}
        }))
        ack = ws.receive_json()
        assert ack["type"] == "handshake_ack"

        # Now launch a task in background / via test
        goal = "Find gym and travel receipts and create expense report CSV"
        
        # Start task
        res = client.post("/tasks", json={"goal": goal, "auto_approve": False})
        assert res.status_code == 200
        task_data = res.json()
        assert task_data["status"] == "waiting_approval"
        assert task_data["preview_data"] is not None

        # Verify bridge received broadcast events
        task_id = task_data["task_id"]

        # Approve task
        approve_res = client.post(f"/tasks/{task_id}/respond", json={"approved": True})
        assert approve_res.status_code == 200
        final_data = approve_res.json()
        assert final_data["status"] == "completed"
        assert len(final_data["artifacts"]) == 1
        assert "expense_report_july_2026.csv" in final_data["artifacts"][0]["filename"]
