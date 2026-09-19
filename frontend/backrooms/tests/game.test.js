import test from 'node:test';
import assert from 'node:assert/strict';
import { GameSession, MAP, TILE, RUN_SPEED, MONSTER_STATE, WAKE_TIME, center, tileAt, locate, findPath } from '../src/level.js';
import { proximityLevel } from '../src/audio.js';

function walkTo(state, goal) {
  const path = findPath(tileAt(state.player), tileAt(goal), (x, y) => state.canEnter(x, y) && state.cell(x, y) !== 'T');
  assert.deepEqual(path.at(-1), tileAt(goal), 'destination must be reachable');
  for (const tile of path.slice(1)) {
    const waypoint = center(tile.x, tile.y);
    for (let i = 0; i < 100; i++) {
      if (state.modal || state.won) return;
      const x = waypoint.x - state.player.x, y = waypoint.y - state.player.y;
      const distance = Math.hypot(x, y);
      if (distance < 0.01) break;
      state.update(Math.min(16, distance / RUN_SPEED * 1000), { x, y, sprint: true });
      if (i === 99) assert.fail('movement got stuck');
    }
  }
}

function reachDocument() {
  const state = new GameSession();
  walkTo(state, locate('K'));
  assert.equal(state.hasKey, true);
  walkTo(state, state.trapRoomRespawn);
  state.update(80, { y: 1 });
  assert.equal(state.modal, 'lock');
  assert.equal(state.unlock('000'), false);
  assert.equal(state.lockOpen, false);
  assert.equal(state.unlock('042'), true);
  walkTo(state, state.document);
  assert.equal(state.modal, 'document');
  return state;
}

test('the supplied map has one safe tile in the trap row', () => {
  assert.ok(MAP.every((row) => row.length === 25));
  assert.equal(MAP.length, 20);
  assert.deepEqual([...MAP[10]].flatMap((cell, x) => cell === '.' ? [x] : []), [11]);
});

test('closed lock and document gate block player movement', () => {
  const state = new GameSession();
  state.player = { ...state.trapRoomRespawn };
  for (let i = 0; i < 20; i++) state.update(100, { y: 1, sprint: true });
  assert.equal(state.modal, null);
  assert.ok(state.player.y < 7 * TILE);
  assert.equal(state.unlock('042'), false);
  const gate = tileAt(locate('G'));
  assert.equal(state.canEnter(gate.x, gate.y), false);
});

test('full correct-answer route: key, code, one-tile gap, document, exit', () => {
  const state = reachDocument();
  assert.equal(state.respawns, 0);
  assert.equal(state.answer('C'), true);
  assert.equal(state.gateOpen, true);
  assert.equal(state.monsterActive, false);
  walkTo(state, state.exit);
  assert.equal(state.won, true);
});

test('trap contact respawns outside the room and retains the unlocked door', () => {
  const state = new GameSession();
  state.hasKey = true;
  state.lockOpen = true;
  state.player = center(6, 9);
  for (let i = 0; i < 10 && !state.respawns; i++) state.update(100, { y: 1, sprint: true });
  assert.equal(state.respawns, 1);
  assert.deepEqual(state.player, state.trapRoomRespawn);
  assert.equal(state.hasKey, true);
  assert.equal(state.lockOpen, true);
  assert.equal(state.gateOpen, false);
});

test('canceling a modal requires leaving and reapproaching to reopen it', () => {
  const state = reachDocument();
  state.dismiss();
  state.update(16);
  assert.equal(state.modal, null);
  state.player = center(10, 11);
  state.update(16);
  walkTo(state, state.document);
  assert.equal(state.modal, 'document');
});

test('wrong answer opens the gate and starts pursuit; answer cannot be replaced', () => {
  const state = reachDocument();
  state.answer('A');
  assert.equal(state.gateOpen, true);
  assert.equal(state.monsterActive, true);
  assert.equal(state.answer('C'), false);
  const start = { x: state.monster.x, y: state.monster.y };
  for (let elapsed = 0; elapsed < WAKE_TIME; elapsed += 100) state.update(100);
  state.update(100);
  assert.notDeepEqual({ x: state.monster.x, y: state.monster.y }, start);
});

test('wrong-answer route can reach the first shelter before capture', () => {
  const state = reachDocument();
  state.answer('B');
  walkTo(state, center(5, 14));
  assert.equal(state.respawns, 0);
  assert.equal(state.playerInSafeZone, true);
  assert.equal(state.monster.state, MONSTER_STATE.PATROL);
});

test('shelter sends the monster away on patrol instead of despawning or camping', () => {
  const state = reachDocument();
  state.answer('A');
  state.wakeRemaining = 0;
  state.player = center(5, 14);
  const start = { x: state.monster.x, y: state.monster.y };
  for (let i = 0; i < 150; i++) {
    state.update(100);
    assert.ok(state.occupied(state.monster, 12).every(({ x, y }) => state.canEnter(x, y, true)));
    assert.equal(state.monster.state, MONSTER_STATE.PATROL);
    assert.equal(state.monsterActive, true);
  }
  assert.ok(Math.hypot(state.monster.x - start.x, state.monster.y - start.y) > TILE);
  assert.equal(state.respawns, 0);
});

test('wrong-answer route can wait for patrol, move between shelters, and reach the exit', () => {
  const state = reachDocument();
  state.answer('A');
  walkTo(state, center(5, 14));
  for (let i = 0; i < 30; i++) state.update(100);
  for (const point of [center(4, 16), center(4, 18), center(17, 18), center(17, 16), state.exit]) walkTo(state, point);
  assert.equal(state.respawns, 0);
  assert.equal(state.won, true);
});

test('leaving shelter unseen keeps patrol; visible player triggers chase again', () => {
  const state = reachDocument();
  state.answer('A');
  state.wakeRemaining = 0;
  state.monster = { ...center(20, 15), target: null, state: MONSTER_STATE.CHASE };
  state.player = center(5, 14);
  state.update(100);
  assert.equal(state.monster.state, MONSTER_STATE.PATROL);
  state.player = center(4, 14);
  state.update(100);
  assert.equal(state.monster.state, MONSTER_STATE.PATROL);
  state.monster = { ...center(20, 18), target: null, state: MONSTER_STATE.PATROL };
  state.player = center(19, 18);
  state.update(16);
  assert.equal(state.monster.state, MONSTER_STATE.CHASE);
});

test('walls block sight; losing the player starts a timed search of the last known location', () => {
  const state = reachDocument();
  state.answer('A');
  state.wakeRemaining = 0;
  state.monster = { ...center(16, 4), target: null, state: MONSTER_STATE.CHASE };
  state.player = center(16, 6);
  assert.equal(state.canMonsterSeePlayer(), false);
  assert.equal(state.hasLineOfSight(center(14, 4), center(18, 4)), true);
  state.lastSeen = { x: 16, y: 4 };
  state.player = locate('P');
  state.update(100);
  assert.equal(state.monster.state, MONSTER_STATE.SEARCH);
  for (let i = 0; i < 30; i++) state.update(100);
  assert.equal(state.monster.state, MONSTER_STATE.PATROL);
});

test('all three shelters contain four tiles and hide the player', () => {
  const state = new GameSession();
  assert.equal(MAP.join('').split('S').length - 1, 12);
  for (const point of [center(5, 14), center(17, 15), center(3, 17)]) {
    state.player = point;
    assert.equal(state.playerInSafeZone, true);
    assert.equal(state.canMonsterSeePlayer(), false);
  }
});

test('distance sound fades continuously with distance and has a finite radius', () => {
  const player = center(5, 14);
  assert.equal(proximityLevel(player, player), 1);
  assert.ok(proximityLevel(player, center(6, 14)) > proximityLevel(player, center(10, 14)));
  assert.equal(proximityLevel(player, center(15, 14)), 0);
});

test('capture returns to the document checkpoint and resets the question branch', () => {
  const state = reachDocument();
  state.answer('A');
  state.wakeRemaining = 0;
  state.monster = { ...state.player, target: null, state: MONSTER_STATE.CHASE };
  state.update(16);
  assert.deepEqual(state.player, state.documentRespawn);
  assert.equal(state.respawns, 1);
  assert.equal(state.gateOpen, false);
  assert.equal(state.monsterActive, false);
  assert.equal(state.documentAnswered, false);
  assert.equal(state.lockOpen, true);
  walkTo(state, state.document);
  assert.equal(state.modal, 'document');
});

test('modal pauses movement; restart creates a clean session', () => {
  const state = reachDocument();
  const position = { ...state.player };
  state.update(100, { x: 1, sprint: true });
  assert.deepEqual(state.player, position);
  assert.equal(state.monsterActive, false);
  const fresh = new GameSession();
  assert.deepEqual(fresh.player, locate('P'));
  assert.equal(fresh.hasKey, false);
  assert.equal(fresh.lockOpen, false);
  assert.equal(fresh.gateOpen, false);
  assert.equal(fresh.monsterActive, false);
});
