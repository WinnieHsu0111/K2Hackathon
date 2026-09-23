import { SYMBOLS } from './puzzles.js';

// Three-level demo progression
export const LEVELS = [
  {
    id: 1,
    title: 'Light Sequence',
    subtitle: 'SPECIALIZATION',
    tagline: 'Supervisor alone → fails. Add Observer → succeeds.',
    phases: [
      { key: 'phaseA', label: 'Phase A', desc: 'Supervisor alone — no specialists', agentsUsed: ['Supervisor'] },
      { key: 'phaseB', label: 'Phase B', desc: 'Supervisor + Observer', agentsUsed: ['Supervisor', 'Explorer'] },
    ],
    complete: s => s.level1Complete,
    hint: 'Watch three colored lights flash in sequence, then repeat them in order.',
  },
  {
    id: 2,
    title: 'Shortest Path Ambush',
    subtitle: 'ROUTE MEMORY',
    tagline: 'Navigator chooses the shortest route; Survival reacts when it is watched.',
    phases: [
      { key: 'navigate', label: 'Navigate', desc: 'Observer + Navigator collaborate', agentsUsed: ['Supervisor', 'Explorer', 'Navigator'] },
    ],
    complete: s => s.level2Complete,
    hint: 'Take the shortest corridor once. If the monster appears, remember that route and take another.',
  },
  {
    id: 3,
    title: 'Monster Chase',
    subtitle: 'SURVIVAL & ESCAPE',
    tagline: 'Survival calls the danger; Navigator finds the safe route.',
    phases: [
      { key: 'conflict', label: 'Conflict', desc: 'All agents report, Supervisor decides', agentsUsed: ['Supervisor', 'Explorer', 'Survival', 'Navigator'] },
    ],
    complete: s => s.level3Complete,
    hint: 'The ambush wakes the monster. Reach the safe zone before choosing the exit.',
  },
];

export const STAGES = [
  { title: 'Light Sequence', short: 'Level 1', complete: s => s.demoLevel >= 2, hint: 'Specialization: Supervisor alone fails. Add Observer → succeeds.' },
  { title: 'Shortest Path Ambush', short: 'Level 2', complete: s => s.pathSolved, hint: 'The shortest route is watched. Remember the failed path.' },
  { title: 'Monster Chase', short: 'Level 3', complete: s => s.won, hint: 'Survival and Navigator coordinate the escape.' },
];

export function missionState(session) {
  const index = STAGES.findIndex(stage => !stage.complete(session));
  return { index: index < 0 ? STAGES.length - 1 : index, complete: index < 0 };
}

export function createMission() {
  const steps = document.getElementById('stage-progress');
  const levelBadge = document.getElementById('level-badge');
  const levelSubtitle = document.getElementById('level-subtitle');
  const levelTagline = document.getElementById('level-tagline');
  const agentChain = document.getElementById('agent-chain');

  steps?.replaceChildren(...STAGES.map((stage, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${String(i + 1).padStart(2, '0')}</span><b>${stage.short}</b>`;
    return li;
  }));

  const updateLevelUI = (levelId, phaseKey) => {
    const level = LEVELS.find(l => l.id === levelId) || LEVELS[0];
    const phase = level.phases.find(p => p.key === phaseKey) || level.phases[0];
    if (levelBadge) levelBadge.textContent = `LEVEL ${level.id} · ${level.subtitle}`;
    if (levelSubtitle) levelSubtitle.textContent = level.title;
    if (levelTagline) levelTagline.textContent = level.tagline;
    // Live agent chips are owned by createHub, using the same state as Control Room.

  };

  updateLevelUI(1, 'phaseA');

  return {
    draw(s, controller) {
      if (!s) return;
      const { index, complete } = missionState(s);
      const stage = STAGES[index];
      const set = (id, value) => { const node = document.getElementById(id); if (node && node.textContent !== value) node.textContent = value; };

      if (steps) {
        [...steps.children].forEach((li, i) => {
          const st = STAGES[i];
          if (!st) return;
          li.dataset.state = st.complete(s) ? 'done' : i === index ? 'active' : 'locked';
          li.setAttribute('aria-current', i === index ? 'step' : 'false');
        });
      }

      set('mission-number', complete ? 'ALL LEVELS COMPLETE' : `LEVEL ${String(index + 1).padStart(2, '0')} / 03`);
      set('mission-title', s.dead ? 'Signal lost' : !s.hasFlashlight ? 'Pick up the flashlight' : complete ? 'You escaped' : stage.title);
      set('mission-hint', s.dead ? s.deathReason : !s.hasFlashlight ? 'A flashlight is waiting at the entrance. Pick it up before exploring the dark rooms.' : complete ? 'The exit is open. You made it out.' : stage.hint);
      set('scene-location', `LEVEL 0 / ${stage?.title?.toUpperCase() || 'BACKROOMS'}`);
      set('scene-coordinates', `X ${Math.floor(s.player.x / 48)} · Y ${Math.floor(s.player.y / 48)}`);
      set('scene-activity', s.paused ? 'PAUSED' : !s.started ? 'AWAITING OPERATOR' : s.gameOver ? (s.won ? 'ESCAPED' : 'RUN ENDED') : controller?.busy ? 'AGENT THINKING' : s.modal ? 'PUZZLE INTERACTION' : controller?.route?.length ? 'MOVING' : 'MANUAL CONTROL');
      set('mission-inventory', s.hasKey ? `ARCHIVE KEY · CODE ${s.doorCode}${s.lockOpen ? ' · DOOR OPEN' : ''}` : 'ARCHIVE KEY NOT COLLECTED');
      set('equipment-status', `FLASHLIGHT ${s.hasFlashlight ? '✓' : '—'} / SCROLL ${s.hasDocument ? '✓' : '—'} / KEY ${s.hasKey ? '✓' : '—'}`);
      set('scene-message', s.message);

      // Level badge: detect current demo level from game state
      const currentLevel = s.pathSolved ? 3 : s.firstGateOpen ? 2 : 1;
      const phaseKey = (currentLevel === 1 && s.lightPhaseAFailed) ? 'phaseB' : currentLevel === 1 ? 'phaseA' : currentLevel === 2 ? 'navigate' : 'conflict';
      updateLevelUI(currentLevel, phaseKey);

      const recap = document.getElementById('puzzle-recap');
      if (recap) {
        // The demo has no calculus/document stage. Keep the old recap hidden so
        // stale answers from previous runs cannot appear as a fake objective.
        recap.hidden = true;
        if (s.documentAnswered) {
          const answer = s.question?.options?.find(option => option.id === s.documentAnswerId);
          const h2 = recap.querySelector('h2');
          if (h2) h2.textContent = 'LAST PUZZLE · ANSWERED';
          set('puzzle-recap-text', `${s.question?.prompt} — Selected ${answer?.id}: ${answer?.value}. ${s.documentAnswerId === s.question?.correctId ? 'Correct.' : 'Incorrect — the monster was released.'}`);
        } else if (s.memorySolved) {
          set('puzzle-recap-text', `Symbol memory verified: ${s.memorySequence?.map(symbol => SYMBOLS[symbol]).join('  ')}. Next: choose a corridor.`);
        } else if (s.firstGateOpen) {
          set('puzzle-recap-text', `Light sequence verified: ${s.lightSequence?.join(' → ')}. The first gate is open.`);
        }
      }
    }
  };
}
