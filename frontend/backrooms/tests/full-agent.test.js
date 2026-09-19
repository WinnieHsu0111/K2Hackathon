import test from 'node:test';
import assert from 'node:assert/strict';
import { GameSession } from '../src/level.js';
import { AgentController } from '../src/agent.js';

for (let seed = 1; seed <= 3; seed++) test(`AI completes every opening room from observations, seed ${seed}`, async () => {
  let value = seed;
  const rng = () => ((value = (value * 16807) % 2147483647) - 1) / 2147483646;
  const s = new GameSession({rng});
  const seen = [];
  const fetcher = async (_, opts) => {
    const state = JSON.parse(opts.body); seen.push(state);
    let d;
    if (!state.firstGateOpen) d = state.lightPhase === 'input'
      ? {intent:'ENTER_LIGHTS', sequence:state.observedLights} : {intent:'WATCH_LIGHTS'};
    else if (!state.memorySolved) d = state.memoryOptions.length
      ? {intent:'ANSWER_MEMORY', memoryIndex:state.memoryOptions.findIndex(x => JSON.stringify(x) === JSON.stringify(state.observedSymbols))} : {intent:'GO_MEMORY'};
    else if (!state.pathSolved) d = {intent:'TRY_PATH', path:['LEFT','CENTER','RIGHT'].find(x => !state.triedPaths.includes(x))};
    else d = {intent:'GO_KEY'};
    return new Response(`data: ${JSON.stringify({type:'decision', ...d})}\n\n`, {headers:{'content-type':'text/event-stream'}});
  };
  const statuses=[];
  const c = new AgentController(s, e => {if(e.status) statuses.push(e.status);}, 'http://test', fetcher);
  c.start();
  for(let i=0;i<15000 && !s.hasKey && !s.gameOver && c.active;i++) {
    if(!c.busy) s.advanceTime(16);
    c.tick(16);
    if(c.busy) await new Promise(r => setImmediate(r));
  }
  assert(s.hasKey, JSON.stringify({statuses,phase:s.lightPhase, lights:c.evidence.lights,memory:s.memoryPhase, pos:s.player,time:s.timeLeft}));
  assert(s.firstGateOpen && s.memorySolved && s.pathSolved);
  assert(seen.some(x => x.observedLights.length === 5));
  assert(seen.some(x => x.observedSymbols.length === 5));
  c.pause();
});

test('startup observes lights before requesting a model decision', async () => {
  const s = new GameSession({rng:()=>0.4});
  let finish;
  const c = new AgentController(s,()=>{},'http://test',()=>new Promise(resolve=>{finish=resolve;}));
  const start = {...s.player};
  c.start();
  assert.equal(c.busy, false);
  for(let i=0;i<1000;i++){s.advanceTime(16);c.tick(16);}
  assert(c.busy);
  assert.notDeepEqual(s.player,start);
  assert.equal(s.lightPhase,'input');
  assert.equal(c.evidence.lights.length,5);
  const observed = [...c.evidence.lights];
  finish(new Response('data: {"type":"decision","intent":"WATCH_LIGHTS"}\n\n',{headers:{'content-type':'text/event-stream'}}));
  await new Promise(r=>setImmediate(r));
  assert.deepEqual(c.evidence.lights,observed);
  assert.equal(s.lightPhase,'input');
  c.pause();
});
