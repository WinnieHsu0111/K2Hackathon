import { TILE, tileAt } from './level.js';

// Only player-visible information belongs in the request. Never serialize GameSession.
export function getObservation(session, recentEvents = []) {
  const position = tileAt(session.player);
  const tiles = [];
  const visible = (x, y) => {
    const target = { x: (x + 0.5) * TILE, y: (y + 0.5) * TILE };
    const distance = Math.hypot(target.x - session.player.x, target.y - session.player.y);
    if (distance > TILE * 4) return false;
    const steps = Math.max(1, Math.ceil(distance / (TILE / 8)));
    for (let i = 1; i < steps; i++) {
      const p = tileAt({
        x: session.player.x + (target.x - session.player.x) * i / steps,
        y: session.player.y + (target.y - session.player.y) * i / steps,
      });
      if (p.x === x && p.y === y) continue;
      if (!session.canEnter(p.x, p.y)) return false;
    }
    return true;
  };
  for (let y = position.y - 4; y <= position.y + 4; y++) {
    for (let x = position.x - 4; x <= position.x + 4; x++) {
      if (!visible(x, y)) continue;
      let tile = session.cell(x, y);
      if (tile === 'X' || tile === 'M' || tile === 'P' || (tile === 'K' && session.hasKey)) tile = '.';
      tiles.push({ x, y, tile, walkable: session.canEnter(x, y) });
    }
  }
  const monsterTile = tileAt(session.monster);
  const monsterVisible = session.monsterActive && visible(monsterTile.x, monsterTile.y);
  const monsterDistance = Math.hypot(session.player.x - session.monster.x, session.player.y - session.monster.y) / TILE;
  const result = {
    player: { ...position, inSafeZone: session.playerInSafeZone },
    surroundings: tiles,
    inventory: { hasKey: session.hasKey },
    monster: {
      visible: monsterVisible,
      heard: session.monsterActive && monsterDistance <= 7,
      ...(monsterVisible ? { ...monsterTile, distance: Math.round(monsterDistance * 10) / 10 } : {}),
    },
    goal: { exitVisible: tiles.some((tile) => tile.tile === 'E'), complete: session.won },
    interaction: { type: session.modal },
    recentEvents: recentEvents.slice(-8),
  };
  // The message on a collected key is public evidence, not a hidden answer.
  // Capture that evidence through recentEvents rather than importing DOOR_CODE.
  if (session.modal === 'document') {
    result.interaction.document = {
      id: session.question.id, rule: session.question.rule, prompt: session.question.prompt,
      options: session.question.options.map((option) => ({ ...option })),
    };
  }
  if (session.modal === 'lights') {
    result.interaction.phase = session.lightPhase;
    result.interaction.activeLight = session.activeLight;
  }
  return result;
}
