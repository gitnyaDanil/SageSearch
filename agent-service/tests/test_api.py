"""API tests for SageSearch FastAPI service."""
import pytest
from fastapi.testclient import TestClient
from api.server import app

client = TestClient(app)


def test_health_endpoint():
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert data["service"] == "sagesearch-agent"


def test_create_and_poll_task():
    # 1. Create task
    payload = {
        "goal": "Find all gym and travel receipts from last month and create expense report CSV",
        "auto_approve": False
    }
    create_res = client.post("/tasks", json=payload)
    assert create_res.status_code == 200
    task_data = create_res.json()
    task_id = task_data["task_id"]
    assert task_data["status"] == "waiting_approval"
    assert task_data["preview_data"] is not None

    # 2. Get task status
    get_res = client.get(f"/tasks/{task_id}")
    assert get_res.status_code == 200
    assert get_res.json()["task_id"] == task_id

    # 3. Respond with approval
    respond_res = client.post(f"/tasks/{task_id}/respond", json={"approved": True})
    assert respond_res.status_code == 200
    completed_data = respond_res.json()
    assert completed_data["status"] == "completed"
    assert len(completed_data["artifacts"]) == 1
    assert completed_data["artifacts"][0]["filename"] == "expense_report_july_2026.csv"


def test_get_nonexistent_task():
    response = client.get("/tasks/non-existent-uuid-12345")
    assert response.status_code == 404
