"""Tests for SageSearch Multi-Recipe Mock and Live Pipeline Execution."""
import pytest
from agent.state import TaskStateManager
from agent.core import SageSearchAgent


def test_mock_pipeline_receipts():
    mgr = TaskStateManager(use_firestore=False)
    agent = SageSearchAgent(state_manager=mgr, mock_mode=True)

    state = agent.execute_goal(
        "Find all gym and travel receipts from last month and create expense report CSV",
        auto_approve=False
    )
    assert state.status == "waiting_approval"
    assert state.preview_data is not None
    assert len(state.preview_data["rows"]) >= 3
    assert state.total_steps == 5

    resumed = agent.resume_task(state.task_id, approved=True)
    assert resumed.status == "completed"
    assert len(resumed.artifacts) == 1
    assert "expense_report_july_2026.csv" in resumed.artifacts[0]["filename"]


def test_mock_pipeline_project_specs():
    mgr = TaskStateManager(use_firestore=False)
    agent = SageSearchAgent(state_manager=mgr, mock_mode=True)

    state = agent.execute_goal(
        "Find all project specification documents from last week and compile a structured summary report",
        auto_approve=False
    )
    assert state.status == "waiting_approval"
    assert state.preview_data is not None
    assert "Document Title" in state.preview_data["columns"]
    assert state.preview_data["summary"]["format"] == "Markdown"

    resumed = agent.resume_task(state.task_id, approved=True)
    assert resumed.status == "completed"
    assert len(resumed.artifacts) == 1
    assert "project_specs_summary.md" in resumed.artifacts[0]["filename"]


def test_mock_pipeline_contractor_invoices():
    mgr = TaskStateManager(use_firestore=False)
    agent = SageSearchAgent(state_manager=mgr, mock_mode=True)

    state = agent.execute_goal(
        "Find all contractor invoices and compile an itemized payment schedule",
        auto_approve=False
    )
    assert state.status == "waiting_approval"
    assert state.preview_data is not None
    assert "Contractor / Vendor" in state.preview_data["columns"]

    resumed = agent.resume_task(state.task_id, approved=True)
    assert resumed.status == "completed"
    assert len(resumed.artifacts) == 1
    assert "contractor_payment_schedule.csv" in resumed.artifacts[0]["filename"]


@pytest.mark.asyncio
async def test_async_mock_pipeline_events():
    events = []
    def event_collector(event_type, data):
        events.append((event_type, data))

    mgr = TaskStateManager(use_firestore=False)
    agent = SageSearchAgent(state_manager=mgr, event_callback=event_collector, mock_mode=True)

    state = await agent.execute_goal_async(
        "Find all project specification documents and compile summary report",
        auto_approve=False
    )
    assert state.status == "waiting_approval"
    assert any(e[0] == "task_started" for e in events)
    assert any(e[0] == "approval_request" for e in events)

    resumed = await agent.resume_task_async(state.task_id, approved=True)
    assert resumed.status == "completed"
    assert any(e[0] == "task_completed" for e in events)
