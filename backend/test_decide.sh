#!/bin/bash
# Test the K2 game-mode multi-agent decision loop at various game states.
# Usage: bash test_decide.sh
# Shows which agents the Supervisor consults and the final decision for each scenario.

URL="http://127.0.0.1:8000/agent/decide"
Q='"question":{"rule":"valid values must be odd","options":[{"id":"A","value":"21"},{"id":"B","value":"23"},{"id":"C","value":"84"}]}'

run() {
  echo "=============================================="
  echo "SCENARIO: $1"
  echo "=============================================="
  curl -s -N -X POST "$URL" -H "Content-Type: application/json" -d "$2" \
    | grep -E '"agent"|"type": "decision"' \
    | sed 's/data: //'
  echo ""
}

run "No key, monster far → expect GO_KEY" \
  "{\"hasKey\":false,\"monsterActive\":false,\"playerTile\":{\"x\":1,\"y\":1},\"monsterTile\":{\"x\":12,\"y\":15},$Q}"

run "Has key, door closed → expect GO_LOCK" \
  "{\"hasKey\":true,\"lockOpen\":false,\"monsterActive\":false,\"playerTile\":{\"x\":6,\"y\":3},\"monsterTile\":{\"x\":12,\"y\":15},$Q}"

run "Door open, not at document → expect GO_DOCUMENT" \
  "{\"hasKey\":true,\"lockOpen\":true,\"atDocument\":false,\"monsterActive\":false,\"playerTile\":{\"x\":11,\"y\":9},\"monsterTile\":{\"x\":12,\"y\":15},$Q}"

run "At document → expect ANSWER (C)" \
  "{\"hasKey\":true,\"lockOpen\":true,\"atDocument\":true,\"monsterActive\":false,\"playerTile\":{\"x\":11,\"y\":12},\"monsterTile\":{\"x\":12,\"y\":15},$Q}"

run "Monster chasing, not safe → expect GO_SAFE" \
  "{\"hasKey\":true,\"lockOpen\":true,\"gateOpen\":true,\"documentAnswered\":true,\"monsterActive\":true,\"monsterState\":\"CHASE\",\"playerInSafeZone\":false,\"playerTile\":{\"x\":15,\"y\":16},\"monsterTile\":{\"x\":16,\"y\":16},$Q}"

run "Gate open, answered, safe → expect GO_EXIT" \
  "{\"hasKey\":true,\"lockOpen\":true,\"gateOpen\":true,\"documentAnswered\":true,\"monsterActive\":false,\"playerTile\":{\"x\":10,\"y\":16},\"monsterTile\":{\"x\":3,\"y\":15},$Q}"
