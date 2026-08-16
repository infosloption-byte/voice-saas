# Changed files — tasks #1, #2, #3, #4

Drop each file into your repo at the same relative path (overwriting the existing one). Covers four completed enhancement tasks (see `docs/ENHANCEMENT_TASKS.md` for full detail on each).

## Task #1 — Fix pricing/Terms mismatch (P0)
| File | What changed |
|---|---|
| `frontend/src/LegalPages.tsx` | Terms of Service & Refund Policy pricing corrected to match live 4-tier plans (Free/$9/$29/$79) |
| `frontend/src/WorkspacePage.tsx` | "Quota exhausted" upgrade modal fixed — was showing stale 2-tier pricing, missing Creator tier |
| `backend/app/Http/Controllers/Admin/AdminStatsController.php` | **Bug fix**: Creator-tier subscribers were excluded from MRR/revenue calculations entirely — now included |
| `frontend/src/AdminPage.tsx` | Added "Creator Subs" KPI card to admin dashboard |

## Task #2 — Self-hosted infrastructure marketing (P1)
| File | What changed |
|---|---|
| `frontend/src/LandingPage.tsx` | Added "Run on your own infrastructure" section — self-hosted deployment messaging (no white-label/rebrand claims — Voxora is a single branded platform, not resellable) |
| `frontend/src/PricingPage.tsx` | Added a callout under the pricing disclaimer linking to it |

## Task #3 — Honest-ify RVC/F5-TTS state (P1)
| File | What changed |
|---|---|
| `ai-engine/main.py` | Added an `rvc` block to the `/` status endpoint (enabled/lib_installed/usable/device) |
| `backend/app/Http/Controllers/Admin/SystemCheckController.php` | New `voiceEngineFeatures` probe in the admin System Check panel with actionable hints |
| `frontend/src/AdminPage.tsx` | System Check hints now always render when present (was hidden unless status ≠ pass) |
| `frontend/src/WorkspacePage.tsx` | F5 engine-picker description now reflects the actually-configured language(s) |

## Task #4 — Add Chatterbox as a third TTS engine (P1)
MIT-licensed alternative to XTTS (CPML) / F5-TTS (CC-BY-NC), added **alongside** both — not a replacement.

| File | What changed |
|---|---|
| `ai-engine/main.py` | Chatterbox model loading, `synthesize_chunk_chatterbox()`, `chatterbox_usable()`, status reporting, dispatch branches in all 3 synthesis call sites |
| `ai-engine/requirements.txt` | Added `chatterbox-tts` |
| `backend/app/Services/EngineResolver.php` | New shared `SUPPORTED_TTS_ENGINES` constant + `engineValidationRule()`, replacing 4 hardcoded validation strings |
| `backend/app/Http/Controllers/EngineSynthesisProxyController.php` | Uses the shared validation rule |
| `backend/app/Http/Controllers/ScriptController.php` | Uses the shared validation rule (3 occurrences) |
| `backend/app/Http/Controllers/EngineCapabilitiesController.php` | Passes through `chatterbox`/`chatterbox_languages` fields (would've been silently dropped otherwise) |
| `frontend/src/hooks/useTTSEngine.ts` | `TTSEngine` type extended, localStorage restore fixed |
| `frontend/src/types.ts` | `EngineCaps` extended |
| `frontend/src/App.tsx` | Capability fetch/defaults updated |
| `frontend/src/WorkspacePage.tsx` | Engine picker card, badge, auto-fallback, error messages, warning banner/tooltip, language filter — all extended to cover Chatterbox |
| `frontend/src/SettingsPage.tsx` | Second, separate engine picker (Settings page) extended the same way |
| `frontend/src/AppPages.tsx` | Engine label/color helpers extended |

**Known gap, left for a follow-up:** Chatterbox's own tone knobs (exaggeration/cfg_weight/temperature) aren't wired to the UI yet — every generation uses sensible defaults. Noted in `docs/ENHANCEMENT_TASKS.md`.

Also included: `docs/PLATFORM_ANALYSIS.md` and `docs/ENHANCEMENT_TASKS.md` — full audit + prioritized roadmap, kept current as tasks complete.

## Apply via git

```bash
git add ai-engine/main.py \
        ai-engine/requirements.txt \
        backend/app/Http/Controllers/Admin/AdminStatsController.php \
        backend/app/Http/Controllers/Admin/SystemCheckController.php \
        backend/app/Http/Controllers/EngineCapabilitiesController.php \
        backend/app/Http/Controllers/EngineSynthesisProxyController.php \
        backend/app/Http/Controllers/ScriptController.php \
        backend/app/Services/EngineResolver.php \
        frontend/src/AdminPage.tsx \
        frontend/src/App.tsx \
        frontend/src/AppPages.tsx \
        frontend/src/LandingPage.tsx \
        frontend/src/LegalPages.tsx \
        frontend/src/PricingPage.tsx \
        frontend/src/SettingsPage.tsx \
        frontend/src/WorkspacePage.tsx \
        frontend/src/hooks/useTTSEngine.ts \
        frontend/src/types.ts \
        docs/PLATFORM_ANALYSIS.md \
        docs/ENHANCEMENT_TASKS.md

git commit -m "Fix pricing mismatch, add self-hosted messaging, honest-ify F5/RVC state, add Chatterbox engine"
git push origin main
```

If you're running the AI engine yourself, also run `pip install chatterbox-tts -r ai-engine/requirements.txt` (or just re-run your normal requirements install) to actually enable the new engine — without it, Chatterbox will correctly show as "Unavailable" in the picker rather than error out.
