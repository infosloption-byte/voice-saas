# Changed files only — pricing fix + self-hosted messaging

Drop each file into your repo at the same relative path (overwriting the existing one). These 8 files reflect the **final state** across two commits on the working copy:

- `ba9e331` — original pricing fix + self-hosted marketing section
- `9f017e2` — correction removing "white-label" framing (Voxora is not intended to be rebranded/resold — self-hosting is about your own infrastructure/domain only)

| File | What changed |
|---|---|
| `frontend/src/LegalPages.tsx` | Terms of Service & Refund Policy pricing corrected to match live 4-tier plans (Free/$9/$29/$79) |
| `frontend/src/WorkspacePage.tsx` | "Quota exhausted" upgrade modal fixed — was showing stale 2-tier pricing, missing Creator tier |
| `frontend/src/PricingPage.tsx` | Added self-hosted callout under the pricing disclaimer (white-label wording removed) |
| `frontend/src/LandingPage.tsx` | Added "Run on your own infrastructure" section — self-hosted deployment only, no white-label/rebrand framing |
| `frontend/src/AdminPage.tsx` | Added "Creator Subs" KPI card to admin dashboard |
| `backend/app/Http/Controllers/Admin/AdminStatsController.php` | **Bug fix**: Creator-tier subscribers were excluded from MRR/revenue calculations entirely — now included |
| `docs/PLATFORM_ANALYSIS.md` | Full technical audit + competitive analysis (new file) |
| `docs/ENHANCEMENT_TASKS.md` | Prioritized task list with completed items checked off, annotated, and the white-label correction documented (new file) |

## Apply via git

Copy the files into your repo at their listed paths, then:

```bash
git add frontend/src/LegalPages.tsx \
        frontend/src/WorkspacePage.tsx \
        frontend/src/PricingPage.tsx \
        frontend/src/LandingPage.tsx \
        frontend/src/AdminPage.tsx \
        backend/app/Http/Controllers/Admin/AdminStatsController.php \
        docs/PLATFORM_ANALYSIS.md \
        docs/ENHANCEMENT_TASKS.md

git commit -m "Fix stale pricing + add self-hosted infrastructure marketing"
git push origin main
```
