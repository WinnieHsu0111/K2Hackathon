# Backend API Spec — K2 plays the game

Backend base URL: `http://127.0.0.1:8000`

Goal: **K2 is the player.** The frontend renders the game and the agents' reasoning;
the backend decides what the player does next based on the current game state.

We use **coarse-grained control**: K2 decides high-level intents
(GO_KEY, GO_LOCK, ANSWER, GO_SAFE, GO_EXIT), and the frontend's existing BFS
pathfinding walks the player there. K2 does NOT move tile-by-tile.

---

## Turn loop

```
1. Frontend sends current game state  →  POST /agent/decide
2. Backend runs Explorer → Survival → Navigator → Supervisor (streamed via SSE)
3. Backend returns a final DECISION (an intent + optional answer)
4. Frontend executes the intent (BFS walk / open lock / submit answer)
5. Game state changes; repeat from step 1
```

---

## 1. `GET /question`

K2 generates the anomaly puzzle. Frontend calls this once per level to replace
the hardcoded `QUESTION` in `level.js`.

**Response:**
```json
{
  "id": "042",
  "rule": "All valid record values must be odd.",
  "prompt": "Which value is the anomaly?",
  "options": [
    { "id": "A", "value": "21" },
    { "id": "B", "value": "23" },
    { "id": "C", "value": "84" }
  ],
  "correctId": "C",
  "explanation": "84 is the only even number, breaking the odd-only rule."
}
```

Note: `id` doubles as the 3-digit door code. Frontend uses `correctId`/`explanation`
to judge the answer locally (or call `/answer` — see below).

---

## 2. `POST /agent/decide`  (the main one — SSE stream)

Frontend sends the current game state. Backend streams the agents' reasoning,
then a final decision.

**Request body (what the frontend needs to send):**
```json
{
  "hasKey": false,
  "lockOpen": false,
  "gateOpen": false,
  "documentAnswered": false,
  "monsterActive": false,
  "playerInSafeZone": false,
  "monsterState": "PATROL",
  "playerTile": { "x": 1, "y": 1 },
  "monsterTile": { "x": 11, "y": 15 },
  "question": { "rule": "...", "options": [...] }
}
```

**Response: Server-Sent Events (SSE).** Each line is `data: {json}\n\n`.

Event types the frontend can display:
```json
{ "type": "agent_thinking", "agent": "Explorer", "message": "..." }
{ "type": "agent_result",   "agent": "Explorer", "content": "..." }
{ "type": "agent_result",   "agent": "Survival", "content": "..." }
{ "type": "agent_result",   "agent": "Navigator", "content": "..." }
{ "type": "decision", "intent": "GO_KEY", "answerId": null, "reasoning": "..." }
```

**Possible `intent` values:**
| intent    | meaning                          | frontend action                    |
|-----------|----------------------------------|------------------------------------|
| GO_KEY    | go pick up the key               | BFS walk to K                      |
| GO_LOCK   | go to the code door and open it  | BFS walk to L, submit door code    |
| GO_DOCUMENT | go read the document           | BFS walk to D, open question modal  |
| ANSWER    | answer the puzzle                | submit `answerId` (A/B/C)          |
| GO_SAFE   | flee to nearest safe zone        | BFS walk to nearest S              |
| GO_EXIT   | go to the exit                   | BFS walk to E                      |

---

## 3. `POST /answer`  (optional — for scoring integrity)

If you want the backend to judge the answer instead of the frontend:

**Request:** `{ "answerId": "C" }`
**Response:** `{ "correct": true, "correctId": "C", "explanation": "..." }`

---

## What I need from you (frontend)

1. Expose the game state fields listed in `/agent/decide` request body
   (most already exist on `GameSession`: `hasKey`, `lockOpen`, `monsterActive`,
   `playerInSafeZone`, `monster.state`, and tile positions via `tileAt()`).
2. A way to trigger each `intent` programmatically (BFS walk + open lock + submit
   answer) — you already have `findPath()`, `unlock()`, `answer()`.
3. A panel to display the streamed agent reasoning.

Let me know if the state fields or intents don't match how the game actually works,
and I'll adjust the backend.
