import test from 'node:test';
import assert from 'node:assert/strict';
import { GameSession, locate, TILE } from '../src/level.js';
import { getObservation } from '../src/observation.js';
import { buildAgentState, requestDecision, planIntent, AgentController } from '../src/agent.js';
const response = (frames) => new Response(new ReadableStream({ start(c) {
  const bytes = new TextEncoder().encode(frames);
  for (let i = 0; i < bytes.length; i += 3) c.enqueue(bytes.slice(i, i + 3));
  c.close();
} }), { headers: { 'Content-Type': 'text/event-stream' } });
const decision = (intent, extra = {}) => `data: ${JSON.stringify({type:'decision',intent,...extra})}\n\n`;
const ready = () => { const s = new GameSession(); s.start(); s.firstGateOpen = true; s.memorySolved = true; s.memorySeen = true; s.pathSolved = true; s.player = {...s.key, y:s.key.y+TILE}; return s; };

test('observation excludes hidden map, monster coordinates, quiz solution', () => {
  const s = new GameSession();
  const o = getObservation(s);
  assert.equal(o.goal.exitVisible, false);
  assert.deepEqual(buildAgentState(s).monsterTile, {});
  assert(!o.surroundings.some(t => ['K','M','E'].includes(t.tile)));
  s.modal = 'document';
  const q = buildAgentState(s).question;
  assert.equal(q.correctId, undefined); assert.equal(q.options.length, 3);
});
test('SSE handles UTF8 and CRLF split across tiny chunks, ignores thinking', async () => {
  let sent;
  const result = await requestDecision('http://test/', {hasKey:false}, undefined, async (url, options) => {
    sent = {url, options};
    return response(('data: {"type":"agent_thinking","message":"hidden"}\n\n' + decision('GO_KEY', {reasoning:'尋找鑰匙'})).replaceAll('\n','\r\n'));
  });
  assert.equal(result.reason, '尋找鑰匙');
  assert.equal(sent.url, 'http://test/agent/decide'); assert.equal(sent.options.method, 'POST');
});
test('reject malformed, missing, unsupported decisions and invalid answers', async () => {
  for (const frame of ['data: nope\n\n', 'data: {"type":"done"}\n\n', decision('eval'), decision('ANSWER', {answerId:'D'})]) {
    await assert.rejects(requestDecision('http://test', {}, undefined, async () => response(frame)));
  }
  await assert.rejects(requestDecision('http://test', {}, undefined, async () => new Response('', {status:422})));
});
test('light gate cannot be bypassed by AI', () => {
  assert.throws(() => planIntent(new GameSession(), {intent:'GO_KEY'}));
});
async function runIntent(s, intent, answerId) {
  const c = new AgentController(s, () => {}, 'http://test', async () => response(decision(intent, {answerId})));
  await c.step();
  for (let i = 0; i < 10000 && c.active; i++) c.tick(16);
  assert.equal(c.active, false);
  return c;
}
test('AI moves through normal game update: key, lock, trap gap, document, answer, exit', async () => {
  const s = ready();
  await runIntent(s, 'GO_KEY'); assert.equal(s.hasKey, true);
  await runIntent(s, 'GO_LOCK'); assert.equal(s.lockOpen, true);
  await runIntent(s, 'GO_DOCUMENT'); assert.equal(s.modal, 'document'); assert.equal(s.respawns, 0);
  await runIntent(s, 'ANSWER', s.question.correctId); assert.equal(s.gateOpen, true); assert.equal(s.monsterActive, false);
  await runIntent(s, 'GO_EXIT'); assert.equal(s.won, true);
});
test('safe intent chooses a reachable safe area and respects collision', async () => {
  const s = ready(); s.lockOpen = true; s.gateOpen = true; s.documentAnswered = true;
  s.player = { ...locate('M') };
  await runIntent(s, 'GO_SAFE'); assert.equal(s.playerInSafeZone, true);
});
test('pause invalidates a late response and prevents double requests', async () => {
  const s = ready(); let resolve, calls = 0;
  const c = new AgentController(s, () => {}, 'http://test', () => { calls++; return new Promise(r => { resolve=r; }); });
  const p = c.step(); await c.step(); assert.equal(calls,1);
  c.pause(); resolve(response(decision('GO_KEY'))); await p;
  assert.equal(c.route.length,0); assert.deepEqual(s.player,{...s.key,y:s.key.y+TILE});
});
test('backend failure stops auto mode and preserves player state', async () => {
  const s = ready(); const c = new AgentController(s, () => {}, 'http://test', async () => { throw new Error('offline'); });
  c.running = true; await c.step(); assert.equal(c.active,false); assert.deepEqual(s.player,{...s.key,y:s.key.y+TILE});
});

test('deadline kills the run during a pending request and late decision cannot move it', async () => {
  const s = ready(); let resolve;
  const c = new AgentController(s, () => {}, 'http://test', () => new Promise(r => {resolve=r;}));
  const request=c.step();s.advanceTime(60000);c.tick(16);
  resolve(response(decision('GO_KEY')));await request;
  assert(s.dead);assert(!c.active);assert(!s.hasKey);assert.equal(c.route.length,0);
});
