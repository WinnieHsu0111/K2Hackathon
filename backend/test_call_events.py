"""Verify UI event ordering against the dynamic supervisor/tool loop."""
import json
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from agents.decide import GameState, decide


class CallEventTests(unittest.IsolatedAsyncioTestCase):
    async def test_supervisor_relights_after_specialist_returns(self):
        call = SimpleNamespace(id='call-1', function=SimpleNamespace(name='explorer'))
        # Use the supported tool identifier from the backend's schema.
        from agents.decide import _AGENT_LABEL
        call.function.name = next(name for name, value in _AGENT_LABEL.items() if value[0] == 'Explorer')
        tool_message = SimpleNamespace(tool_calls=[call], model_dump=lambda **kwargs: {})
        final_message = SimpleNamespace(tool_calls=None, content='{"intent":"GO_KEY"}')
        create = AsyncMock(side_effect=[SimpleNamespace(choices=[SimpleNamespace(message=tool_message)]), SimpleNamespace(choices=[SimpleNamespace(message=final_message)])])
        client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
        with patch('agents.decide.get_client', return_value=client), patch('agents.decide._run_tool', new=AsyncMock(return_value='A key is visible.')):
            events = [json.loads(frame[6:]) async for frame in decide(GameState())]
        self.assertEqual([(e['type'], e.get('agent')) for e in events], [
            ('agent_thinking', 'Supervisor'), ('agent_thinking', 'Explorer'),
            ('agent_result', 'Explorer'), ('agent_thinking', 'Supervisor'), ('decision', None),
        ])
        self.assertFalse(any(e.get('agent') in ('Navigator', 'Survival') for e in events))
