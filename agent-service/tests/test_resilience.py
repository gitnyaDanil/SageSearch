"""Tests for SageSearch resilience, error handling, and fallback mechanisms."""
import pytest
from agent.extractor import StructuredFieldExtractor
from agent.artifacts import ArtifactBuilder
from agent.bridge import WebSocketBridgeManager
from agent.core import SageSearchAgent, artifact_creation_error
from agent.state import TaskStateManager


def test_extractor_resilience_empty_and_garbage():
    ext = StructuredFieldExtractor(api_key=None, use_vertex=False)
    
    # Empty string
    res_empty = ext.extract_from_text("")
    assert res_empty["status"] == "empty_content"
    assert "merchant" in res_empty["extracted_data"]

    # Garbage / unstructured text
    res_garbage = ext.extract_from_text("Random non-invoice content with no numbers")
    assert res_garbage["status"] == "success"
    assert res_garbage["extracted_data"]["amount"] == 0.0


def test_artifact_builder_generic_tables():
    cols = ["Item", "Quantity", "Price"]
    rows = [["Widget A", 2, "$10.00"], ["Widget B", 1, "$25.00"]]
    
    csv_out = ArtifactBuilder.build_generic_csv(cols, rows, summary={"total_items": 3})
    assert "Item,Quantity,Price" in csv_out
    assert "Widget A,2,$10.00" in csv_out
    assert "Summary: total_items=3" in csv_out

    md_out = ArtifactBuilder.build_generic_markdown("Test Report", cols, rows, summary={"total_items": 3})
    assert "# Test Report" in md_out
    assert "| Item | Quantity | Price |" in md_out
    assert "| Widget A | 2 | $10.00 |" in md_out


def test_artifact_creation_error_helper():
    assert artifact_creation_error({"status": "created", "saved_path": "C:/out.crv"}) is None
    assert artifact_creation_error({"status": "error", "error": "Disk full"}) == "Disk full"
    assert artifact_creation_error(None) is not None
    assert artifact_creation_error({}) is not None


def test_bridge_disconnected_fallback():
    bridge = WebSocketBridgeManager()
    assert not bridge.is_client_connected

    import asyncio
    res = asyncio.run(bridge.dispatch_tool_call("create_artifact", {"filename": "test.crv", "content_type": "text/csv", "data": "a,b"}))
    assert res["status"] == "error"
    assert "not connected" in res["error"]
