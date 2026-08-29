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
        self.extractor = StructuredFieldExtractor(api_key=self.api_key, model_name=self.model_name)
        
        if mock_mode is not None:
            self.mock_mode = mock_mode
        else:
            self.mock_mode = not bool(self.api_key and GENAI_AVAILABLE)

        self.client = None
        if not self.mock_mode and GENAI_AVAILABLE and self.api_key:
            try:
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

    async def _emit_event(self, event_type: str, data: Dict[str, Any]) -> None:
        if self.event_callback:
            try:
                res = self.event_callback(event_type, data)
                if asyncio.iscoroutine(res):
                    await res
            except Exception as e:
                print(f"[SageSearchAgent] Event callback error: {e}")

    async def _dispatch_tool(self, tool_name: str, args: Dict[str, Any]) -> Any:
        # For extract_fields, we run the extraction engine directly
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
            return self._execute_live_pipeline(state, auto_approve=auto_approve)

    def _execute_mock_pipeline(self, state: TaskState, auto_approve: bool = False) -> TaskState:
        """Deterministic mock execution for Day 3 offline development."""
        task_id = state.task_id
        state.plan_overview = "1. Search receipts -> 2. Read contents -> 3. Extract fields -> 4. Compile preview -> 5. User approval -> 6. Generate CSV"
        state.total_steps = 5
        self.state_manager.save_task(state)

        # Step 1: Search Files
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

        # Step 2: Read & Extract Data from Found Files
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

        total_amount = sum(float(r.get("amount", 0.0)) for r in extracted_rows)
        preview_data = {
            "columns": ["Merchant", "Date", "Category", "Amount ($)", "Source File"],
            "rows": [
                [r.get("merchant"), r.get("date"), r.get("category"), f"${float(r.get('amount', 0.0)):.2f}", r.get("file")]
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

        # Step 3: Ask User Approval
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

    async def _execute_mock_pipeline_async(self, state: TaskState, auto_approve: bool = False) -> TaskState:
        """Async mock execution sending real-time events over WebSocket."""
        task_id = state.task_id
        state.plan_overview = "1. Search receipts -> 2. Read contents -> 3. Extract fields -> 4. Compile preview -> 5. User approval -> 6. Generate CSV"
        state.total_steps = 5
        self.state_manager.save_task(state)

        # Step 1: Search Files
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
        await self._emit_event("step_completed", {"task_id": task_id, "step_index": step1.step_index, "result": search_results})

        # Step 2: Read & Extract Data
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

        total_amount = sum(float(r.get("amount", 0.0)) for r in extracted_rows)
        preview_data = {
            "columns": ["Merchant", "Date", "Category", "Amount ($)", "Source File"],
            "rows": [
                [r.get("merchant"), r.get("date"), r.get("category"), f"${float(r.get('amount', 0.0)):.2f}", r.get("file")]
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

        # Step 3: Ask User Approval
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

    def resume_task(self, task_id: str, approved: bool, user_feedback: Optional[str] = None) -> TaskState:
        """Resumes task after user approval response."""
        state = self.state_manager.get_task(task_id)
        if not state:
            raise ValueError(f"Task not found: {task_id}")

        if not approved:
            state.status = "canceled"
            state.final_summary = f"Task was cancelled by the user: {user_feedback or 'No reason provided'}"
            self.state_manager.save_task(state)
            return state

        # Step 4: Create CSV Artifact using ArtifactBuilder
        raw_items = state.preview_data.get("raw_items", []) if state.preview_data else []
        csv_content = ArtifactBuilder.build_expense_csv(raw_items, summary=state.preview_data.get("summary") if state.preview_data else None)

        filename = "expense_report_july_2026.csv"
        step4 = self.state_manager.add_step(
            task_id,
            title=f"Generate artifact: {filename}",
            tool_name="create_artifact",
            tool_args={"filename": filename, "content_type": "text/csv", "data": csv_content}
        )
        artifact_res = self.tool_executor(
            "create_artifact",
            {"filename": filename, "content_type": "text/csv", "data": csv_content}
        )
        self.state_manager.complete_step(task_id, step4.step_index, artifact_res)

        state.artifacts.append(artifact_res)
        state.status = "completed"
        summary_total = state.preview_data.get("summary", {}).get("total_expense", "$0.00") if state.preview_data else ""
        receipt_count = state.preview_data.get("summary", {}).get("total_receipts", 0) if state.preview_data else 0
        state.final_summary = (
            f"Successfully processed {receipt_count} receipts totaling {summary_total} "
            f"and generated {filename} at {artifact_res.get('saved_path')}."
        )
        self.state_manager.save_task(state)
        return state

    async def resume_task_async(self, task_id: str, approved: bool, user_feedback: Optional[str] = None) -> TaskState:
        """Async task resume writing artifact through remote bridge."""
        state = self.state_manager.get_task(task_id)
        if not state:
            raise ValueError(f"Task not found: {task_id}")

        if not approved:
            state.status = "canceled"
            state.final_summary = f"Task was cancelled by the user: {user_feedback or 'No reason provided'}"
            self.state_manager.save_task(state)
            await self._emit_event("task_canceled", {"task_id": task_id, "summary": state.final_summary})
            return state

        raw_items = state.preview_data.get("raw_items", []) if state.preview_data else []
        csv_content = ArtifactBuilder.build_expense_csv(raw_items, summary=state.preview_data.get("summary") if state.preview_data else None)

        filename = "expense_report_july_2026.csv"
        step4 = self.state_manager.add_step(
            task_id,
            title=f"Generate artifact: {filename}",
            tool_name="create_artifact",
            tool_args={"filename": filename, "content_type": "text/csv", "data": csv_content}
        )
        artifact_res = await self._dispatch_tool(
            "create_artifact",
            {"filename": filename, "content_type": "text/csv", "data": csv_content}
        )
        self.state_manager.complete_step(task_id, step4.step_index, artifact_res)

        state.artifacts.append(artifact_res)
        state.status = "completed"
        summary_total = state.preview_data.get("summary", {}).get("total_expense", "$0.00") if state.preview_data else ""
        receipt_count = state.preview_data.get("summary", {}).get("total_receipts", 0) if state.preview_data else 0
        state.final_summary = (
            f"Successfully processed {receipt_count} receipts totaling {summary_total} "
            f"and generated {filename} at {artifact_res.get('saved_path')}."
        )
        self.state_manager.save_task(state)
        await self._emit_event("task_completed", {"task_id": task_id, "state": state.model_dump()})
        return state

    def _execute_live_pipeline(self, state: TaskState, auto_approve: bool = False) -> TaskState:
        """Live Gemini tool calling orchestration."""
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
                system_instruction=SYSTEM_INSTRUCTION,
                tools=tools,
                temperature=0.2
            )

            chat = self.client.chats.create(model=self.model_name, config=config)
            response = chat.send_message(f"Goal: {state.goal}")

            max_turns = 10
            turn = 0
            while turn < max_turns:
                turn += 1
                if not response.function_calls:
                    state.final_summary = response.text
                    state.status = "completed"
                    self.state_manager.save_task(state)
                    break

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
                        self.state_manager.save_task(state)
                        return state

                    response = chat.send_message(
                        types.Part.from_function_response(
                            name=tool_name,
                            response={"result": tool_result}
                        )
                    )

            return self.state_manager.get_task(task_id)

        except Exception as e:
            print(f"[SageSearchAgent] Live execution error: {e}")
            self.state_manager.update_status(task_id, "failed", error=str(e))
            return self.state_manager.get_task(task_id)
