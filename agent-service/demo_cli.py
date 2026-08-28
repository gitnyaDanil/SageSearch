"""Interactive CLI Demo for SageSearch Autonomous Agent."""
import sys
import os

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from agent.core import SageSearchAgent
from agent.state import TaskStateManager


def run_demo():
    print("=" * 70)
    print("  SageSearch Autonomous Agent — Day 1 Taskmaster Demo")
    print("=" * 70)

    state_manager = TaskStateManager(use_firestore=False)
    agent = SageSearchAgent(state_manager=state_manager, mock_mode=True)

    goal = "Find all gym and travel receipts from last month, extract the amounts, and create an expense report CSV"
    print(f"\n[GOAL] {goal}\n")

    print("[AGENT] Formulating execution plan...")
    state = agent.execute_goal(goal=goal, auto_approve=False)

    print(f"[STATUS] {state.status.upper()}")
    print(f"[PLAN]   {state.plan_overview}\n")

    print("--- Executed Steps ---")
    for step in state.steps:
        status_icon = "[DONE]" if step.status == "completed" else "[BUSY]"
        print(f"{status_icon} Step {step.step_index}: {step.title}")
        if step.tool_name:
            print(f"       Tool: {step.tool_name}")

    if state.status == "waiting_approval" and state.preview_data:
        print("\n--- Structured Preview Table ---")
        cols = state.preview_data.get("columns", [])
        rows = state.preview_data.get("rows", [])
        
        # Print table header
        header = " | ".join(f"{c:<20}" for c in cols)
        print(header)
        print("-" * len(header))
        for row in rows:
            print(" | ".join(f"{str(cell):<20}" for cell in row))

        summary = state.preview_data.get("summary", {})
        print("-" * len(header))
        print(f"Summary: {summary.get('total_receipts')} receipts | Total: {summary.get('total_expense')}\n")

        print(f"[USER APPROVAL PROMPT] {state.approval_prompt}")
        print(">> Auto-approving for Day 1 automated demo...")

        final_state = agent.resume_task(state.task_id, approved=True)

        print("\n--- Final Step ---")
        for step in final_state.steps[len(state.steps):]:
            status_icon = "[DONE]" if step.status == "completed" else "[BUSY]"
            print(f"{status_icon} Step {step.step_index}: {step.title}")

        print(f"\n[FINAL STATUS] {final_state.status.upper()}")
        print(f"[RESULT] {final_state.final_summary}")
        if final_state.artifacts:
            print(f"[ARTIFACT GENERATED] {final_state.artifacts[0].get('saved_path')} ({final_state.artifacts[0].get('byte_count')} bytes)")

    print("\n" + "=" * 70)


if __name__ == "__main__":
    run_demo()
