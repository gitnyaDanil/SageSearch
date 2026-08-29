"""WebSocket Bridge Manager and Remote Tool Dispatcher for Desktop Connections."""
import asyncio
import json
import uuid
from typing import Any, Callable, Dict, Optional, Set
from fastapi import WebSocket

from .stubs import (
    stub_search_files,
    stub_read_file_content,
    stub_extract_fields,
    stub_ask_user,
    stub_create_artifact
)


class WebSocketBridgeManager:
    """Manages connected SageSearch desktop clients and routes RPC tool calls."""

    def __init__(self):
        self.active_connections: Set[WebSocket] = set()
        self.pending_tool_calls: Dict[str, asyncio.Future] = {}
        self.client_id_map: Dict[WebSocket, str] = {}

    @property
    def is_client_connected(self) -> bool:
        return len(self.active_connections) > 0

    async def register(self, websocket: WebSocket, client_id: str = "desktop-app") -> None:
        await websocket.accept()
        self.active_connections.add(websocket)
        self.client_id_map[websocket] = client_id
        print(f"[WebSocketBridge] Client connected: {client_id} (Total: {len(self.active_connections)})")

    def unregister(self, websocket: WebSocket) -> None:
        client_id = self.client_id_map.pop(websocket, "unknown")
        self.active_connections.discard(websocket)
        print(f"[WebSocketBridge] Client disconnected: {client_id} (Total: {len(self.active_connections)})")

    async def handle_incoming_message(self, websocket: WebSocket, raw_message: str) -> None:
        """Handles incoming messages from desktop clients (tool results, ping, status)."""
        try:
            msg = json.loads(raw_message)
        except Exception as e:
            print(f"[WebSocketBridge] Invalid JSON from client: {e}")
            return

        msg_type = msg.get("type")

        if msg_type == "tool_result":
            call_id = msg.get("id")
            if call_id and call_id in self.pending_tool_calls:
                future = self.pending_tool_calls.pop(call_id)
                if not future.done():
                    future.set_result(msg.get("result"))

        elif msg_type == "ping":
            await websocket.send_json({"type": "pong", "timestamp": msg.get("timestamp")})

        elif msg_type == "handshake":
            print(f"[WebSocketBridge] Desktop handshake received: {msg.get('client_info', {})}")
            await websocket.send_json({
                "type": "handshake_ack",
                "status": "ready",
                "service": "sagesearch-agent",
                "supported_tools": ["search_files", "read_file_content", "extract_fields", "create_artifact", "ask_user"]
            })

    async def dispatch_tool_call(self, tool_name: str, params: Dict[str, Any], timeout: float = 15.0) -> Any:
        """Dispatches a tool call to connected desktop client or falls back to stubs."""
        if not self.is_client_connected:
            print(f"[WebSocketBridge] No desktop client connected. Executing local stub for '{tool_name}'.")
            if tool_name == "create_artifact":
                return {
                    "status": "error",
                    "error": "Desktop bridge is not connected; the artifact was not created locally."
                }
            return self._fallback_stub(tool_name, params)

        call_id = str(uuid.uuid4())
        loop = asyncio.get_running_loop()
        future = loop.create_future()
        self.pending_tool_calls[call_id] = future

        message = {
            "type": "tool_call",
            "id": call_id,
            "tool": tool_name,
            "params": params
        }

        # Broadcast to the active client
        target_socket = next(iter(self.active_connections))
        try:
            await target_socket.send_json(message)
            result = await asyncio.wait_for(future, timeout=timeout)
            return result
        except asyncio.TimeoutError:
            self.pending_tool_calls.pop(call_id, None)
            print(f"[WebSocketBridge] Tool call '{tool_name}' timed out after {timeout}s. Falling back to stub.")
            if tool_name == "create_artifact":
                return {
                    "status": "error",
                    "error": "Desktop bridge timed out; the artifact was not created locally."
                }
            return self._fallback_stub(tool_name, params)
        except Exception as e:
            self.pending_tool_calls.pop(call_id, None)
            print(f"[WebSocketBridge] Tool call '{tool_name}' failed with error ({e}). Falling back to stub.")
            if tool_name == "create_artifact":
                return {
                    "status": "error",
                    "error": f"Desktop bridge failed; the artifact was not created locally: {e}"
                }
            return self._fallback_stub(tool_name, params)

    async def broadcast_event(self, event_type: str, data: Dict[str, Any]) -> None:
        """Sends agent notifications, step progress, or approval requests to desktop."""
        payload = {"type": event_type, **data}
        dead_connections = set()

        for ws in self.active_connections:
            try:
                await ws.send_json(payload)
            except Exception:
                dead_connections.add(ws)

        for ws in dead_connections:
            self.unregister(ws)

    def _fallback_stub(self, tool_name: str, params: Dict[str, Any]) -> Any:
        """Fallback to internal mock stubs."""
        if tool_name == "search_files":
            return stub_search_files(**params)
        elif tool_name == "read_file_content":
            return stub_read_file_content(**params)
        elif tool_name == "extract_fields":
            return stub_extract_fields(**params)
        elif tool_name == "ask_user":
            return stub_ask_user(**params)
        elif tool_name == "create_artifact":
            return stub_create_artifact(**params)
        else:
            raise ValueError(f"Unknown tool: {tool_name}")
