# Changed files — tasks #1, #2, #3

Drop each file into your repo at the same relative path (overwriting the existing one). Covers three completed enhancement tasks (see `docs/ENHANCEMENT_TASKS.md` for full detail on each):

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
| `ai-engine/main.py` | Added an `rvc` block to the `/` status endpoint (enabled/lib_installed/usable/device) — previously RVC state wasn't reported anywhere |
| `backend/app/Http/Controllers/Admin/SystemCheckController.php` | New `voiceEngineFeatures` probe in the admin System Check panel — reports real F5/RVC state with actionable hints on how to enable each |
| `frontend/src/AdminPage.tsx` | System Check hints now always render when present (was hidden unless status ≠ pass) |
| `frontend/src/WorkspacePage.tsx` | F5 engine-picker description now reflects the actually-configured language(s) instead of hardcoded "English" |

*(`AdminPage.tsx` appears in both task #1 and #3's file lists — one file, two separate edits, both included in the version here.)*

Also included: `docs/PLATFORM_ANALYSIS.md` and `docs/ENHANCEMENT_TASKS.md` — full audit + prioritized roadmap, kept current as tasks complete.

## Apply via git

```bash
git add frontend/src/LegalPages.tsx \
        frontend/src/WorkspacePage.tsx \
        frontend/src/PricingPage.tsx \
        frontend/src/LandingPage.tsx \
        frontend/src/AdminPage.tsx \
        backend/app/Http/Controllers/Admin/AdminStatsController.php \
        backend/app/Http/Controllers/Admin/SystemCheckController.php \
        ai-engine/main.py \
        docs/PLATFORM_ANALYSIS.md \
        docs/ENHANCEMENT_TASKS.md

git commit -m "Fix pricing mismatch, add self-hosted messaging, honest-ify F5/RVC state"
git push origin main
```
