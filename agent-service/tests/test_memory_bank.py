"""Tests for SageSearch Memory Bank."""
import pytest
from fastapi.testclient import TestClient
from agent.state import TaskStateManager
from agent.core import SageSearchAgent
from api.server import app

client = TestClient(app)

def test_state_manager_memory_crud():
    mgr = TaskStateManager(use_firestore=False)
    mem = mgr.get_user_memory('user_1')
    assert mem['default_currency'] == 'USD'
    assert mem['preferred_export_format'] == 'csv'
    assert 'Gym / Fitness' in mem['learned_categories']

    mgr.save_user_memory('user_1', {'default_currency': 'EUR', 'tax_rate': 0.19})
    updated = mgr.get_user_memory('user_1')
    assert updated['default_currency'] == 'EUR'
    assert updated['tax_rate'] == 0.19

    mgr.delete_user_memory('user_1', 'tax_rate')
    after_del = mgr.get_user_memory('user_1')
    assert 'tax_rate' not in after_del

    cleared = mgr.clear_user_memory('user_1')
    assert cleared['default_currency'] == 'USD'


def test_agent_memory_prompt_injection():
    mgr = TaskStateManager(use_firestore=False)
    mgr.save_user_memory('default_user', {
        'default_currency': 'GBP',
        'preferred_export_format': 'markdown'
    })
    agent = SageSearchAgent(state_manager=mgr, mock_mode=True)
    prompt = agent._get_system_instructions('default_user')
    assert 'GBP' in prompt
    assert 'markdown' in prompt


def test_memory_rest_api_endpoints():
    # 1. GET /memory
    res = client.get('/memory?user_id=test_api_user')
    assert res.status_code == 200
    data = res.json()
    assert 'default_currency' in data

    # 2. POST /memory
    update_res = client.post('/memory', json={
        'user_id': 'test_api_user',
        'preferences': {'default_currency': 'JPY', 'custom_note': 'Tokyo trip'}
    })
    assert update_res.status_code == 200
    updated_data = update_res.json()
    assert updated_data['default_currency'] == 'JPY'
    assert updated_data['custom_note'] == 'Tokyo trip'

    # 3. DELETE /memory/{key}
    del_res = client.delete('/memory/custom_note?user_id=test_api_user')
    assert del_res.status_code == 200
    assert 'custom_note' not in del_res.json()

    # 4. POST /memory/clear
    clear_res = client.post('/memory/clear?user_id=test_api_user')
    assert clear_res.status_code == 200
    assert clear_res.json()['default_currency'] == 'USD'
