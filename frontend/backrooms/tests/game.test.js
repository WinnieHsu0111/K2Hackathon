import test from 'node:test';
import assert from 'node:assert/strict';
import { GameSession, MAP, TILE, center, tileAt, locate, findPath, checkLightCode, MONSTER_STATE, PATROL_POINTS } from '../src/level.js';
import { generateQuestion, generatePuzzles } from '../src/puzzles.js';
import { proximityLevel } from '../src/audio.js';
export const seeded = (seed) => () => ((seed = (Math.imul(seed,1664525)+1013904223)>>>0) / 4294967296);
export function tick(s, ms, input = {}) { s.advanceTime(ms); s.update(ms,input); }
export function walk(s, point) {
  const target = tileAt(point);
  const path = findPath(tileAt(s.player), target, (x,y) => s.canEnter(x,y) && s.cell(x,y)!=='T');
  assert.deepEqual(path.at(-1),target, 'destination must be reachable');
  for (const tile of path) {
    const destination = center(tile.x,tile.y);
    for(let frame=0;frame<1000;frame++) {
      if(s.modal || s.gameOver) return;
      const dx=destination.x-s.player.x,dy=destination.y-s.player.y,d=Math.hypot(dx,dy);
      if(d<.01)break;
      const ms=Math.min(16,d/220*1000);
      tick(s,ms,{x:dx,y:dy,sprint:true});
      if(frame===999)throw new Error('stuck');
    }
  }
}
export function newRun(seed=1) { const s=new GameSession({rng:seeded(seed)});s.start();return s; }
export function lightRoom(s) {
  walk(s,s.lightConsole);s.interact(); assert.equal(s.modal,'lights');
  s.advanceTime(4900); assert.equal(s.lightPhase,'input');
  for(const id of s.lightSequence)s.pressLight(id);
  assert(s.firstGateOpen);assert.equal(s.modal,null);
}
export function earlyRooms(s) {
  lightRoom(s); walk(s,center(12,5));assert.equal(s.modal,'memory');
  s.advanceTime(3000);assert.equal(s.modal,null);
  walk(s,s.memoryConsole);s.interact();assert.equal(s.modal,'memory');s.answerMemory(s.memoryAnswer);
  const x={LEFT:4,CENTER:12,RIGHT:20}[s.correctPath];
  walk(s,center(x,14));assert(s.pathSolved);
}
export function toDocument(s) {
  earlyRooms(s);walk(s,s.key);assert(s.hasKey);
  walk(s,center(12,15));tick(s,90,{y:1});assert.equal(s.modal,'lock');
  assert(s.unlock(s.doorCode));walk(s,s.document);assert.equal(s.modal,'document');
}

test('rectangular map: all three paths connect, exactly one safe trap gap, patrol points traversable',()=>{
  assert(MAP.every(r=>r.length===25));assert.equal(MAP[18].slice(5,20).replaceAll('T','').length,1);
  for(const correctPath of ['LEFT','CENTER','RIGHT']) {
    const s=newRun();s.memorySolved=true;s.firstGateOpen=true;s.correctPath=correctPath;
    const path=findPath({x:12,y:8},{x:9,y:14},(x,y)=>s.canEnter(x,y)&&s.cell(x,y)!=='X');
    assert.deepEqual(path.at(-1),{x:9,y:14});
    assert.equal([4,12,20].filter(x=>s.cell(x,13)==='X').length,2);
  }
  const s=newRun();assert(PATROL_POINTS.every(p=>s.canEnter(p.x,p.y,true)));
});
test('fresh puzzles and all four calculus categories have three distinct choices and a shuffled answer',()=>{
  const categories=new Set(),answers=new Set(),fingerprints=new Set();
  for(let i=1;i<=200;i++) {
    const p=generatePuzzles(seeded(i*499));
    assert.match(p.doorCode,/^[1-9][0-9]{3}$/);assert.equal(p.lightSequence.length,5);
    assert.equal(new Set(p.memorySequence).size,5);
    assert.equal(new Set(p.memoryOptions.map(a=>a.join())).size,3);
    const q=p.question;assert.equal(new Set(q.options.map(o=>o.value)).size,3);
    assert(q.options.some(o=>o.id===q.correctId));categories.add(q.category);answers.add(q.correctId);
    const {a,b,n}=q.parameters;
    const expected=[`${a*n}(${a}x + ${b})^${n-1}`,`(x² + ${b})^${n+1} / ${n+1} + C`,String(2*a),`${a*n}x^${n-1} + ${b}`][q.category];
    assert.equal(q.options.find(o=>o.id===q.correctId).value,expected);
    fingerprints.add(JSON.stringify(p));
  }
  assert.equal(categories.size,4);assert.equal(answers.size,3);assert.equal(fingerprints.size,200);
});
test('no countdown before start; deadline advances through dialogs and long stalled frames',()=>{
  const s=new GameSession();s.advanceTime(100000);assert.equal(s.timeLeft,60000);
  s.start();s.modal='lights';s.advanceTime(59000);assert.equal(s.timeLeft,1000);
  s.advanceTime(1000);assert(s.dead);assert.equal(s.deathReason,'TIME OUT');assert.equal(s.modal,null);
  const before={...s.player};s.update(100,{x:1});assert.deepEqual(s.player,before);
});
test('light validation rejects empty/partial/sparse/wrong input; repeated colors allowed',()=>{
  const sequence=[2,2,1,4,2];
  for(const value of [[],[2],new Array(5),[2,2,1,4,2,3],[1,2,1,4,2]])assert(!checkLightCode(value,sequence));
  assert(checkLightCode(sequence,sequence));
});
test('light retry replays sequence, consumes clock, and blocks premature input',()=>{
  const s=newRun();s.player={...s.lightConsole};s.interact();assert(!s.pressLight(1));
  s.advanceTime(4900);const wrong=s.lightSequence.map(id=>id%4+1);wrong.forEach(id=>s.pressLight(id));
  assert.equal(s.lightPhase,'playback');assert(!s.firstGateOpen);assert.equal(s.lightInput.length,0);
  s.advanceTime(4900);s.lightSequence.forEach(id=>s.pressLight(id));assert(s.firstGateOpen);assert.equal(s.timeLeft,50200);
});
test('memory barrier, 3-second reveal, wrong-answer replay and correct unlock',()=>{
  const s=newRun();s.firstGateOpen=true;s.player={...s.memoryConsole};assert(!s.canEnter(12,9));s.interact();
  assert.equal(s.memoryPhase,'reveal');assert(!s.answerMemory(s.memoryAnswer));s.advanceTime(2999);assert.equal(s.memoryPhase,'reveal');
  s.advanceTime(1);assert.equal(s.memoryPhase,'input');assert(!s.answerMemory((s.memoryAnswer+1)%3));assert.equal(s.memoryPhase,'reveal');
  s.advanceTime(3000);assert(s.answerMemory(s.memoryAnswer));assert(s.canEnter(12,9));
});
test('wrong corridor returns to entrance without regenerating answers or restoring time',()=>{
  const s=newRun();s.memorySolved=true;s.firstGateOpen=true;s.memorySeen=true;
  const wrong=[4,12,20].find(x=>s.cell(x,13)==='X');s.player=center(wrong,12);const code=s.doorCode;
  tick(s,100,{y:1,sprint:true});tick(s,100,{y:1,sprint:true});
  assert.deepEqual(s.player,s.wrongPathRespawn);assert.equal(s.respawns,1);assert.equal(s.doorCode,code);assert.equal(s.timeLeft,59800);
});
test('full timed winning route is feasible for all three randomized path choices',()=>{
  const paths=new Set();
  for(let seed=1;seed<30;seed++) {
    const s=newRun(seed);paths.add(s.correctPath);toDocument(s);assert(s.answer(s.question.correctId));walk(s,s.exit);
    assert(s.won,`seed ${seed} time ${s.timeLeft}`);assert(s.timeLeft>0);assert(!s.monsterActive);
    const remaining=s.timeLeft;s.advanceTime(90000);assert.equal(s.timeLeft,remaining);assert(!s.dead);
  }
  assert.equal(paths.size,3);
});
test('door needs collected key and exact session code, including four digits',()=>{
  const s=newRun();s.modal='lock';assert(!s.unlock(s.doorCode));s.hasKey=true;
  assert(!s.unlock('042'));assert(!s.unlock('abcd'));assert(s.unlock(s.doorCode));
});
test('trap teleports outside door while preserving clock, key and unlocked gates',()=>{
  const s=newRun();s.hasKey=true;s.lockOpen=true;s.player=center(10,17);const before=s.timeLeft;
  tick(s,100,{y:1,sprint:true});assert.deepEqual(s.player,s.trapRoomRespawn);
  assert(s.hasKey&&s.lockOpen);assert(!s.dead);assert(s.timeLeft<before);
});
test('wrong calculus answer opens gate and awakens monster; capture ends the run',()=>{
  const s=newRun();toDocument(s);const wrong=s.question.options.find(o=>o.id!==s.question.correctId).id;
  assert(s.answer(wrong));assert(s.gateOpen&&s.monsterActive);assert(!s.answer(s.question.correctId));
  s.player={...s.monster};s.wakeRemaining=0;s.updateMonster(16);assert(s.dead);assert.equal(s.deathReason,'CAUGHT BY THE MONSTER');
  const fresh=newRun(999);assert.equal(fresh.timeLeft,60000);assert(!fresh.hasKey&&!fresh.gateOpen&&!fresh.firstGateOpen);assert.notEqual(fresh.doorCode,s.doorCode);
});
test('safe zones exclude monster and send it on patrol; leaving unseen does not auto-chase',()=>{
  const s=newRun();s.player=center(5,23);s.monsterActive=true;s.monster.state=MONSTER_STATE.CHASE;s.monster.x=center(9,23).x;s.monster.y=center(9,23).y;
  assert(s.playerInSafeZone);assert(!s.canEnter(5,23,true));s.updateMonster(16);assert.equal(s.monster.state,MONSTER_STATE.PATROL);
  assert(Math.hypot(s.patrolGoal.x-5,s.patrolGoal.y-23)>6);
  s.player=center(1,22);s.monster.x=center(22,26).x;s.monster.y=center(22,26).y;s.updateMonster(16);assert.equal(s.monster.state,MONSTER_STATE.PATROL);
});
test('distance music uses 15 tiles and fades monotonically',()=>{
  assert.equal(proximityLevel({x:0,y:0},{x:0,y:0}),1);
  assert.equal(proximityLevel({x:0,y:0},{x:TILE*15,y:0}),0);
  assert(proximityLevel({x:0,y:0},{x:TILE*3,y:0})>proximityLevel({x:0,y:0},{x:TILE*10,y:0}));
});

test('wrong-answer branch can reach shelter, let patrol leave, and escape before deadline',()=>{
  const s=newRun(8);toDocument(s);s.answer(s.question.options.find(o=>o.id!==s.question.correctId).id);
  walk(s,center(5,22));assert(s.playerInSafeZone);assert(!s.dead);
  for(let i=0;i<180;i++)tick(s,16);
  assert.equal(s.monster.state,MONSTER_STATE.PATROL);
  walk(s,center(18,22));walk(s,s.exit);assert(s.won);assert(s.timeLeft>0);
});
