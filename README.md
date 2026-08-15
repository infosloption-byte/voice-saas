# Changed files only — pricing fix + self-hosted messaging

Drop each file into your repo at the same relative path (overwriting the existing one). All 8 files below came from commit `ba9e331` on the working copy.

| File | What changed |
|---|---|
| `frontend/src/LegalPages.tsx` | Terms of Service & Refund Policy pricing corrected to match live 4-tier plans (Free/$9/$29/$79) |
| `frontend/src/WorkspacePage.tsx` | "Quota exhausted" upgrade modal fixed — was showing stale 2-tier pricing, missing Creator tier |
| `frontend/src/PricingPage.tsx` | Added self-hosted/white-label callout line under the pricing disclaimer |
| `frontend/src/LandingPage.tsx` | Added new "Run it on your own infrastructure" section (self-hosted/white-label messaging) |
| `frontend/src/AdminPage.tsx` | Added "Creator Subs" KPI card to admin dashboard |
| `backend/app/Http/Controllers/Admin/AdminStatsController.php` | **Bug fix**: Creator-tier subscribers were excluded from MRR/revenue calculations entirely — now included |
| `docs/PLATFORM_ANALYSIS.md` | Full technical audit + competitive analysis (new file) |
| `docs/ENHANCEMENT_TASKS.md` | Prioritized task list with completed items checked off and annotated (new file) |

## Apply via git (recommended)

If you'd rather pull this in as a proper commit instead of copying files by hand, use the bundle from the previous zip I sent (`voice-saas.bundle`) and run:

```bash
git remote add fix-bundle /path/to/voice-saas.bundle
git fetch fix-bundle
git cherry-pick ba9e331
git push origin main
```
