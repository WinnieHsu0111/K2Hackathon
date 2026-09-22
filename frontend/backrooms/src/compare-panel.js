// "Why K2" demo panel: runs one fixed trade-off dilemma through /agent/compare
// and shows the small baseline model and K2 Horizon side by side. Self-contained;
// it does not touch the live game — it exists purely to make the comparison
// visible to judges/viewers.

const INTENT_LABEL = {
  SOLVE_LIGHTS: 'Solve lights', WATCH_LIGHTS: 'Watch lights', ENTER_LIGHTS: 'Enter lights',
  GO_MEMORY: 'Go to memory', ANSWER_MEMORY: 'Answer memory', TRY_PATH: 'Try a path',
  GO_KEY: 'Get the key', GO_LOCK: 'Open the door', GO_DOCUMENT: 'Go to document',
  ANSWER: 'Answer puzzle', GO_SAFE: 'Flee to safe zone', GO_EXIT: 'Go to exit',
  '(invalid)': 'Invalid / confused', '(error)': 'Model error',
};

// The dilemma: monster chasing and adjacent, key still needed, not in a safe
// zone — and the history shows fleeing already worked once. A strong reasoner
// flees (GO_SAFE); a weak one grabs the key or produces an invalid action.
const DILEMMA = {
  firstGateOpen: true, memorySolved: true, pathSolved: true,
  hasKey: false, lockOpen: false, gateOpen: false, documentAnswered: false,
  monsterActive: true, monsterState: 'CHASE', playerInSafeZone: false,
  playerTile: { x: 10, y: 5 }, monsterTile: { x: 11, y: 5 },
  trajectory: [
    'Turn 1: chose GO_KEY while monster was patrolling — safe',
    'Turn 2: monster switched to CHASE, got cornered near the key, respawned',
    'Turn 3: chose GO_SAFE — reached safe zone, monster lost track',
    'Turn 4: left safe zone to resume for the key',
    'Turn 5: monster is chasing again and is one tile away',
  ],
};

export function createComparePanel(baseUrl) {
  const el = (id) => document.getElementById(id);
  const btn = el('compare-run');
  if (!btn) return;

  const fill = (who, r) => {
    el(`compare-${who}-label`).textContent = r.label ? `· ${r.label}` : '';
    el(`compare-${who}-intent`).textContent = INTENT_LABEL[r.intent] || r.intent;
    el(`compare-${who}-intent`).dataset.valid = String(r.valid);
    el(`compare-${who}-reason`).textContent = r.reasoning || '';
    el(`compare-${who}-meta`).textContent = `${r.valid ? 'valid decision' : 'invalid / off-task'} · ${r.elapsedSeconds}s`;
  };

  const reset = () => {
    for (const who of ['baseline', 'k2']) {
      el(`compare-${who}-intent`).textContent = '…';
      el(`compare-${who}-intent`).removeAttribute('data-valid');
      el(`compare-${who}-reason`).textContent = '';
      el(`compare-${who}-meta`).textContent = '';
    }
  };

  btn.onclick = async () => {
    btn.disabled = true;
    reset();
    el('compare-status').textContent = 'Both models reasoning over the same dilemma…';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90000);
    try {
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/agent/compare`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify(DILEMMA), signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error(`Backend HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let done = false;
      while (!done) {
        const { value, done: d } = await reader.read();
        done = d;
        buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, '\n');
        let end;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
          const data = frame.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n');
          if (!data) continue;
          const p = JSON.parse(data);
          if (p.type === 'compare_thinking') {
            const who = p.model === 'K2 Horizon' ? 'k2' : 'baseline';
            el(`compare-${who}-intent`).textContent = 'thinking…';
          } else if (p.type === 'compare_result') {
            fill(p.model === 'K2 Horizon' ? 'k2' : 'baseline', p);
          } else if (p.type === 'compare_done') {
            el('compare-status').textContent = p.agree
              ? 'Both chose the same action this time.'
              : 'Different decisions — the small model went off-task; K2 handled the trade-off.';
          }
        }
      }
    } catch (e) {
      el('compare-status').textContent = e.name === 'AbortError'
        ? 'Comparison timed out.' : `${e.message}. Is the backend running?`;
    } finally {
      clearTimeout(timer);
      btn.disabled = false;
    }
  };
}
