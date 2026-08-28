"""FastAPI REST and WebSocket Service for SageSearch Autonomous Agent."""
import os
import asyncio
from typing import Any, Dict, Optional
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from agent.core import SageSearchAgent
from agent.state import TaskStateManager, TaskState
from agent.bridge import WebSocketBridgeManager

app = FastAPI(
    title="SageSearch Agent Service",
    description="Autonomous Agent Service for Multi-Step File Workflows powered by Google Gemini",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global State Manager & WebSocket Bridge
state_manager = TaskStateManager(use_firestore=bool(os.environ.get("USE_FIRESTORE", "false").lower() == "true"))
bridge_manager = WebSocketBridgeManager()

# Instantiate agent with remote bridge tool executor and event broadcaster
agent = SageSearchAgent(
    state_manager=state_manager,
    async_tool_executor=bridge_manager.dispatch_tool_call,
    event_callback=bridge_manager.broadcast_event
)


class CreateTaskRequest(BaseModel):
    goal: str = Field(description="The high-level goal for the agent to execute")
    auto_approve: bool = Field(default=False, description="Whether to automatically approve the final artifact generation without manual review")


class TaskResponsePayload(BaseModel):
    approved: bool = Field(description="Whether the user approved the pending action")
    feedback: Optional[str] = Field(default=None, description="Optional user feedback or correction")


@app.get("/health")
def health_check() -> Dict[str, Any]:
    return {
        "status": "healthy",
        "service": "sagesearch-agent",
        "version": "1.0.0",
        "mock_mode": agent.mock_mode,
        "model": agent.model_name,
        "bridge": {
            "connected_clients": len(bridge_manager.active_connections),
            "is_desktop_connected": bridge_manager.is_client_connected
        }
    }


@app.websocket("/ws/bridge")
async def websocket_bridge_endpoint(websocket: WebSocket, client_id: str = "desktop-backend"):
    """WebSocket endpoint connecting local desktop backend to Cloud Run agent."""
    await bridge_manager.register(websocket, client_id=client_id)
    try:
        while True:
            data = await websocket.receive_text()
            await bridge_manager.handle_incoming_message(websocket, data)
    except WebSocketDisconnect:
        bridge_manager.unregister(websocket)
    except Exception as e:
        print(f"[WebSocketEndpoint] Connection error: {e}")
        bridge_manager.unregister(websocket)


@app.post("/tasks", response_model=TaskState)
async def create_task(req: CreateTaskRequest) -> TaskState:
    """Dispatches a new goal to the autonomous agent."""
    if not req.goal.strip():
        raise HTTPException(status_code=400, detail="Goal cannot be empty")

    state = await agent.execute_goal_async(goal=req.goal, auto_approve=req.auto_approve)
    return state


@app.get("/tasks/{task_id}", response_model=TaskState)
def get_task_status(task_id: str) -> TaskState:
    """Retrieves current progress, steps, previews, and artifacts for a task."""
    state = state_manager.get_task(task_id)
    if not state:
        raise HTTPException(status_code=404, detail=f"Task {task_id} not found")
    return state


@app.post("/tasks/{task_id}/respond", response_model=TaskState)
async def respond_to_task(task_id: str, payload: TaskResponsePayload) -> TaskState:
    """Submits user approval or feedback to resume a paused task."""
    state = state_manager.get_task(task_id)
    if not state:
        raise HTTPException(status_code=404, detail=f"Task {task_id} not found")

    if state.status != "waiting_approval":
        raise HTTPException(status_code=400, detail=f"Task {task_id} is not waiting for approval (status: {state.status})")

    resumed_state = await agent.resume_task_async(task_id, approved=payload.approved, user_feedback=payload.feedback)
    return resumed_state


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8080))
    uvicorn.run(app, host="0.0.0.0", port=port)
