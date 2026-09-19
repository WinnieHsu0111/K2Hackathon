# Backrooms Escape — 60 Seconds

A standalone Phaser / Vite game in `frontend/backrooms`.

## Run

```sh
cd frontend/backrooms
npm ci
npm run dev -- --port 5173 --strictPort
```

Open http://127.0.0.1:5173. Node.js 22.12+ is required.

```sh
npm test
npm run build
```

## Play

- Click **START** to begin a 60-second run. WASD / arrows move, Shift runs, F interacts, R restarts.
- Approach **C** and press F. Watch five random flashes, then enter them using the console buttons. Repeated colors are allowed. Incorrect input replays the sequence.
- Crossing gate **A** reveals five symbols for three seconds. At **R**, press F and choose the correct order. An incorrect choice reveals the symbols again. All three passage gates stay closed until solved.
- Choose **LEFT / CENTER / RIGHT**. One corridor is randomly valid. The other two look normal but cause static and return you to the entrance. Time is not restored.
- Find **K**. Its tag reveals the run's four-digit code. Enter that code at **L**.
- Cross the row of **T** traps using the only one-tile gap. Contact sends you outside L without resetting progress or time.
- At **D**, answer a generated calculus question: chain rule, substitution integration, limits, or polynomial derivatives. The three answer positions are shuffled.
- Both answers open **G**. A wrong answer wakes the monster. Use the three **S** shelters to break sight and let it patrol away.
- Reach **E** before the countdown ends to see **YOU ESCAPED**.
- Timeout or capture shows **YOU DIED** for two seconds, then automatically starts a fresh randomized session. Manual restart also generates fresh values.

The clock continues during dialogs and retries, but pauses during an active K2 model request. It uses elapsed wall-clock time, independent of the movement delta clamp; background time is deducted when rendering resumes. Winning freezes the clock. START prevents the initial run from expiring while you read the instructions.

## Music

Enable **Jaws music** to authorize browser playback. A two-second preview confirms the audio. When the monster appears, `src/assets/jaws.m4a` restarts and loops. Volume falls with distance over 15 tiles; sheltering lets it fade naturally as the monster leaves. Death, victory, and a hidden/unfocused tab silence playback. Keep the existing local audio asset and its usage permissions with the project.

## K2

Run the FastAPI service in `backend/` at port 8000. Keep API credentials in `backend/.env`; never put them in a VITE variable.

K2 starts automatically when the page loads or the run restarts. **Let K2 Play** resumes after a pause. It controls every room: lights, memory, path trials, key, lock, calculus document, and exit. Each decision runs Explorer, Survival, Navigator, then Supervisor, with live reports in the panel. The controller records lights during playback and symbols during reveal; K2 receives these observations and chooses the inputs. Path failures are remembered and retried without reading the hidden correct corridor. The 60-second clock pauses during model requests, but movement and puzzle playback still count. **K2 Step** runs a single goal; use continuous play for the full demonstration.

`POST /agent/decide` returns SSE `decision` events. The frontend validates intent and answer IDs, executes movement through the normal collision functions, and cancels requests on manual takeover, death, or restart. K2 receives the visible question (including its expression) without the answer key. Its navigation is game-engine BFS, not model discovery of an unknown map.

## Files

- `src/puzzles.js`: random generation and four calculus question families.
- `src/level.js`: rectangular 25 × 28 map, session state, deadline, puzzles, movement, traps and monster.
- `src/main.js`: English UI, rendering, memory preview, input and automatic restart.
- `src/audio.js`: local music and distance volume.
- `src/agent.js`, `src/agent-panel.js`, `src/observation.js`: K2 connection, controls and restricted observations.
- `tests/`: timed full routes, all path choices, death, safe-zone escape, randomized answer checks, SSE and cancellation.

Puzzle generation accepts an injected RNG for reproducible tests. Answers remain in frontend memory for this prototype; this is not an anti-cheat design. No account, database, or new dependency is required. Vite may warn about the existing large Phaser bundle.
