"""State and memory management for SageSearch Autonomous Agent tasks."""
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field

try:
    from google.cloud import firestore
    FIRESTORE_AVAILABLE = True
except ImportError:
    FIRESTORE_AVAILABLE = False


class TaskStep(BaseModel):
    step_index: int
    title: str
    status: str = "pending"  # pending, in_progress, completed, failed
    tool_name: Optional[str] = None
    tool_args: Optional[Dict[str, Any]] = None
    tool_result: Optional[Any] = None
    timestamp: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class TaskState(BaseModel):
    task_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    goal: str
    status: str = "pending"  # pending, planning, executing, waiting_approval, completed, failed, canceled
    plan_overview: Optional[str] = None
    current_step: int = 0
    total_steps: int = 0
    steps: List[TaskStep] = Field(default_factory=list)
    preview_data: Optional[Dict[str, Any]] = None
    approval_prompt: Optional[str] = None
    artifacts: List[Dict[str, Any]] = Field(default_factory=list)
    final_summary: Optional[str] = None
    error: Optional[str] = None
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class TaskStateManager:
    """Manages task lifecycle and user memory in Firestore with seamless in-memory fallback."""

    def __init__(self, use_firestore: bool = False, collection_name: str = "tasks", memory_collection: str = "memory"):
        self._memory_store: Dict[str, TaskState] = {}
        self._user_memory: Dict[str, Dict[str, Any]] = {}
        self.use_firestore = use_firestore and FIRESTORE_AVAILABLE
        self.collection_name = collection_name
        self.memory_collection = memory_collection
        self.db = None

        if self.use_firestore:
            try:
                project = os.environ.get("GCP_PROJECT")
                self.db = firestore.Client(project=project)
            except Exception as e:
                print(f"[TaskStateManager] Firestore initialization failed ({e}), falling back to in-memory store.")
                self.use_firestore = False

    def create_task(self, goal: str, task_id: Optional[str] = None) -> TaskState:
        state = TaskState(
            task_id=task_id or str(uuid.uuid4()),
            goal=goal,
            status="pending"
        )
        self.save_task(state)
        return state

    def get_task(self, task_id: str) -> Optional[TaskState]:
        if self.use_firestore and self.db:
            try:
                doc = self.db.collection(self.collection_name).document(task_id).get()
                if doc.exists:
                    return TaskState(**doc.to_dict())
            except Exception as e:
                print(f"[TaskStateManager] Error reading from Firestore: {e}")

        return self._memory_store.get(task_id)

    def save_task(self, state: TaskState) -> None:
        state.updated_at = datetime.now(timezone.utc).isoformat()
        self._memory_store[state.task_id] = state

        if self.use_firestore and self.db:
            try:
                doc_ref = self.db.collection(self.collection_name).document(state.task_id)
                doc_ref.set(state.model_dump())
            except Exception as e:
                print(f"[TaskStateManager] Error saving to Firestore: {e}")

    def update_status(self, task_id: str, status: str, error: Optional[str] = None) -> Optional[TaskState]:
        state = self.get_task(task_id)
        if state:
            state.status = status
            if error:
                state.error = error
            self.save_task(state)
        return state

    def add_step(self, task_id: str, title: str, tool_name: Optional[str] = None, tool_args: Optional[Dict[str, Any]] = None) -> Optional[TaskStep]:
        state = self.get_task(task_id)
        if not state:
            return None

        step_idx = len(state.steps) + 1
        step = TaskStep(
            step_index=step_idx,
            title=title,
            status="in_progress",
            tool_name=tool_name,
            tool_args=tool_args
        )
        state.steps.append(step)
        state.current_step = step_idx
        state.total_steps = max(state.total_steps, step_idx)
        self.save_task(state)
        return step

    def complete_step(self, task_id: str, step_index: int, result: Any) -> None:
        state = self.get_task(task_id)
        if not state:
            return

        for step in state.steps:
            if step.step_index == step_index:
                step.status = "completed"
                step.tool_result = result
                break
        self.save_task(state)

    def fail_step(self, task_id: str, step_index: int, result: Any) -> None:
        state = self.get_task(task_id)
        if not state:
            return

        for step in state.steps:
            if step.step_index == step_index:
                step.status = "failed"
                step.tool_result = result
                break
        self.save_task(state)

    def get_user_memory(self, user_id: str = "default_user") -> Dict[str, Any]:
        """Retrieves persistent user preferences and workflow memory."""
        if self.use_firestore and self.db:
            try:
                doc = self.db.collection(self.memory_collection).document(user_id).get()
                if doc.exists:
                    return doc.to_dict()
            except Exception as e:
                print(f"[TaskStateManager] Firestore memory read error: {e}")

        return self._user_memory.get(user_id, {
            "default_currency": "USD",
            "preferred_export_format": "csv",
            "learned_categories": ["Gym / Fitness", "Travel / Flight", "Travel / Lodging", "Travel / Ground", "Meals / Dining"]
        })

    def save_user_memory(self, user_id: str, memory_data: Dict[str, Any]) -> None:
        """Saves user preferences to memory."""
        current = self.get_user_memory(user_id)
        current.update(memory_data)
        self._user_memory[user_id] = current

        if self.use_firestore and self.db:
            try:
                self.db.collection(self.memory_collection).document(user_id).set(current)
            except Exception as e:
                print(f"[TaskStateManager] Firestore memory write error: {e}")
