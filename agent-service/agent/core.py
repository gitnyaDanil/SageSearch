"""Autonomous Agent Core engine orchestrating multi-step file workflows."""
import os
import json
import asyncio
from typing import Any, Callable, Dict, List, Optional
from datetime import datetime, timezone

from .prompts import SYSTEM_INSTRUCTION
from .tools import TOOL_DECLARATIONS
from .stubs import (
    stub_search_files,
    stub_read_file_content,
    stub_extract_fields,
    stub_ask_user,
    stub_create_artifact
)
from .extractor import StructuredFieldExtractor
from .artifacts import ArtifactBuilder
from .state import TaskStateManager, TaskState


def _safe_float(val: Any) -> float:
    if isinstance(val, (int, float)):
        return float(val)
    if not val:
        return 0.0
    s = str(val).replace("$", "").replace(",", "").strip()
    try:
        return float(s)
    except Exception:
        return 0.0


def artifact_creation_error(result: Any) -> Optional[str]:
    """Return an error when a tool response does not prove local creation."""
    if isinstance(result, dict) and result.get("status") == "created" and result.get("saved_path"):
        return None
    if isinstance(result, dict):
        return result.get("error") or "The artifact tool did not confirm that a file was created."
    return "The artifact tool returned an invalid creation response."

try:
    from google import genai
    from google.genai import types
    GENAI_AVAILABLE = True
except ImportError:
    GENAI_AVAILABLE = False


class SageSearchAgent:
    """The autonomous taskmaster agent powered by Gemini and local/mock file tools."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        model_name: Optional[str] = None,
        state_manager: Optional[TaskStateManager] = None,
        tool_executor: Optional[Callable[[str, Dict[str, Any]], Any]] = None,
        async_tool_executor: Optional[Callable[[str, Dict[str, Any]], Any]] = None,
        event_callback: Optional[Callable[[str, Dict[str, Any]], Any]] = None,
        mock_mode: Optional[bool] = None
    ):
        self.api_key = api_key or os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
        self.model_name = model_name or os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
        self.state_manager = state_manager or TaskStateManager()
        self.tool_executor = tool_executor or self._default_tool_dispatcher
        self.async_tool_executor = async_tool_executor
        self.event_callback = event_callback

        self.use_vertex = os.environ.get("USE_VERTEX_AI", "false").lower() == "true" or os.environ.get("GOOGLE_GENAI_USE_VERTEXAI", "false").lower() == "true"
        self.project = os.environ.get("GCP_PROJECT") or os.environ.get("GOOGLE_CLOUD_PROJECT") or "sagesearch-gcp"
        self.location = os.environ.get("GCP_REGION") or os.environ.get("GOOGLE_CLOUD_LOCATION", "us-central1")

        if mock_mode is not None:
            self.mock_mode = mock_mode
        else:
            self.mock_mode = not bool((self.api_key or self.use_vertex) and GENAI_AVAILABLE)

        self.extractor = StructuredFieldExtractor(
            api_key=self.api_key if not self.mock_mode else None,
            model_name=self.model_name,
            use_vertex=self.use_vertex if not self.mock_mode else False
        )
        self._active_chats: Dict[str, Any] = {}

        self.client = None
        if not self.mock_mode and GENAI_AVAILABLE:
            try:
                if self.use_vertex:
                    self.client = genai.Client(vertexai=True, project=self.project, location=self.location)
                elif self.api_key:
                    self.client = genai.Client(api_key=self.api_key)
            except Exception as e:
                print(f"[SageSearchAgent] Gemini client init error: {e}. Defaulting to mock engine.")
                self.mock_mode = True

    def _default_tool_dispatcher(self, tool_name: str, args: Dict[str, Any]) -> Any:
        """Dispatches tool calls to local mock stubs."""
        if tool_name == "search_files":
            return stub_search_files(**args)
        elif tool_name == "read_file_content":
            return stub_read_file_content(**args)
        elif tool_name == "extract_fields":
            return self.extractor.extract_from_text(
                content=args.get("content", ""),
                fields=args.get("fields"),
                instructions=args.get("instructions")
            )
        elif tool_name == "ask_user":
            return stub_ask_user(**args)
        elif tool_name == "create_artifact":
            return stub_create_artifact(**args)
        else:
            raise ValueError(f"Unknown tool: {tool_name}")

    def _get_system_instructions(self, user_id: str = "default_user") -> str:
        """Builds system prompt injected with persistent user preferences from Memory Bank."""
        memory = self.state_manager.get_user_memory(user_id)
        memory_str = (
            f"\n\nUSER PREFERENCES & MEMORY:\n"
            f"- Default Currency: {memory.get('default_currency', 'USD')}\n"
            f"- Preferred Export Format: {memory.get('preferred_export_format', 'csv')}\n"
            f"- Learned Expense Categories: {', '.join(memory.get('learned_categories', []))}\n"
        )
        return SYSTEM_INSTRUCTION + memory_str

    async def _emit_event(self, event_type: str, data: Dict[str, Any]) -> None:
        if self.event_callback:
            try:
                res = self.event_callback(event_type, data)
                if asyncio.iscoroutine(res):
                    await res
            except Exception as e:
                print(f"[SageSearchAgent] Event callback error: {e}")

    async def _dispatch_tool(self, tool_name: str, args: Dict[str, Any]) -> Any:
        if tool_name == "extract_fields":
            return self.extractor.extract_from_text(
                content=args.get("content", ""),
                fields=args.get("fields"),
                instructions=args.get("instructions")
            )

        if self.async_tool_executor:
            res = self.async_tool_executor(tool_name, args)
            if asyncio.iscoroutine(res):
                return await res
            return res
        return self.tool_executor(tool_name, args)

    def execute_goal(self, goal: str, task_id: Optional[str] = None, auto_approve: bool = False) -> TaskState:
        """Synchronous goal execution wrapper."""
        state = self.state_manager.create_task(goal=goal, task_id=task_id)
        task_id = state.task_id
        self.state_manager.update_status(task_id, "planning")

        if self.mock_mode or not self.client:
            return self._execute_mock_pipeline(state, auto_approve=auto_approve)
        else:
            return self._execute_live_pipeline(state, auto_approve=auto_approve)

    async def execute_goal_async(self, goal: str, task_id: Optional[str] = None, auto_approve: bool = False) -> TaskState:
        """Asynchronous goal execution integrating with WebSocket bridge."""
        state = self.state_manager.create_task(goal=goal, task_id=task_id)
        task_id = state.task_id
        self.state_manager.update_status(task_id, "planning")
        await self._emit_event("task_started", {"task_id": task_id, "goal": goal})

        if self.mock_mode or not self.client:
            return await self._execute_mock_pipeline_async(state, auto_approve=auto_approve)
        else:
            return await self._execute_live_pipeline_async(state, auto_approve=auto_approve)

    def _execute_mock_pipeline(self, state: TaskState, auto_approve: bool = False) -> TaskState:
        """Deterministic mock execution supporting multiple task types."""
        task_id = state.task_id
        goal_lower = state.goal.lower()
        is_spec = "spec" in goal_lower or "requirement" in goal_lower
        is_invoice = ("contractor" in goal_lower or "invoice" in goal_lower or "payment" in goal_lower) and not ("receipt" in goal_lower)

        if is_spec:
            return self._execute_mock_spec_pipeline(state, auto_approve=auto_approve)
        elif is_invoice:
            return self._execute_mock_invoice_pipeline(state, auto_approve=auto_approve)
        else:
            return self._execute_mock_receipt_pipeline(state, auto_approve=auto_approve)

    async def _execute_mock_pipeline_async(self, state: TaskState, auto_approve: bool = False) -> TaskState:
        """Async mock execution sending real-time events over WebSocket."""
        task_id = state.task_id
        goal_lower = state.goal.lower()
        is_spec = "spec" in goal_lower or "requirement" in goal_lower
        is_invoice = ("contractor" in goal_lower or "invoice" in goal_lower or "payment" in goal_lower) and not ("receipt" in goal_lower)

        if is_spec:
            return await self._execute_mock_spec_pipeline_async(state, auto_approve=auto_approve)
        elif is_invoice:
            return await self._execute_mock_invoice_pipeline_async(state, auto_approve=auto_approve)
        else:
            return await self._execute_mock_receipt_pipeline_async(state, auto_approve=auto_approve)

    def _execute_mock_receipt_pipeline(self, state: TaskState, auto_approve: bool = False) -> TaskState:
        task_id = state.task_id
        state.plan_overview = "1. Search receipts -> 2. Read contents -> 3. Extract fields -> 4. Compile preview -> 5. User approval -> 6. Generate CSV"
        state.total_steps = 5
        self.state_manager.save_task(state)

        step1 = self.state_manager.add_step(
            task_id,
            title="Search local index for receipt files",
            tool_name="search_files",
            tool_args={"query": "receipt", "file_types": ["pdf", "txt"]}
        )
        search_results = self.tool_executor("search_files", {"query": "receipt", "file_types": ["pdf", "txt"]})
        if not search_results:
            search_results = stub_search_files(query="receipt")
        
        # Deduplicate stems
        unique_results = []
        seen_stems = set()
        for item in search_results:
            stem = os.path.splitext(item.get("name", ""))[0]
            if stem and stem in seen_stems:
                continue
            if stem:
                seen_stems.add(stem)
            unique_results.append(item)
        search_results = unique_results

        self.state_manager.complete_step(task_id, step1.step_index, search_results)

        extracted_rows = []
        for item in search_results:
            read_res = self.tool_executor("read_file_content", {"path": item["path"]})
            ext_res = self.extractor.extract_from_text(
                content=read_res.get("content", ""),
                fields=["merchant", "date", "amount", "category"]
            )
            data = ext_res.get("extracted_data", {})
            data["file"] = item["name"]
            extracted_rows.append(data)

        step2 = self.state_manager.add_step(
            task_id,
            title=f"Read and extracted structured fields from {len(search_results)} files",
            tool_name="extract_fields",
            tool_args={"fields": ["merchant", "date", "amount", "category"]}
        )
        self.state_manager.complete_step(task_id, step2.step_index, {"extracted_count": len(extracted_rows)})

        total_amount = sum(_safe_float(r.get("amount", 0.0)) for r in extracted_rows)
        preview_data = {
            "columns": ["Merchant", "Date", "Category", "Amount ($)", "Source File"],
            "rows": [
                [r.get("merchant"), r.get("date"), r.get("category"), f"${_safe_float(r.get('amount', 0.0)):.2f}", r.get("file")]
                for r in extracted_rows
            ],
            "raw_items": extracted_rows,
            "summary": {
                "total_receipts": len(extracted_rows),
                "total_expense": f"${total_amount:.2f}",
                "currency": "USD"
            }
        }

        state.preview_data = preview_data
        state.approval_prompt = f"Found {len(extracted_rows)} receipts totaling ${total_amount:.2f}. Proceed to generate expense_report_july_2026.csv?"
        self.state_manager.save_task(state)

        step3 = self.state_manager.add_step(
            task_id,
            title="Request user review and approval for CSV generation",
            tool_name="ask_user",
            tool_args={"question": state.approval_prompt, "preview_data": preview_data}
        )
        self.state_manager.complete_step(task_id, step3.step_index, {"status": "waiting_approval"})

        if not auto_approve:
            self.state_manager.update_status(task_id, "waiting_approval")
            return self.state_manager.get_task(task_id)

        return self.resume_task(task_id, approved=True)

    async def _execute_mock_receipt_pipeline_async(self, state: TaskState, auto_approve: bool = False) -> TaskState:
        task_id = state.task_id
        state.plan_overview = "1. Search receipts -> 2. Read contents -> 3. Extract fields -> 4. Compile preview -> 5. User approval -> 6. Generate CSV"
        state.total_steps = 5
        self.state_manager.save_task(state)

        step1 = self.state_manager.add_step(
            task_id,
            title="Search local index for receipt files",
            tool_name="search_files",
            tool_args={"query": "receipt", "file_types": ["pdf", "txt"]}
        )
        await self._emit_event("step_started", {"task_id": task_id, "step": step1.model_dump()})
        search_results = await self._dispatch_tool("search_files", {"query": "receipt", "file_types": ["pdf", "txt"]})
        if not search_results:
            search_results = stub_search_files(query="receipt")

        unique_results = []
        seen_stems = set()
        for item in search_results:
            stem = os.path.splitext(item.get("name", ""))[0]
            if stem and stem in seen_stems:
                continue
            if stem:
                seen_stems.add(stem)
            unique_results.append(item)
        search_results = unique_results

        self.state_manager.complete_step(task_id, step1.step_index, search_results)
        await self._emit_event("step_completed", {"task_id": task_id, "step_index": step1.step_index, "result": search_results})

        extracted_rows = []
        for item in search_results:
            read_res = await self._dispatch_tool("read_file_content", {"path": item["path"]})
            ext_res = await self._dispatch_tool(
                "extract_fields",
                {
                    "content": read_res.get("content", ""),
                    "fields": ["merchant", "date", "amount", "category"]
                }
            )
            data = ext_res.get("extracted_data", {})
            data["file"] = item.get("name", os.path.basename(item.get("path", "")))
            extracted_rows.append(data)

        step2 = self.state_manager.add_step(
            task_id,
            title=f"Read and extracted structured fields from {len(search_results)} files",
            tool_name="extract_fields",
            tool_args={"fields": ["merchant", "date", "amount", "category"]}
        )
        self.state_manager.complete_step(task_id, step2.step_index, {"extracted_count": len(extracted_rows)})
        await self._emit_event("step_completed", {"task_id": task_id, "step_index": step2.step_index, "result": {"extracted_count": len(extracted_rows)}})

        total_amount = sum(_safe_float(r.get("amount", 0.0)) for r in extracted_rows)
        preview_data = {
            "columns": ["Merchant", "Date", "Category", "Amount ($)", "Source File"],
            "rows": [
                [r.get("merchant"), r.get("date"), r.get("category"), f"${_safe_float(r.get('amount', 0.0)):.2f}", r.get("file")]
                for r in extracted_rows
            ],
            "raw_items": extracted_rows,
            "summary": {
                "total_receipts": len(extracted_rows),
                "total_expense": f"${total_amount:.2f}",
                "currency": "USD"
            }
        }

        state.preview_data = preview_data
        state.approval_prompt = f"Found {len(extracted_rows)} receipts totaling ${total_amount:.2f}. Proceed to generate expense_report_july_2026.csv?"
        self.state_manager.save_task(state)

        step3 = self.state_manager.add_step(
            task_id,
            title="Request user review and approval for CSV generation",
            tool_name="ask_user",
            tool_args={"question": state.approval_prompt, "preview_data": preview_data}
        )
        self.state_manager.complete_step(task_id, step3.step_index, {"status": "waiting_approval"})

        await self._emit_event("approval_request", {
            "task_id": task_id,
            "prompt": state.approval_prompt,
            "preview_data": preview_data
        })

        if not auto_approve:
            self.state_manager.update_status(task_id, "waiting_approval")
            return self.state_manager.get_task(task_id)

        return await self.resume_task_async(task_id, approved=True)

    def _execute_mock_spec_pipeline(self, state: TaskState, auto_approve: bool = False) -> TaskState:
        task_id = state.task_id
        state.plan_overview = "1. Search specifications -> 2. Read requirements -> 3. Extract topics -> 4. Compile Markdown preview -> 5. User approval -> 6. Generate Summary Markdown"
        state.total_steps = 5
        self.state_manager.save_task(state)

        step1 = self.state_manager.add_step(task_id, title="Search local documents for project specs", tool_name="search_files", tool_args={"query": "spec", "file_types": ["docx", "pdf", "txt"]})
        search_results = self.tool_executor("search_files", {"query": "spec", "file_types": ["docx", "pdf", "txt"]})
        if not search_results:
            search_results = [f for f in stub_search_files("spec") if "spec" in f["name"]]
        self.state_manager.complete_step(task_id, step1.step_index, search_results)

        extracted_rows = []
        for item in search_results:
            read_res = self.tool_executor("read_file_content", {"path": item["path"]})
            ext_res = self.extractor.extract_from_text(content=read_res.get("content", ""), fields=["title", "date", "category", "summary"])
            data = ext_res.get("extracted_data", {})
            data["file"] = item["name"]
            extracted_rows.append(data)

        step2 = self.state_manager.add_step(task_id, title=f"Extracted requirements from {len(search_results)} spec documents", tool_name="extract_fields", tool_args={"fields": ["title", "date", "summary"]})
        self.state_manager.complete_step(task_id, step2.step_index, {"spec_count": len(extracted_rows)})

        preview_data = {
            "columns": ["Document Title", "Date", "Category", "Key Requirements", "Source File"],
            "rows": [
                [r.get("title", "Project Spec"), r.get("date", "2026-07-22"), r.get("category", "Specifications"), r.get("summary", "Key requirements extracted"), r.get("file")]
                for r in extracted_rows
            ],
            "raw_items": extracted_rows,
            "summary": {"total_specs": len(extracted_rows), "format": "Markdown"}
        }
        state.preview_data = preview_data
        state.approval_prompt = f"Compiled summary from {len(extracted_rows)} project specifications. Proceed to generate project_specs_summary.md?"
        self.state_manager.save_task(state)

        step3 = self.state_manager.add_step(task_id, title="Request user review for Markdown report generation", tool_name="ask_user", tool_args={"question": state.approval_prompt, "preview_data": preview_data})
        self.state_manager.complete_step(task_id, step3.step_index, {"status": "waiting_approval"})

        if not auto_approve:
            self.state_manager.update_status(task_id, "waiting_approval")
            return self.state_manager.get_task(task_id)

        return self.resume_task(task_id, approved=True)

    async def _execute_mock_spec_pipeline_async(self, state: TaskState, auto_approve: bool = False) -> TaskState:
        task_id = state.task_id
        state.plan_overview = "1. Search specifications -> 2. Read requirements -> 3. Extract topics -> 4. Compile Markdown preview -> 5. User approval -> 6. Generate Summary Markdown"
        state.total_steps = 5
        self.state_manager.save_task(state)

        step1 = self.state_manager.add_step(task_id, title="Search local documents for project specs", tool_name="search_files", tool_args={"query": "spec", "file_types": ["docx", "pdf", "txt"]})
        await self._emit_event("step_started", {"task_id": task_id, "step": step1.model_dump()})
        search_results = await self._dispatch_tool("search_files", {"query": "spec", "file_types": ["docx", "pdf", "txt"]})
        if not search_results:
            search_results = [f for f in stub_search_files("spec") if "spec" in f["name"]]
        self.state_manager.complete_step(task_id, step1.step_index, search_results)
        await self._emit_event("step_completed", {"task_id": task_id, "step_index": step1.step_index, "result": search_results})

        extracted_rows = []
        for item in search_results:
            read_res = await self._dispatch_tool("read_file_content", {"path": item["path"]})
            ext_res = await self._dispatch_tool("extract_fields", {"content": read_res.get("content", ""), "fields": ["title", "date", "category", "summary"]})
            data = ext_res.get("extracted_data", {})
            data["file"] = item.get("name", os.path.basename(item.get("path", "")))
            extracted_rows.append(data)

        step2 = self.state_manager.add_step(task_id, title=f"Extracted requirements from {len(search_results)} spec documents", tool_name="extract_fields", tool_args={"fields": ["title", "date", "summary"]})
        self.state_manager.complete_step(task_id, step2.step_index, {"spec_count": len(extracted_rows)})
        await self._emit_event("step_completed", {"task_id": task_id, "step_index": step2.step_index, "result": {"spec_count": len(extracted_rows)}})

        preview_data = {
            "columns": ["Document Title", "Date", "Category", "Key Requirements", "Source File"],
            "rows": [
                [r.get("title", "Project Spec"), r.get("date", "2026-07-22"), r.get("category", "Specifications"), r.get("summary", "Key requirements extracted"), r.get("file")]
                for r in extracted_rows
            ],
            "raw_items": extracted_rows,
            "summary": {"total_specs": len(extracted_rows), "format": "Markdown"}
        }
        state.preview_data = preview_data
        state.approval_prompt = f"Compiled summary from {len(extracted_rows)} project specifications. Proceed to generate project_specs_summary.md?"
        self.state_manager.save_task(state)

        step3 = self.state_manager.add_step(task_id, title="Request user review for Markdown report generation", tool_name="ask_user", tool_args={"question": state.approval_prompt, "preview_data": preview_data})
        self.state_manager.complete_step(task_id, step3.step_index, {"status": "waiting_approval"})
        await self._emit_event("approval_request", {"task_id": task_id, "prompt": state.approval_prompt, "preview_data": preview_data})

        if not auto_approve:
            self.state_manager.update_status(task_id, "waiting_approval")
            return self.state_manager.get_task(task_id)

        return await self.resume_task_async(task_id, approved=True)

    def _execute_mock_invoice_pipeline(self, state: TaskState, auto_approve: bool = False) -> TaskState:
        task_id = state.task_id
        state.plan_overview = "1. Search contractor invoices -> 2. Read invoices -> 3. Extract balances & due dates -> 4. Compile schedule preview -> 5. User approval -> 6. Generate CSV"
        state.total_steps = 5
        self.state_manager.save_task(state)

        step1 = self.state_manager.add_step(task_id, title="Search local documents for contractor invoices", tool_name="search_files", tool_args={"query": "contractor invoice", "file_types": ["pdf", "txt"]})
        search_results = self.tool_executor("search_files", {"query": "contractor invoice", "file_types": ["pdf", "txt"]})
        if not search_results:
            search_results = [f for f in stub_search_files("contractor invoice") if "invoice" in f["name"]]
        self.state_manager.complete_step(task_id, step1.step_index, search_results)

        extracted_rows = []
        for item in search_results:
            read_res = self.tool_executor("read_file_content", {"path": item["path"]})
            ext_res = self.extractor.extract_from_text(content=read_res.get("content", ""), fields=["merchant", "date", "amount", "invoice_number", "category"])
            data = ext_res.get("extracted_data", {})
            data["file"] = item["name"]
            extracted_rows.append(data)

        step2 = self.state_manager.add_step(task_id, title=f"Extracted payment schedules from {len(search_results)} contractor invoices", tool_name="extract_fields", tool_args={"fields": ["merchant", "date", "amount", "invoice_number"]})
        self.state_manager.complete_step(task_id, step2.step_index, {"invoice_count": len(extracted_rows)})

        total_due = sum(_safe_float(r.get("amount", 0.0)) for r in extracted_rows)
        preview_data = {
            "columns": ["Contractor / Vendor", "Invoice Date", "Invoice #", "Balance Due ($)", "Source File"],
            "rows": [
                [r.get("merchant", "Contractor"), r.get("date", "2026-07-20"), r.get("invoice_number", "INV-101"), f"${_safe_float(r.get('amount', 0.0)):.2f}", r.get("file")]
                for r in extracted_rows
            ],
            "raw_items": extracted_rows,
            "summary": {"total_invoices": len(extracted_rows), "total_balance_due": f"${total_due:.2f}", "currency": "USD"}
        }
        state.preview_data = preview_data
        state.approval_prompt = f"Found {len(extracted_rows)} contractor invoices totaling ${total_due:.2f}. Proceed to generate contractor_payment_schedule.csv?"
        self.state_manager.save_task(state)

        step3 = self.state_manager.add_step(task_id, title="Request user review for payment schedule generation", tool_name="ask_user", tool_args={"question": state.approval_prompt, "preview_data": preview_data})
        self.state_manager.complete_step(task_id, step3.step_index, {"status": "waiting_approval"})

        if not auto_approve:
            self.state_manager.update_status(task_id, "waiting_approval")
            return self.state_manager.get_task(task_id)

        return self.resume_task(task_id, approved=True)

    async def _execute_mock_invoice_pipeline_async(self, state: TaskState, auto_approve: bool = False) -> TaskState:
        task_id = state.task_id
        state.plan_overview = "1. Search contractor invoices -> 2. Read invoices -> 3. Extract balances & due dates -> 4. Compile schedule preview -> 5. User approval -> 6. Generate CSV"
        state.total_steps = 5
        self.state_manager.save_task(state)

        step1 = self.state_manager.add_step(task_id, title="Search local documents for contractor invoices", tool_name="search_files", tool_args={"query": "contractor invoice", "file_types": ["pdf", "txt"]})
        await self._emit_event("step_started", {"task_id": task_id, "step": step1.model_dump()})
        search_results = await self._dispatch_tool("search_files", {"query": "contractor invoice", "file_types": ["pdf", "txt"]})
        if not search_results:
            search_results = [f for f in stub_search_files("contractor invoice") if "invoice" in f["name"]]
        self.state_manager.complete_step(task_id, step1.step_index, search_results)
        await self._emit_event("step_completed", {"task_id": task_id, "step_index": step1.step_index, "result": search_results})

        extracted_rows = []
        for item in search_results:
            read_res = await self._dispatch_tool("read_file_content", {"path": item["path"]})
            ext_res = await self._dispatch_tool("extract_fields", {"content": read_res.get("content", ""), "fields": ["merchant", "date", "amount", "invoice_number", "category"]})
            data = ext_res.get("extracted_data", {})
            data["file"] = item.get("name", os.path.basename(item.get("path", "")))
            extracted_rows.append(data)

        step2 = self.state_manager.add_step(task_id, title=f"Extracted payment schedules from {len(search_results)} contractor invoices", tool_name="extract_fields", tool_args={"fields": ["merchant", "date", "amount", "invoice_number"]})
        self.state_manager.complete_step(task_id, step2.step_index, {"invoice_count": len(extracted_rows)})
        await self._emit_event("step_completed", {"task_id": task_id, "step_index": step2.step_index, "result": {"invoice_count": len(extracted_rows)}})

        total_due = sum(_safe_float(r.get("amount", 0.0)) for r in extracted_rows)
        preview_data = {
            "columns": ["Contractor / Vendor", "Invoice Date", "Invoice #", "Balance Due ($)", "Source File"],
            "rows": [
                [r.get("merchant", "Contractor"), r.get("date", "2026-07-20"), r.get("invoice_number", "INV-101"), f"${_safe_float(r.get('amount', 0.0)):.2f}", r.get("file")]
                for r in extracted_rows
            ],
            "raw_items": extracted_rows,
            "summary": {"total_invoices": len(extracted_rows), "total_balance_due": f"${total_due:.2f}", "currency": "USD"}
        }
        state.preview_data = preview_data
        state.approval_prompt = f"Found {len(extracted_rows)} contractor invoices totaling ${total_due:.2f}. Proceed to generate contractor_payment_schedule.csv?"
        self.state_manager.save_task(state)

        step3 = self.state_manager.add_step(task_id, title="Request user review for payment schedule generation", tool_name="ask_user", tool_args={"question": state.approval_prompt, "preview_data": preview_data})
        self.state_manager.complete_step(task_id, step3.step_index, {"status": "waiting_approval"})
        await self._emit_event("approval_request", {"task_id": task_id, "prompt": state.approval_prompt, "preview_data": preview_data})

        if not auto_approve:
            self.state_manager.update_status(task_id, "waiting_approval")
            return self.state_manager.get_task(task_id)

        return await self.resume_task_async(task_id, approved=True)

    def resume_task(self, task_id: str, approved: bool, user_feedback: Optional[str] = None) -> TaskState:
        """Resumes task after user approval response (sync)."""
        state = self.state_manager.get_task(task_id)
        if not state:
            raise ValueError(f"Task not found: {task_id}")

        if not approved:
            state.status = "canceled"
            state.final_summary = f"Task was cancelled by the user: {user_feedback or 'No reason provided'}"
            self.state_manager.save_task(state)
            self._active_chats.pop(task_id, None)
            return state

        chat = self._active_chats.pop(task_id, None)
        if chat:
            try:
                response = chat.send_message(
                    types.Part.from_function_response(
                        name="ask_user",
                        response={"result": {"status": "approved", "feedback": user_feedback}}
                    )
                )
                max_turns = 5
                turn = 0
                while turn < max_turns:
                    turn += 1
                    if not response.function_calls:
                        state.final_summary = response.text
                        state.status = "completed"
                        self.state_manager.save_task(state)
                        break

                    response_parts = []
                    for call in response.function_calls:
                        tool_name = call.name
                        tool_args = dict(call.args)
                        step = self.state_manager.add_step(task_id, title=f"Execute tool: {tool_name}", tool_name=tool_name, tool_args=tool_args)
                        tool_result = self.tool_executor(tool_name, tool_args)
                        self.state_manager.complete_step(task_id, step.step_index, tool_result)

                        if tool_name == "create_artifact":
                            artifact_error = artifact_creation_error(tool_result)
                            if artifact_error:
                                state.status = "failed"
                                state.error = artifact_error
                                state.final_summary = f"Artifact creation failed: {artifact_error}"
                                self.state_manager.save_task(state)
                                return state
                            state.artifacts.append(tool_result)

                        response_parts.append(
                            types.Part.from_function_response(name=tool_name, response={"result": tool_result})
                        )

                    response = chat.send_message(response_parts)

                return self.state_manager.get_task(task_id)
            except Exception as e:
                print(f"[SageSearchAgent] Error resuming live Gemini chat: {e}. Falling back to dynamic builder.")

        # Fallback / Mock resume
        preview = state.preview_data or {}
        columns = preview.get("columns", [])
        rows = preview.get("rows", [])
        raw_items = preview.get("raw_items", [])
        summary = preview.get("summary", {})
        goal_lower = state.goal.lower()

        if "spec" in goal_lower:
            filename = "project_specs_summary.md"
            content_type = "text/markdown"
            content = ArtifactBuilder.build_generic_markdown("Project Specifications Summary", columns, rows, summary)
        elif "contractor" in goal_lower or "invoice" in goal_lower:
            filename = "contractor_payment_schedule.csv"
            content_type = "text/csv"
            content = ArtifactBuilder.build_generic_csv(columns, rows, summary)
        else:
            filename = "expense_report_july_2026.csv"
            content_type = "text/csv"
            content = ArtifactBuilder.build_expense_csv(raw_items, summary=summary)

        step_final = self.state_manager.add_step(
            task_id,
            title=f"Generate artifact: {filename}",
            tool_name="create_artifact",
            tool_args={"filename": filename, "content_type": content_type, "data": content}
        )
        artifact_res = self.tool_executor("create_artifact", {"filename": filename, "content_type": content_type, "data": content})
        artifact_error = artifact_creation_error(artifact_res)
        if artifact_error:
            self.state_manager.fail_step(task_id, step_final.step_index, artifact_res)
            state.status = "failed"
            state.error = artifact_error
            state.final_summary = f"Could not create {filename}: {artifact_error}"
            self.state_manager.save_task(state)
            return state

        self.state_manager.complete_step(task_id, step_final.step_index, artifact_res)
        state.artifacts.append(artifact_res)
        state.status = "completed"
        state.final_summary = f"Successfully processed {len(rows)} items and generated {filename} at {artifact_res.get('saved_path')}."
        self.state_manager.save_task(state)
        return state

    async def resume_task_async(self, task_id: str, approved: bool, user_feedback: Optional[str] = None) -> TaskState:
        """Resumes task after user approval response (async over bridge)."""
        state = self.state_manager.get_task(task_id)
        if not state:
            raise ValueError(f"Task not found: {task_id}")

        if not approved:
            state.status = "canceled"
            state.final_summary = f"Task was cancelled by the user: {user_feedback or 'No reason provided'}"
            self.state_manager.save_task(state)
            self._active_chats.pop(task_id, None)
            await self._emit_event("task_canceled", {"task_id": task_id, "summary": state.final_summary})
            return state

        chat = self._active_chats.pop(task_id, None)
        if chat:
            try:
                response = await asyncio.to_thread(
                    chat.send_message,
                    types.Part.from_function_response(
                        name="ask_user",
                        response={"result": {"status": "approved", "feedback": user_feedback}}
                    )
                )
                max_turns = 5
                turn = 0
                while turn < max_turns:
                    turn += 1
                    if not response.function_calls:
                        state.final_summary = response.text
                        state.status = "completed"
                        self.state_manager.save_task(state)
                        await self._emit_event("task_completed", {"task_id": task_id, "state": state.model_dump()})
                        break

                    response_parts = []
                    for call in response.function_calls:
                        tool_name = call.name
                        tool_args = dict(call.args)
                        step = self.state_manager.add_step(task_id, title=f"Execute tool: {tool_name}", tool_name=tool_name, tool_args=tool_args)
                        await self._emit_event("step_started", {"task_id": task_id, "step": step.model_dump()})

                        tool_result = await self._dispatch_tool(tool_name, tool_args)
                        self.state_manager.complete_step(task_id, step.step_index, tool_result)
                        await self._emit_event("step_completed", {"task_id": task_id, "step_index": step.step_index, "result": tool_result})

                        if tool_name == "create_artifact":
                            artifact_error = artifact_creation_error(tool_result)
                            if artifact_error:
                                state.status = "failed"
                                state.error = artifact_error
                                state.final_summary = f"Artifact creation failed: {artifact_error}"
                                self.state_manager.save_task(state)
                                await self._emit_event("task_failed", {"task_id": task_id, "state": state.model_dump()})
                                return state
                            state.artifacts.append(tool_result)

                        response_parts.append(
                            types.Part.from_function_response(name=tool_name, response={"result": tool_result})
                        )

                    response = await asyncio.to_thread(chat.send_message, response_parts)

                return self.state_manager.get_task(task_id)
            except Exception as e:
                print(f"[SageSearchAgent] Error in async live chat continuation: {e}. Falling back to dynamic builder.")

        # Fallback / Mock resume
        preview = state.preview_data or {}
        columns = preview.get("columns", [])
        rows = preview.get("rows", [])
        raw_items = preview.get("raw_items", [])
        summary = preview.get("summary", {})
        goal_lower = state.goal.lower()

        if "spec" in goal_lower:
            filename = "project_specs_summary.md"
            content_type = "text/markdown"
            content = ArtifactBuilder.build_generic_markdown("Project Specifications Summary", columns, rows, summary)
        elif "contractor" in goal_lower or "invoice" in goal_lower:
            filename = "contractor_payment_schedule.csv"
            content_type = "text/csv"
            content = ArtifactBuilder.build_generic_csv(columns, rows, summary)
        else:
            filename = "expense_report_july_2026.csv"
            content_type = "text/csv"
            content = ArtifactBuilder.build_expense_csv(raw_items, summary=summary)

        step_final = self.state_manager.add_step(
            task_id,
            title=f"Generate artifact: {filename}",
            tool_name="create_artifact",
            tool_args={"filename": filename, "content_type": content_type, "data": content}
        )
        await self._emit_event("step_started", {"task_id": task_id, "step": step_final.model_dump()})

        artifact_res = await self._dispatch_tool("create_artifact", {"filename": filename, "content_type": content_type, "data": content})
        artifact_error = artifact_creation_error(artifact_res)
        if artifact_error:
            self.state_manager.fail_step(task_id, step_final.step_index, artifact_res)
            state.status = "failed"
            state.error = artifact_error
            state.final_summary = f"Could not create {filename}: {artifact_error}"
            self.state_manager.save_task(state)
            await self._emit_event("task_failed", {"task_id": task_id, "state": state.model_dump()})
            return state

        self.state_manager.complete_step(task_id, step_final.step_index, artifact_res)
        await self._emit_event("step_completed", {"task_id": task_id, "step_index": step_final.step_index, "result": artifact_res})

        state.artifacts.append(artifact_res)
        state.status = "completed"
        state.final_summary = f"Successfully processed {len(rows)} items and generated {filename} at {artifact_res.get('saved_path')}."
        self.state_manager.save_task(state)
        await self._emit_event("task_completed", {"task_id": task_id, "state": state.model_dump()})
        return state

    def _execute_live_pipeline(self, state: TaskState, auto_approve: bool = False) -> TaskState:
        """Live Gemini tool calling orchestration (sync)."""
        task_id = state.task_id
        try:
            tools = [types.Tool(function_declarations=[
                types.FunctionDeclaration(
                    name=decl["name"],
                    description=decl["description"],
                    parameters=decl["parameters"]
                ) for decl in TOOL_DECLARATIONS
            ])]

            config = types.GenerateContentConfig(
                system_instruction=self._get_system_instructions(),
                tools=tools,
                temperature=0.2
            )

            chat = self.client.chats.create(model=self.model_name, config=config)
            response = chat.send_message(f"Goal: {state.goal}")

            max_turns = 30
            turn = 0
            while turn < max_turns:
                turn += 1
                if not response.function_calls:
                    state.final_summary = response.text
                    state.status = "completed"
                    self.state_manager.save_task(state)
                    break

                response_parts = []
                waiting_for_user = False

                for call in response.function_calls:
                    tool_name = call.name
                    tool_args = dict(call.args)

                    step = self.state_manager.add_step(
                        task_id,
                        title=f"Execute tool: {tool_name}",
                        tool_name=tool_name,
                        tool_args=tool_args
                    )

                    tool_result = self.tool_executor(tool_name, tool_args)
                    self.state_manager.complete_step(task_id, step.step_index, tool_result)

                    if tool_name == "ask_user" and not auto_approve:
                        state.approval_prompt = tool_args.get("question")
                        state.preview_data = tool_args.get("preview_data")
                        state.status = "waiting_approval"
                        self._active_chats[task_id] = chat
                        self.state_manager.save_task(state)
                        waiting_for_user = True

                    response_parts.append(
                        types.Part.from_function_response(
                            name=tool_name,
                            response={"result": tool_result}
                        )
                    )

                if waiting_for_user:
                    return state

                response = chat.send_message(response_parts)

            if state.status == "planning":
                if not state.artifacts:
                    state.status = "failed"
                    state.error = "Agent reached maximum execution turn limit before completing the workflow."
                    state.final_summary = state.error
                else:
                    state.status = "completed"
                    state.final_summary = state.final_summary or "Autonomous task completed."
                self.state_manager.save_task(state)

            return self.state_manager.get_task(task_id)

        except Exception as e:
            print(f"[SageSearchAgent] Live execution error: {e}")
            self.state_manager.update_status(task_id, "failed", error=str(e))
            return self.state_manager.get_task(task_id)

    async def _execute_live_pipeline_async(self, state: TaskState, auto_approve: bool = False) -> TaskState:
        """Async live Gemini tool calling with WebSocket event emission."""
        task_id = state.task_id
        try:
            tools = [types.Tool(function_declarations=[
                types.FunctionDeclaration(
                    name=decl["name"],
                    description=decl["description"],
                    parameters=decl["parameters"]
                ) for decl in TOOL_DECLARATIONS
            ])]

            config = types.GenerateContentConfig(
                system_instruction=self._get_system_instructions(),
                tools=tools,
                temperature=0.2
            )

            chat = self.client.chats.create(model=self.model_name, config=config)
            response = await asyncio.to_thread(chat.send_message, f"Goal: {state.goal}")

            max_turns = 30
            turn = 0
            while turn < max_turns:
                turn += 1
                if not response.function_calls:
                    state.final_summary = response.text
                    state.status = "completed"
                    self.state_manager.save_task(state)
                    await self._emit_event("task_completed", {"task_id": task_id, "state": state.model_dump()})
                    break

                response_parts = []
                waiting_for_user = False

                for call in response.function_calls:
                    tool_name = call.name
                    tool_args = dict(call.args)

                    step = self.state_manager.add_step(
                        task_id,
                        title=f"Execute tool: {tool_name}",
                        tool_name=tool_name,
                        tool_args=tool_args
                    )
                    await self._emit_event("step_started", {"task_id": task_id, "step": step.model_dump()})

                    tool_result = await self._dispatch_tool(tool_name, tool_args)
                    self.state_manager.complete_step(task_id, step.step_index, tool_result)
                    await self._emit_event("step_completed", {"task_id": task_id, "step_index": step.step_index, "result": tool_result})

                    if tool_name == "ask_user" and not auto_approve:
                        state.approval_prompt = tool_args.get("question")
                        state.preview_data = tool_args.get("preview_data")
                        state.status = "waiting_approval"
                        self._active_chats[task_id] = chat
                        self.state_manager.save_task(state)
                        await self._emit_event("approval_request", {
                            "task_id": task_id,
                            "prompt": state.approval_prompt,
                            "preview_data": state.preview_data
                        })
                        waiting_for_user = True

                    if tool_name == "create_artifact":
                        artifact_error = artifact_creation_error(tool_result)
                        if artifact_error:
                            state.status = "failed"
                            state.error = artifact_error
                            state.final_summary = f"Artifact creation failed: {artifact_error}"
                            self.state_manager.save_task(state)
                            await self._emit_event("task_failed", {"task_id": task_id, "state": state.model_dump()})
                            return state
                        state.artifacts.append(tool_result)

                    response_parts.append(
                        types.Part.from_function_response(
                            name=tool_name,
                            response={"result": tool_result}
                        )
                    )

                if waiting_for_user:
                    return state

                response = await asyncio.to_thread(chat.send_message, response_parts)

            if state.status == "planning":
                if not state.artifacts:
                    state.status = "failed"
                    state.error = "Agent reached maximum execution turn limit before completing the workflow."
                    state.final_summary = state.error
                    self.state_manager.save_task(state)
                    await self._emit_event("task_failed", {"task_id": task_id, "state": state.model_dump()})
                else:
                    state.status = "completed"
                    state.final_summary = state.final_summary or "Autonomous task completed."
                    self.state_manager.save_task(state)
                    await self._emit_event("task_completed", {"task_id": task_id, "state": state.model_dump()})

            return self.state_manager.get_task(task_id)

        except Exception as e:
            print(f"[SageSearchAgent] Async live execution error: {e}")
            self.state_manager.update_status(task_id, "failed", error=str(e))
            await self._emit_event("task_failed", {"task_id": task_id, "error": str(e)})
            return self.state_manager.get_task(task_id)


