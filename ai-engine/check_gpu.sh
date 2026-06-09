#!/usr/bin/env bash
# Run this inside the GPU pod to confirm everything is healthy before
# switching traffic to it from the admin panel.
#
# Usage:
#   bash check_gpu.sh [ENGINE_URL] [API_KEY]
#   bash check_gpu.sh http://localhost:8000 my-secret-key
#
# Defaults to localhost:8000 with no auth key.

ENGINE_URL="${1:-http://localhost:8000}"
API_KEY="${2:-}"

PASS=0; FAIL=0
ok()   { echo "  [OK]  $1"; ((PASS++)); }
fail() { echo "  [FAIL] $1"; ((FAIL++)); }
hdr()  { echo; echo "=== $1 ==="; }

hdr "CUDA"
if python3 -c "import torch; assert torch.cuda.is_available(), 'no cuda'" 2>/dev/null; then
    GPU=$(python3 -c "import torch; print(torch.cuda.get_device_name(0))")
    ok "CUDA available — $GPU"
else
    fail "CUDA not available (is the nvidia runtime enabled?)"
fi

hdr "Engine health"
STATUS=$(curl -sf -o /dev/null -w "%{http_code}" "$ENGINE_URL/")
if [ "$STATUS" = "200" ]; then
    ok "GET / → 200"
else
    fail "GET / → $STATUS (engine may still be loading, wait 3 min and retry)"
fi

hdr "Built-in voices"
VOICES=$(curl -sf ${API_KEY:+-H "X-Engine-Key: $API_KEY"} "$ENGINE_URL/built-in-voices" | python3 -c "import sys,json; v=json.load(sys.stdin); print(len(v))" 2>/dev/null)
if [ -n "$VOICES" ] && [ "$VOICES" -gt 0 ] 2>/dev/null; then
    ok "$VOICES built-in voices available"
else
    fail "Could not fetch built-in voices"
fi

hdr "Quick synthesis test (XTTS)"
TMPOUT=$(mktemp /tmp/synth_test_XXXX.wav)
HTTP=$(curl -sf -o "$TMPOUT" -w "%{http_code}" \
    ${API_KEY:+-H "X-Engine-Key: $API_KEY"} \
    -F "text=Hello from Voxora GPU engine." \
    -F "profile_id=builtin:Claribel Dervla" \
    -F "language=en" \
    "$ENGINE_URL/synthesize" 2>/dev/null)
if [ "$HTTP" = "200" ] && [ -s "$TMPOUT" ]; then
    SIZE=$(wc -c < "$TMPOUT")
    ok "Synthesis returned ${SIZE} bytes"
else
    fail "Synthesis returned HTTP $HTTP"
fi
rm -f "$TMPOUT"

hdr "Summary"
echo "  Passed: $PASS  Failed: $FAIL"
if [ "$FAIL" -eq 0 ]; then
    echo
    echo "  Engine is ready. Add this URL in Admin → AI Engines and activate it:"
    echo "  $ENGINE_URL"
else
    echo
    echo "  Fix the failures above before switching traffic."
    exit 1
fi
