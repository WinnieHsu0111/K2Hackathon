import test from 'node:test';
import assert from 'node:assert/strict';
import { idleAgents, applyAgentEvent } from '../src/hub-state.js';
import { missionState, STAGES } from '../src/mission.js';
import { GameSession } from '../src/level.js';

test('only called agents light up, repeated calls relight, parallel agents stay active', () => {
  let states=idleAgents();
  states=applyAgentEvent(states,{type:'agent_thinking',agent:'Supervisor'});
  assert.equal(states.Supervisor.state,'active');
  states=applyAgentEvent(states,{type:'agent_thinking',agent:'Survival'});
  assert.equal(states.Supervisor.state,'waiting');
  assert.equal(states.Survival.state,'active');
  assert.equal(states.Explorer.state,'idle');
  states=applyAgentEvent(states,{type:'agent_thinking',agent:'Navigator'});
  assert.equal(states.Survival.state,'active');
  states=applyAgentEvent(states,{type:'agent_result',agent:'Survival'});
  assert.equal(states.Survival.state,'done');
  assert.equal(states.Navigator.state,'active');
  states=applyAgentEvent(states,{type:'agent_thinking',agent:'Survival'});
  assert.equal(states.Survival.calls,2);
  assert.equal(states.Survival.state,'active');
  assert.equal(applyAgentEvent(states,{type:'agent_result',agent:'Game engine'}),states);
});

test('mission progresses through every puzzle; possessing key is not escape',()=>{
  const session=new GameSession();
  assert.equal(missionState(session).index,0);
  for (const [i,field] of ['firstGateOpen','memorySolved','pathSolved','hasKey','lockOpen','documentAnswered','won'].entries()) {
    assert.equal(missionState(session).index,i);
    session[field]=true;
    assert.equal(STAGES[i].complete(session),true);
    if(field==='hasKey') { assert.equal(missionState(session).index,4); assert.equal(missionState(session).complete,false); }
  }
  assert.equal(missionState(session).complete,true);
});

test('answered document keeps the actual selected option for the visible recap',()=>{
  const session=new GameSession();
  assert.equal(session.answer('A'),false);
  assert.equal(session.documentAnswerId,null);
  session.start();session.modal='document';
  const selected=session.question.options.find(option=>option.id!==session.question.correctId).id;
  assert.equal(session.answer(selected),true);
  assert.equal(session.documentAnswerId,selected);
  assert.equal(session.modal,null);
  assert.equal(session.monsterActive,true);
});
