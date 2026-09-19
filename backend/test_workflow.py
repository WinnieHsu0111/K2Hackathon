import json
import unittest
from unittest.mock import AsyncMock, patch
from agents.decide import GameState, decide

class WorkflowTests(unittest.IsolatedAsyncioTestCase):
    async def test_all_reports_reach_supervisor(self):
        with patch('agents.decide._run_tool', new=AsyncMock(side_effect=['clues','danger','goal'])) as specialist, patch('agents.decide._ask', new=AsyncMock(return_value='{"intent":"GO_KEY"}')) as supervisor:
            events = [json.loads(x[6:]) async for x in decide(GameState())]
        self.assertCountEqual([e['agent'] for e in events if e['type']=='agent_result'], ['Explorer','Survival','Navigator'])
        self.assertEqual(specialist.await_count, 3)
        for report in ['clues','danger','goal']:
            self.assertIn(report, supervisor.call_args.args[1])
        self.assertEqual(events[-1]['intent'], 'GO_KEY')

    async def test_model_failure_is_explicit(self):
        with patch('agents.decide._run_tool', new=AsyncMock(side_effect=RuntimeError('test'))), self.assertLogs('agents.decide', level='ERROR'):
            events = [json.loads(x[6:]) async for x in decide(GameState())]
        self.assertEqual(events[-1]['type'], 'error')
        self.assertFalse(any(e['type']=='decision' for e in events))

    async def test_opening_observations_and_action_parameters_survive(self):
        state = GameState(firstGateOpen=False, memorySolved=False, pathSolved=False,
                          lightPhase='input', observedLights=[2,2,4,1,3], visibleTiles=[{'x':12,'y':3,'tile':'C'}])
        output = '{"intent":"ENTER_LIGHTS","sequence":[2,2,4,1,3],"reasoning":"Replay observed sequence."}'
        with patch('agents.decide._run_tool', new=AsyncMock(return_value='report')) as specialist, patch('agents.decide._ask', new=AsyncMock(return_value=output)):
            events = [json.loads(x[6:]) async for x in decide(state)]
        self.assertIn('"observedLights": [2, 2, 4, 1, 3]', specialist.call_args.args[1])
        self.assertIn('Visible tiles', specialist.call_args.args[1])
        self.assertIn('"tile": "C"', specialist.call_args.args[1])
        self.assertEqual(events[-1]['sequence'], [2,2,4,1,3])
        self.assertEqual(events[-1]['intent'], 'ENTER_LIGHTS')

    async def test_specialists_start_together_before_supervisor(self):
        import asyncio
        entered = set()
        ready = asyncio.Event()
        async def specialist(name, summary):
            entered.add(name)
            if len(entered) == 3:
                ready.set()
            await asyncio.wait_for(ready.wait(), timeout=1)
            return name
        with patch('agents.decide._run_tool', side_effect=specialist), patch('agents.decide._ask', new=AsyncMock(return_value='{"intent":"GO_KEY"}')):
            events = [json.loads(x[6:]) async for x in decide(GameState())]
        self.assertEqual(len(entered), 3)
        self.assertEqual(events[-1]['type'], 'decision')
