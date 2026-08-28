"""Unit and integration tests for SageSearch Agent Core and Tools."""
import pytest
from agent.tools import TOOL_DECLARATIONS, SearchFilesParams, ExtractFieldsParams
from agent.stubs import (
    stub_search_files,
    stub_read_file_content,
    stub_extract_fields,
    stub_ask_user,
    stub_create_artifact
)
from agent.state import TaskStateManager
from agent.core import SageSearchAgent


def test_tool_declarations_structure():
    """Verifies all 5 required tools are present with OpenAPI object schemas."""
    tool_names = [t["name"] for t in TOOL_DECLARATIONS]
    assert "search_files" in tool_names
    assert "read_file_content" in tool_names
    assert "extract_fields" in tool_names
    assert "ask_user" in tool_names
    assert "create_artifact" in tool_names

    for tool in TOOL_DECLARATIONS:
        assert "description" in tool
        assert "parameters" in tool
        assert tool["parameters"]["type"] == "OBJECT"


def test_mock_stubs_search_and_read():
    """Verifies mock search and read functionality."""
    results = stub_search_files(query="receipt gym travel", file_types=["pdf"])
    assert len(results) >= 3
    paths = [r["path"] for r in results]
    assert any("fit_gym" in p for p in paths)

    first_file = results[0]["path"]
    read_data = stub_read_file_content(path=first_file)
    assert read_data["status"] == "success"
    assert "FITNESS FIRST" in read_data["content"] or "DELTA" in read_data["content"] or "HILTON" in read_data["content"]


def test_mock_stubs_extract_and_artifact():
    """Verifies mock extraction and CSV artifact generation."""
    sample_text = "FITNESS FIRST CLUB Date: 2026-07-02 Total Paid: $81.00"
    ext = stub_extract_fields(content=sample_text, fields=["merchant", "date", "amount"])
    assert ext["status"] == "success"
    assert ext["extracted_data"]["merchant"] == "Fitness First"
    assert ext["extracted_data"]["amount"] == 81.00

    art = stub_create_artifact(
        filename="test_report.csv",
        content_type="text/csv",
        data="Merchant,Amount\nFitness First,81.00"
    )
    assert art["status"] == "created"
    assert art["byte_count"] > 0


def test_agent_end_to_end_workflow():
    """Tests full autonomous flow: goal -> planning -> steps -> pause for approval -> approve -> CSV artifact."""
    state_mgr = TaskStateManager(use_firestore=False)
    agent = SageSearchAgent(state_manager=state_mgr, mock_mode=True)

    goal = "Find all gym and travel receipts from last month, extract the amounts, and create an expense report CSV"
    
    # 1. Execute goal (should pause at waiting_approval)
    state = agent.execute_goal(goal=goal, auto_approve=False)

    assert state.status == "waiting_approval"
    assert len(state.steps) >= 3
    assert state.preview_data is not None
    assert "rows" in state.preview_data
    assert len(state.preview_data["rows"]) >= 3

    # Check total expense in preview summary
    summary = state.preview_data["summary"]
    assert summary["total_receipts"] >= 3
    assert "$" in summary["total_expense"]

    # 2. Resume task with user approval
    final_state = agent.resume_task(task_id=state.task_id, approved=True)

    assert final_state.status == "completed"
    assert len(final_state.artifacts) == 1
    assert final_state.artifacts[0]["filename"] == "expense_report_july_2026.csv"
    assert "Successfully processed" in final_state.final_summary


def test_agent_user_cancellation():
    """Verifies that rejecting approval transitions status to canceled."""
    state_mgr = TaskStateManager(use_firestore=False)
    agent = SageSearchAgent(state_manager=state_mgr, mock_mode=True)

    state = agent.execute_goal(goal="Find receipts and build report", auto_approve=False)
    assert state.status == "waiting_approval"

    canceled_state = agent.resume_task(task_id=state.task_id, approved=False, user_feedback="User declined preview")
    assert canceled_state.status == "canceled"
    assert "cancelled by the user" in canceled_state.final_summary
