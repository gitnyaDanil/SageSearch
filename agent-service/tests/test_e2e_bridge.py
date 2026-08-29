"""End-to-end integration test for WebSocket bridge events."""
import json
from fastapi.testclient import TestClient
from api.server import app, bridge_manager, agent
from agent.stubs import stub_search_files, stub_read_file_content, stub_create_artifact


async def desktop_tool_executor(tool, params):
    """Provide deterministic desktop results while the bridge is connected."""
    if tool == "search_files":
        return stub_search_files(**params)
    if tool == "read_file_content":
        return stub_read_file_content(**params)
    if tool == "create_artifact":
        return stub_create_artifact(**params)
    return {"status": "error", "error": f"Unsupported test tool: {tool}"}


def test_full_bridge_tool_execution_flow():
    client = TestClient(app)
    original_executor = agent.async_tool_executor
    original_mock = agent.mock_mode
    agent.async_tool_executor = desktop_tool_executor
    agent.mock_mode = True

    try:
        with client.websocket_connect("/ws/bridge?client_id=desktop-e2e") as ws:
            assert bridge_manager.is_client_connected

            ws.send_text(json.dumps({
                "type": "handshake",
                "client_info": {"app": "SageSearch Desktop", "version": "1.0.0"}
            }))
            ack = ws.receive_json()
            assert ack["type"] == "handshake_ack"

            goal = "Find gym and travel receipts and create expense report CSV"
            res = client.post("/tasks", json={"goal": goal, "auto_approve": False})
            assert res.status_code == 200
            task_data = res.json()
            assert task_data["status"] == "waiting_approval"
            assert task_data["preview_data"] is not None

            task_id = task_data["task_id"]
            approve_res = client.post(f"/tasks/{task_id}/respond", json={"approved": True})
            assert approve_res.status_code == 200
            final_data = approve_res.json()
            assert final_data["status"] == "completed"
            assert len(final_data["artifacts"]) == 1
            assert "expense_report_july_2026.csv" in final_data["artifacts"][0]["filename"]
    finally:
        agent.async_tool_executor = original_executor
        agent.mock_mode = original_mock
