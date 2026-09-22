import { SYMBOLS } from './puzzles.js';
export const STAGES = [
  { title: 'Light sequence', short: 'Lights', complete: s => s.firstGateOpen, hint: 'Reach console C. Watch five colored flashes and repeat their order.' },
  { title: 'Symbol memory', short: 'Memory', complete: s => s.memorySolved, hint: 'Reach console R. Memorize five symbols before they disappear.' },
  { title: 'Three corridors', short: 'Paths', complete: s => s.pathSolved, hint: 'Choose left, center or right. False paths return you to the entrance.' },
  { title: 'Find the key', short: 'Key', complete: s => s.hasKey, hint: 'Collect the key in the next room. Its tag carries a four-digit code.' },
  { title: 'The archive door', short: 'Lock', complete: s => s.lockOpen, hint: 'Your key and its tag code open the archive door, not the final exit.' },
  { title: 'Calculus file', short: 'Question', complete: s => s.documentAnswered, hint: 'Cross the safe passage and pick up the rolled scroll. Choose an answer; a mistake wakes the monster.' },
  { title: 'Escape', short: 'Exit', complete: s => s.won, hint: 'Reach the exit. Use green shelters if the monster is chasing you.' },
];
export function missionState(session) {
  const index = STAGES.findIndex(stage => !stage.complete(session));
  return { index: index < 0 ? STAGES.length - 1 : index, complete: index < 0 };
}
export function createMission() {
  const steps = document.getElementById('stage-progress');
  steps.replaceChildren(...STAGES.map((stage, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${String(i + 1).padStart(2, '0')}</span><b>${stage.short}</b>`;
    return li;
  }));
  return { draw(s, controller) {
    const { index, complete } = missionState(s);
    const stage = STAGES[index];
    const set = (id, value) => { const node = document.getElementById(id); if (node.textContent !== value) node.textContent = value; };
    [...steps.children].forEach((li, i) => { li.dataset.state = STAGES[i].complete(s) ? 'done' : i === index ? 'active' : 'locked'; li.setAttribute('aria-current', i === index ? 'step' : 'false'); });
    set('mission-number', complete ? 'ALL STAGES COMPLETE' : `STAGE ${String(index + 1).padStart(2, '0')} / 07`);
    set('mission-title', s.dead ? 'Signal lost' : !s.hasFlashlight ? 'Pick up the flashlight' : complete ? 'You escaped' : stage.title);
    set('mission-hint', s.dead ? s.deathReason : !s.hasFlashlight ? 'A flashlight is waiting at the entrance. Pick it up before exploring the dark rooms.' : complete ? 'The exit is open. You made it out.' : stage.hint);
    set('scene-location', `LEVEL 0 / ${stage.title.toUpperCase()}`);
    set('scene-coordinates', `X ${Math.floor(s.player.x / 48)} · Y ${Math.floor(s.player.y / 48)}`);
    set('scene-activity', s.paused ? 'PAUSED' : !s.started ? 'AWAITING OPERATOR' : s.gameOver ? (s.won ? 'ESCAPED' : 'RUN ENDED') : controller.busy ? 'AGENT THINKING' : s.modal ? 'PUZZLE INTERACTION' : controller.route.length ? 'MOVING' : 'MANUAL CONTROL');
    set('mission-inventory', s.hasKey ? `ARCHIVE KEY · CODE ${s.doorCode}${s.lockOpen ? ' · DOOR OPEN' : ''}` : 'ARCHIVE KEY NOT COLLECTED');
    set('equipment-status', `FLASHLIGHT ${s.hasFlashlight ? '✓' : '—'} / SCROLL ${s.hasDocument ? '✓' : '—'} / KEY ${s.hasKey ? '✓' : '—'}`);
    set('scene-message', s.message);
    const recap = document.getElementById('puzzle-recap');
    recap.hidden = !s.firstGateOpen;
    if (s.documentAnswered) {
      const answer = s.question.options.find(option => option.id === s.documentAnswerId);
      recap.querySelector('h2').textContent = 'LAST PUZZLE · ANSWERED';
      set('puzzle-recap-text', `${s.question.prompt} — Selected ${answer?.id}: ${answer?.value}. ${s.documentAnswerId === s.question.correctId ? 'Correct.' : 'Incorrect — the monster was released.'}`);
    } else if (s.memorySolved) set('puzzle-recap-text', `Symbol memory verified: ${s.memorySequence.map(symbol => SYMBOLS[symbol]).join('  ')}. Next: choose a corridor.`);
    else if (s.firstGateOpen) set('puzzle-recap-text', `Light sequence verified: ${s.lightSequence.join(' → ')}. The first gate is open.`);
  }};
}
