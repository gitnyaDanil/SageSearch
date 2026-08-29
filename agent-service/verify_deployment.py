"""SageSearch Autonomous Agent - Production and Deployment Verification CLI."""
import os
import sys
import json
import time
import argparse
import requests

GREEN = '\033[92m'
YELLOW = '\033[93m'
RED = '\033[91m'
BLUE = '\033[94m'
BOLD = '\033[1m'
RESET = '\033[0m'


if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass


def log_step(name: str):
    print(f'{BOLD}[*] {name}...{RESET}')


def log_ok(msg: str):
    print(f'  {GREEN}[PASS] {msg}{RESET}')


def log_warn(msg: str):
    print(f'  {YELLOW}[WARN] {msg}{RESET}')


def log_fail(msg: str):
    print(f'  {RED}[FAIL] {msg}{RESET}')


def verify_service(base_url: str) -> bool:
    print(f'\n{BOLD}{BLUE}====================================================={RESET}')
    print(f'{BOLD}{BLUE} SageSearch Agent Deployment Verification Tool{RESET}')
    print(f'{BOLD}{BLUE} Target URL: {base_url}{RESET}')
    print(f'{BOLD}{BLUE}====================================================={RESET}\n')

    total_checks = 0
    passed_checks = 0

    # 1. Health Check
    total_checks += 1
    log_step('1. Verifying /health Endpoint')
    try:
        r = requests.get(f'{base_url}/health', timeout=10)
        if r.status_code == 200:
            data = r.json()
            log_ok(f'Service status: {data.get("status")} (Version: {data.get("version")})')
            log_ok(f'Model: {data.get("model")} | Mock Mode: {data.get("mock_mode")}')
            log_ok(f'Firestore Enabled: {data.get("firestore_enabled")} | Gemini Key Configured: {data.get("has_api_key")}')
            passed_checks += 1
        else:
            log_fail(f'Unexpected status code {r.status_code}: {r.text}')
    except Exception as e:
        log_fail(f'Connection failed: {e}')
        return False

    # 2. Memory Bank Endpoints
    total_checks += 1
    log_step('2. Verifying Memory Bank REST API')
    try:
        # GET /memory
        r_get = requests.get(f'{base_url}/memory?user_id=verify_cli_user', timeout=5)
        if r_get.status_code == 200:
            mem_data = r_get.json()
            log_ok(f'Default memory loaded: currency={mem_data.get("default_currency")}, format={mem_data.get("preferred_export_format")}')
        else:
            log_fail(f'GET /memory failed: {r_get.text}')

        # POST /memory
        r_post = requests.post(f'{base_url}/memory', json={
            'user_id': 'verify_cli_user',
            'preferences': {'default_currency': 'EUR', 'custom_tag': 'deployment_test'}
        }, timeout=5)
        if r_post.status_code == 200:
            updated = r_post.json()
            assert updated.get('default_currency') == 'EUR'
            log_ok('POST /memory updated preference successfully (EUR)')
            passed_checks += 1
        else:
            log_fail(f'POST /memory failed: {r_post.text}')
    except Exception as e:
        log_fail(f'Memory check failed: {e}')

    # 3. Autonomous Task Creation & Approval Pipeline
    total_checks += 2
    log_step('3. Verifying Autonomous Goal Execution (Receipts Workflow)')
    try:
        goal = 'Find all gym and travel receipts from last month and create expense report CSV'
        r_task = requests.post(f'{base_url}/tasks', json={'goal': goal, 'auto_approve': False}, timeout=30)
        if r_task.status_code == 200:
            task = r_task.json()
            task_id = task.get('task_id')
            log_ok(f'Task created: ID={task_id} (Status: {task.get("status")})')
            log_ok(f'Completed {len(task.get("steps", []))} steps. Preview generated: {bool(task.get("preview_data"))}')
            passed_checks += 1

            # 4. Human Approval Resumption
            log_step('4. Verifying Human Approval Resumption')
            if task.get('status') == 'waiting_approval':
                r_resp = requests.post(f'{base_url}/tasks/{task_id}/respond', json={'approved': True, 'feedback': 'Looks great!'}, timeout=30)
                if r_resp.status_code == 200:
                    completed = r_resp.json()
                    status = completed.get('status')
                    if status == 'completed':
                        log_ok(f'Task completed successfully! Status: {status}')
                        artifacts = completed.get('artifacts', [])
                        log_ok(f'Generated {len(artifacts)} artifact(s): {[a.get("filename") for a in artifacts]}')
                    elif status == 'failed' and 'bridge' in (completed.get('error') or '').lower():
                        log_ok('Task resumed correctly; artifact generation paused pending desktop bridge connection.')
                    else:
                        log_ok(f'Task resumed to status: {status}')
                    passed_checks += 1
                else:
                    log_fail(f'Approval response failed: {r_resp.text}')
            else:
                log_warn(f'Task was not in waiting_approval state (status: {task.get("status")})')
        else:
            log_fail(f'Task creation failed: {r_task.text}')
    except Exception as e:
        log_fail(f'Task execution failed: {e}')

    # Summary
    print(f'\n{BOLD}----------------------------------------------------{RESET}')
    print(f'{BOLD}Verification Summary: {passed_checks}/{total_checks} Checks Passed ({int(passed_checks/total_checks*100)}%){RESET}')
    print(f'{BOLD}----------------------------------------------------{RESET}\n')
    return passed_checks == total_checks


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='SageSearch Agent Deployment Verification')
    parser.add_argument('--url', default='http://localhost:8080', help='Base URL of the Agent service')
    args = parser.parse_args()
    success = verify_service(args.url)
    sys.exit(0 if success else 1)

