# Voxora Enhancement Task List

*Companion to `voxora-analysis.md`. Organized by priority tier first (what's required vs. optional), then within each tier ordered easiest → hardest so work can start immediately and build momentum.*

## Progress

| # | Task | Tier | Status |
|---|---|---|---|
| 1 | Fix pricing/Terms mismatch | P0 | ✅ Done — Aug 15, 2026 |
| 2 | Self-hosted infrastructure marketing | P1 | ✅ Done — Aug 15, 2026 |
| 3 | Honest-ify RVC/F5-TTS UI state | P1 | ✅ Done — Aug 15, 2026 |
| 4 | Add Chatterbox as a third TTS engine option | P1 | ✅ Done — Aug 15, 2026 |
| 5 | Public API tier | P1 | Not started |
| 6 | Video dubbing MVP | P1 | Not started |
| 7 | Base model quality tier | P1 | Not started |
| 8 | Public system-health status page | P2 | Not started |
| 9 | No-signup "try your voice" widget | P2 | Not started |
| 10 | SFX lane in Assembly | P2 | Not started |
| 11 | Team/seat collaboration | P2 | Not started |
| 12 | Design-tool integrations | P3 | Not started |
| 13 | Voice marketplace | P3 | Not started |
| 14 | Native mobile app | P3 | Not started |

---

**How to read this:**
- **P0 — Must Fix Now**: broken, wrong, or actively losing you money/trust/customers. Not optional.
- **P1 — Must Have**: closes a real competitive gap or unlocks a revenue segment. Should be on the roadmap.
- **P2 — Should Have**: meaningfully strengthens the product but isn't blocking growth.
- **P3 — Nice to Have**: polish, differentiation, or long-horizon bets.

Each task includes: what it is, why it matters, rough effort, and what "done" looks like.

---

## P0 — Must Fix Now

### 1. Fix the pricing / Terms mismatch ✅ DONE
- **What:** Terms of Service and Refund Policy pages still said Starter $9.99 / Pro $24.99 (2-tier, old model). Live pricing page says Free / Starter $9 / Creator $29 / Pro $79 (4-tier).
- **Why:** A legal document that doesn't match what you actually bill customers is a real compliance and dispute-liability problem — not cosmetic copy drift.
- **Effort:** Trivial (1–2 hours). Update `LegalPages.tsx` text to match `PricingPage.tsx`.
- **Done when:** Every price mentioned in Terms/Refund/Privacy exactly matches `PricingPage.tsx`, and there's a single source of truth (ideally pull plan names/prices from the same `PLANS` constant instead of hardcoding text twice).

**What was actually done:** The stale pricing turned out to be in more places than the two legal pages — a full repo-wide sweep found it in 4 locations total, including one that was actively corrupting business metrics:
- `frontend/src/LegalPages.tsx` — Terms of Service and Refund Policy sections updated from the old 2-tier ($9.99/$24.99) to the correct 4-tier model (Free/$9 Starter/$29 Creator/$79 Pro) with matching feature descriptions.
- `frontend/src/WorkspacePage.tsx` — the "quota exhausted" upgrade modal (`UPGRADE_PLANS`) was also showing stale $9.99/$24.99 pricing with the wrong quotas and was **missing the Creator tier entirely**. Rebuilt to mirror the live `PricingPage.tsx` exactly (all 3 paid tiers, correct quotas/features). Verified the modal's CSS grid (`auto-fit, minmax(210px, 1fr)`) handles a 3rd card automatically — no layout fix needed.
- `backend/app/Http/Controllers/Admin/AdminStatsController.php` — **this was the most serious find**: `PLAN_PRICES` only had `starter` and `pro` keys at the old prices, and the MRR/paid-user calculation only queried `subscriptions` where `plan = 'starter'` or `'pro'`. Every Creator-tier subscriber was being **silently excluded from revenue reporting** — MRR, paid-user count, and conversion rate have all been under-reported since the Creator tier was introduced. Fixed the price constant (`$9/$29/$79`), added `creatorSubs` to the query, included it in the MRR sum and paid-user count, and added `creator` to the `subscriptions` breakdown in the API response.
- `frontend/src/AdminPage.tsx` — the admin dashboard only rendered "Starter Subs" and "Pro Subs" KPI cards; added a "Creator Subs" card so the fixed backend data is actually visible.
- Left `backend/database/migrations/2026_06_07_000001_add_translation_limits.php` untouched — it's a historical migration with an old price in a comment only; editing already-run migrations is bad practice and it has no effect on current pricing.
- Verified with a full-repo grep that no `9.99`/`24.99` references remain outside `node_modules`.
- Verified via `tsc -b` (clean) and `vite build` (clean, only 2 pre-existing unrelated warnings) that nothing broke.

---

## P1 — Must Have

*Ordered easy → hard.*

### 2. Add the self-hosted infrastructure story to marketing ✅ DONE
- **What:** State clearly on the landing page and pricing page that Voxora can be deployed under the buyer's own domain/infrastructure — full data residency, no per-seat SaaS lock-in.
- **Why:** This is a genuine structural advantage over every competitor reviewed (ElevenLabs, Murf, Speechify, Descript) and it currently appears nowhere in the marketing copy. Free, high-leverage.
- **Effort:** Small (copywriting + maybe one new landing section). No backend work.
- **Done when:** Landing page has a dedicated section on self-hosted deployment; pricing page references it.

**What was actually done:**
- `frontend/src/LandingPage.tsx` — added a new dedicated section (`id="self-hosted"`) between "How it works" and "Pricing", titled "Run on your own infrastructure," with three feature cards matching the existing design system (same `vox-card` grid used elsewhere on the page): **Full Data Residency**, **Your Own Domain**, **No Per-Seat Lock-In**. Reused existing icons (`shield`, `template`, `api`) already available in `constants.tsx` — no new assets needed.
- `frontend/src/PricingPage.tsx` — added a one-line callout below the existing trial/payment disclaimer: *"Need full data residency or your own domain? Voxora is self-hostable — learn more,"* linking back to the landing page, so the message reaches people at the moment they're evaluating cost.
- Did not add a dedicated FAQ component since the repo has no existing FAQ pattern to extend — the new landing section covers the "done when" requirement directly instead.
- Verified via `tsc -b` and `vite build` — both clean.

**Correction (Aug 15, 2026):** The first version of this copy said "white-label ready" and included a "Your Brand, Your Domain" card implying Voxora could be rebranded/resold under a different name or logo. That was a misread of intent — Voxora is not meant to be white-labeled; it's a single branded platform, and the self-hosting story is only about running the platform on your own infrastructure/domain, not about rebranding it. All "white-label" wording was removed from `LandingPage.tsx`, `PricingPage.tsx`, and this doc, and the card was renamed to "Your Own Domain" with copy that no longer implies rebrand capability.

### 3. Honest-ify RVC and F5-TTS instead of half-advertising them ✅ DONE
- **What:** Either (a) hide RVC and F5-TTS from the picker until an operator has actually configured them (trained model / GPU + checkpoint), or (b) add plain-language in-app messaging explaining the prerequisite instead of a silent failure or confusing "unavailable" state.
- **Why:** Right now these are capabilities that exist in code but aren't usable by a typical operator without manual, undocumented ops work. Shipping a feature that looks broken is worse than not shipping it.
- **Effort:** Small–Medium. Mostly conditional UI logic + admin-panel messaging; the `f5_usable()` / `f5_languages` and RVC-loaded checks already exist server-side — this is about surfacing that state honestly in the UI.
- **Done when:** A user/admin can tell at a glance whether F5/RVC are actually usable on their deployment, with a clear next step if not.

**What was actually done:** On investigation, F5-TTS's *user-facing* UI was already in good shape (a "Ready"/"Needs GPU" pill in the engine picker, auto-fallback to XTTS, toast + tooltip explaining the GPU requirement) — the original report overstated that gap. RVC, by contrast, had **zero frontend presence at all** — it's applied silently as a post-processing pass with no toggle, no indicator, and no way for anyone to know whether it ran. Since RVC is fundamentally an ops-level feature (env-var gated, requires a pre-trained model placed on disk per voice profile with no self-serve training flow), the fix targets the audience that actually controls it — admins — rather than building a misleading user-facing toggle for a feature end users can't configure anyway:
- `ai-engine/main.py` — added an `"rvc"` block to the `/` status endpoint (`enabled`, `lib_installed`, `usable`, `device`), mirroring the existing `f5`/`f5_languages` reporting pattern. Previously RVC state wasn't exposed anywhere, even internally.
- `backend/app/Http/Controllers/Admin/SystemCheckController.php` — added a new `voiceEngineFeatures` probe (registered alongside the existing 15 checks) that reads the engine's F5/RVC/GPU state and reports it in the admin System Check panel. Stays `pass` when F5/RVC are simply off (that's a valid default, not a problem) with an informational hint on exactly how to enable each one; only flips to `warn` on a genuine misconfiguration (`RVC_ENABLED=1` but the library never installed, meaning RVC silently no-ops on every synthesis without anyone knowing).
- `frontend/src/AdminPage.tsx` — the System Check list previously only rendered a check's `hint` when its status wasn't `pass`; changed it to always render when present, since the new check's "here's how to enable this" hint is informational and needs to show even on a clean pass. Confirmed no existing check relied on hiding a hint on pass (all pass elsewhere with `hint: null`), so this is non-breaking.
- `frontend/src/WorkspacePage.tsx` — fixed a smaller honesty gap in the F5 engine-picker description, which hardcoded "English" regardless of the actual configured checkpoint; now reads `engineCaps.f5_languages` and displays whatever language(s) the operator's F5 checkpoint actually speaks.
- Verified via `tsc -b`, `vite build` (both clean), and `python3 -m py_compile` on the engine file (no PHP linter available in this sandbox — reviewed the PHP edit manually and confirmed brace/paren balance across the file).
- Did not build a self-serve RVC training flow or a per-voice-profile "enhanced" badge — that's a materially larger feature (training pipeline, storage, UI) and is better scoped as its own task if there's demand; this task closes the "invisible/silent" gap, not the "no self-serve training" gap.

### 4. Add Chatterbox as a third TTS engine option (alongside XTTS/F5, not replacing them) ✅ DONE
- **What:** Add Chatterbox (Resemble AI, MIT-licensed) as a selectable third engine in the existing XTTS/F5 picker — user chooses which engine to synthesize with, same as today's XTTS vs. F5 choice.
- **Why:** Two things converge here. First, licensing: XTTS v2 is CPML (non-commercial without contacting Coqui) and F5-TTS weights are CC-BY-NC — **neither is properly licensed for a paid commercial product**, which is a real legal exposure independent of any feature work. Second, quality/differentiation: Chatterbox is MIT-licensed (genuinely free for commercial use), clones from ~5-10s of reference audio across 23-25 languages, and Resemble's own blind evaluation claims it's competitive with ElevenLabs — a credible option to sit alongside XTTS/F5, not a toy. Adding it as a third option (rather than replacing anything) means zero disruption to existing users/profiles while giving new/existing users a legally-clean, potentially higher-quality choice.
- **Effort:** Medium. The codebase already has the right shape for this — F5 was added the same way alongside XTTS, so this follows an established pattern rather than inventing one.
- **Done when:** A user can select Chatterbox from the same engine picker used for XTTS/F5, synthesize successfully when it's installed/available, and see an honest "Unavailable" state (matching the pattern from task #3) when it isn't — with existing XTTS/F5 profiles and workflows completely unaffected.

**What was actually done:**
- `ai-engine/main.py`:
  - Added `CHATTERBOX_ENABLED`/`CHATTERBOX_LANGUAGES` config, a `chatterbox_usable()` helper (unlike `f5_usable()`, not gated behind a CPU-allow flag — Chatterbox's own docs support `device="cpu"` without F5's OOM-kill risk), and `models["chatterbox"]`.
  - Wrote `synthesize_chunk_chatterbox()` mirroring `synthesize_chunk_f5()`'s exact normalization/write shape. Caught and corrected an inaccurate first-draft comment that claimed speed gets post-processed via ffmpeg downstream — it doesn't; documented honestly that `speed` is currently a no-op on this engine rather than pretending otherwise.
  - Restructured the startup loading block: the old F5 loader had an early `return` that skipped loading everything else on CPU-only servers. Fixed so F5 still gets skipped there, but Chatterbox loading now runs regardless (it supports CPU).
  - Updated the `/` status endpoint to report `chatterbox`/`chatterbox_languages`, same shape as F5's fields.
  - Added `chatterbox` to both `engine not in (...)` whitelist checks and their corresponding 503-gate blocks.
  - Wired all 3 chunk-dispatch call sites (`synthesize_segment()` helper, single-voice path in the main synthesis endpoint, and the clone-voice preview endpoint) with a proper `elif engine == "chatterbox"` branch, including resolving a reference WAV for built-in speakers the same way F5 does (Chatterbox needs a real audio_prompt_path, unlike XTTS's `speaker=` kwarg).
  - Added `chatterbox-tts` to `requirements.txt`, matching how `f5-tts` is already listed.
- `backend/app/Services/EngineResolver.php` — added a single `SUPPORTED_TTS_ENGINES` constant and `engineValidationRule()` helper, replacing the 4 hardcoded `'in:xtts,f5'` strings flagged in the original write-up (`EngineSynthesisProxyController.php` once, `ScriptController.php` three times, now importing and using `EngineResolver::engineValidationRule()`). The next engine addition only needs to touch this one constant.
- `backend/app/Http/Controllers/EngineCapabilitiesController.php` — this controller **whitelists which fields pass through** from the AI engine's status response to the frontend; without updating it, `chatterbox`/`chatterbox_languages` would have been silently dropped even though the engine was correctly reporting them. Added both fields to the success and offline-default response shapes.
- Frontend — extended every place that branched on `engine === 'f5'` to add a matching Chatterbox branch: `hooks/useTTSEngine.ts` (type + localStorage restore), `types.ts` (`EngineCaps`), `App.tsx` (capability fetch/defaults), and in `WorkspacePage.tsx`: the engine picker card list, the small engine badge, the auto-fallback effect, both synthesis error-message call sites, the engine-unavailable warning banner, the warning-dot tooltip, and the script-editor accent-language filter. Also fixed the same pattern in `SettingsPage.tsx` (its separate engine picker, not-installed warning block, and default-language filter) and `AppPages.tsx` (engine label/color helpers). Found via a full-repo grep for `engine === 'f5'` rather than trusting a single search — several of these were in places the original scope estimate didn't anticipate (there are genuinely two separate engine pickers in this codebase, one in Workspace and one in Settings).
- Verified via `tsc -b` and `vite build` (both clean, only the 2 pre-existing unrelated warnings), `python3 -m py_compile` on the engine file, and manual brace/paren balance checks on all 4 touched PHP files (no PHP linter available in this sandbox).
- **Known gap, left for a follow-up:** Chatterbox's own tone knobs (`exaggeration`, `cfg_weight`, `temperature`) aren't wired to the UI yet — every generation currently uses the function's defaults (0.5, 0.5, 0.8). F5 has equivalent sliders (`cfg_strength`, `target_rms`, `sway_sampling_coef`) already exposed in the tone panel; giving Chatterbox the same treatment is a small, separate follow-up rather than something this task's "done when" required.

**Correction (Aug 15, 2026, after a production deploy attempt):** Two real bugs surfaced when the operator actually ran `docker compose up --build`:
1. `ai-engine/Dockerfile` — the primary `torch`/`torchaudio` install used `--index-url` instead of `--extra-index-url`, which **entirely replaces** the default PyPI index rather than supplementing it. Pip had nowhere to resolve transitive build dependencies (`typing_extensions`, `flit_core`) and the build failed with `No matching distribution found for flit_core`. This predates the Chatterbox work but was only exposed once it got exercised again — the correct pattern (`--extra-index-url`) was already used lower down for the F5-TTS install; the primary torch install had just never been aligned with it. Fixed.
2. **The `requirements.txt` edit from earlier in this task was dead weight** — `ai-engine/Dockerfile` doesn't reference `requirements.txt` at all; it installs everything via explicit, staged `pip install` commands specifically to protect the CPU-only torch pin from being silently upgraded to a CUDA build. Adding `chatterbox-tts` to `requirements.txt` alone never actually got it installed in a real deployment. Added a proper install step to the Dockerfile itself, mirroring F5-TTS's exact pattern (same `-c /tmp/cpu_constraints.txt` protection, same non-fatal `|| echo WARNING` fallback so a failed Chatterbox install can't take XTTS/F5 down with it). Also annotated `requirements.txt` with a header clarifying it's a rough manual-setup reference only, not the source of truth for the Docker build, and fixed the same `--index-url`/`--extra-index-url` mistake in its own torch line so it doesn't become the next landmine.

**Correction #2 (Aug 15, 2026, architectural fix — Chatterbox moved to its own service):** The Dockerfile fix above got the build passing, but the Chatterbox install itself then failed for a real, unfixable-in-place reason: `pip install chatterbox-tts` inside `ai-engine` hits a genuine `ResolutionImpossible` error — Chatterbox hard-pins `torch==2.6.0` + `transformers==4.46.3`, which doesn't overlap with XTTS's own `torch==2.2.2+cpu` / `transformers==4.36.2` pins at all. No install flag or constraint fixes this; it's two libraries that categorically cannot share one Python environment. Confirmed via the operator's actual build log, not a theoretical concern.

Fixed by moving Chatterbox into its own container (**Option B** of two discussed: isolated venv-in-container vs. separate service — separate service was chosen since it matches this codebase's existing backend→ai-engine HTTP-proxy pattern rather than inventing a new one):
- New `chatterbox-engine/` — a standalone FastAPI service with its own `Dockerfile` (installs Chatterbox's actual required `torch`/`transformers` versions, fully isolated from `ai-engine`'s pins) and `main.py` (loads Chatterbox once at startup, exposes `/` status and `/synthesize`).
- `ai-engine/main.py` — `synthesize_chunk_chatterbox()` rewritten to proxy over HTTP (`httpx`) to `CHATTERBOX_ENGINE_URL` instead of importing chatterbox directly. `chatterbox_usable()`/`chatterbox_languages()` now poll the sub-service's status with a 15-second TTL cache (avoids hammering it — `/` is polled fairly often by the frontend). Removed `models["chatterbox"]` and the old in-process loading block entirely; startup now just logs whether the sub-service is reachable, informationally.
- **Reference audio is uploaded as real file bytes (multipart), not a shared-volume path** — caught this during implementation: the `/clone-voice` preview endpoint uses an ephemeral `tmp_path()` file under `ai-engine`'s own local `/tmp`, which a separate container has no way to see. Rather than auditing every call site for which ones happen to use the shared `voice_profiles`/`builtin_refs` volumes vs. ephemeral local temp files, uploading the bytes directly sidesteps the whole class of bug — no shared volumes needed between the two services at all.
- `docker-compose.yml` (the file actually in use) — added the `chatterbox-engine` service, a `chatterbox_models` volume for its model cache, and wired `CHATTERBOX_ENGINE_URL=http://chatterbox-engine:8100` into `ai-engine`'s environment.
- `docker-compose.prod.yml` — mirrored the same wiring (self-contained alternate full-stack file).
- `docker-compose.gcp.yml` / `docker-compose.runpod.yml` — these intentionally run only `ai-engine` on a remote GPU box while everything else stays on the main server, so `chatterbox-engine` is **not** duplicated there. Added a comment explaining that and wired `CHATTERBOX_ENGINE_URL` to default to the in-cluster name but be overridable to point back at the main server's reachable address, since the bare-hostname default only resolves inside the main server's own Docker network.
- `ai-engine/requirements.txt` — removed `chatterbox-tts` entirely (it can never install here) with a comment pointing to `chatterbox-engine/requirements.txt` instead; added `httpx`.
- Verified: `python3 -m py_compile` on both `main.py` files, a YAML parse of all 4 compose files, and a full frontend `tsc -b`/`vite build` (unaffected, since the `chatterbox`/`chatterbox_languages` field shapes on the status endpoint were preserved — no frontend changes needed for this correction).
- **Not yet done:** an actual end-to-end test of the new service on real hardware (this was all built and verified syntactically/structurally in a sandboxed environment without the ability to run `docker compose up` against real GPU/CPU inference) — the operator should rebuild and check `docker compose logs chatterbox-engine` to confirm it loads before considering this fully closed.

**Correction #3 (Aug 18, 2026, real-world deploy test revealed a resource conflict):** The separate-service fix above got both `ai-engine` and `chatterbox-engine` building and starting, but real deployment logs showed both stuck in a restart loop with no error text — classic OOM-kill signature (heavy ML processes, no traceback, repeating `Started server process` with no `Application startup complete` in between). Confirmed by stopping `chatterbox-engine` alone: `ai-engine` immediately loaded cleanly and stayed stable. Running XTTS + Whisper + Chatterbox + diffusers simultaneously exceeded the operator's EC2 instance's RAM.

Since the operator is standing up a second EC2 instance dedicated to Chatterbox (mirroring the existing `docker-compose.gcp.yml`/`docker-compose.runpod.yml` pattern for a remote F5-TTS GPU box, just one level more granular — only Chatterbox moves, not the whole `ai-engine`), added first-class support for that:
- `docker-compose.yml`, `docker-compose.prod.yml` — `CHATTERBOX_ENGINE_URL` externalized to `${CHATTERBOX_ENGINE_URL:-http://chatterbox-engine:8100}` (was hardcoded to the in-cluster name only). The local `chatterbox-engine` service is now gated behind a `local-chatterbox` Compose profile — **not started by a plain `docker compose up`** — so it's explicit whether you're running it locally (`docker compose --profile local-chatterbox up -d`) or pointing at a remote instance instead.
- New `docker-compose.chatterbox-remote.yml` — standalone, single-service compose file for the dedicated Chatterbox EC2 instance. Exposes port 8100 publicly (vs. the main file's internal-only `expose`), documents setting `CHATTERBOX_ENGINE_API_KEY` to the same shared secret as the main server's `AI_ENGINE_API_KEY` (already built into `chatterbox-engine/main.py`'s auth — no code change needed, just documentation), and recommends restricting port 8100 via EC2 Security Group to the main server's IP rather than relying on the API key alone.
- Root `.env.example` — documented `CHATTERBOX_ENGINE_URL` with both local and remote setup paths.
- Verified: all 5 compose files (including the new one) parse as valid YAML.
- **Still not verified end-to-end** — this is a second round of infrastructure changes built without the ability to run real `docker compose up` in this sandbox. The operator should deploy the new instance, then confirm from the main server: `curl http://REMOTE_IP:8100/` returns `{"status":"Online", ...}`, and that `docker compose logs ai-engine` shows `✓ Chatterbox ready (via http://REMOTE_IP:8100)` without restart-looping now that the memory pressure is split across two machines.

### 5. Public API tier for developers
- **What:** Issue scoped API keys per user/plan, meter usage against the existing `SynthesisQuota` / `TranslationQuota` services, publish basic docs (endpoints, auth, rate limits, example request).
- **Why:** Every major competitor (ElevenLabs, Murf, historically Play.ht) monetizes a developer/API segment separately from the UI product. Voxora's engine proxy and quota services already exist internally — this is largely exposing what's already built, not new infrastructure.
- **Effort:** Medium. New `api_keys` table + auth guard (Sanctum personal access tokens are a natural fit), a docs page, and rate-limit tiers per plan.
- **Done when:** A developer can generate an API key from Settings, hit a documented `/api/v1/synthesize` endpoint with it, and see usage count against their plan's quota.

### 6. Video dubbing MVP
- **What:** Upload a video → transcribe (Whisper, already integrated) → translate (Gemini, already integrated) → clone-synthesize in the target language (XTTS, already integrated) → mux the new audio track back onto the video.
- **Why:** Dubbing is one of the fastest-growing categories in this market in 2026 (ElevenLabs and Murf both lead heavily with it) and Voxora currently has zero equivalent, despite already owning every individual building block (STT, translation, cloning).
- **Effort:** Medium–Large. Not new ML — it's an orchestration pipeline (background job that chains 3 existing capabilities) plus a video upload/mux step (ffmpeg, already used elsewhere in the codebase) plus new UI.
- **Done when:** A user can upload a short video, pick a target language, and download a version dubbed in their cloned voice with audio synced to the original timing (even if imperfect lip-sync — audio-only dubbing is an acceptable v1).

### 7. Upgrade the base TTS model / add a "quality tier"
- **What:** XTTS v2 (2023-era open model) is the hard ceiling on how natural Voxora's output can sound, and it's now behind ElevenLabs and Murf in every recent third-party comparison. Two viable paths: (a) integrate a newer open model that isn't GPU-only-gated the way the current F5 setup is, or (b) offer an optional "Premium Quality" tier that proxies to a commercial API (e.g., ElevenLabs or OpenAI TTS) behind the same UI, billed at cost-plus-margin.
- **Why:** This is the single biggest lever on output quality — the thing every buyer actually judges the product on — and it's currently the widest gap versus competitors.
- **Effort:** Large. Option (b) is faster to ship (proxy integration + billing logic, days–weeks) but has ongoing per-generation cost and vendor dependency. Option (a) is a deeper engine change (model integration, hosting/GPU cost, testing) but keeps the self-hosted story intact. Recommend starting with (b) as a paid add-on tier to validate demand before committing to (a).
- **Done when:** At least one synthesis path produces output that's competitive with ElevenLabs Multilingual v2 in a blind A/B, gated behind a plan tier or add-on.

---

## P2 — Should Have

*Ordered easy → hard.*

### 8. Highlight the system-health/admin tooling as a trust signal
- **What:** The 15-probe live system-check panel and audit log are already more thorough than most competitors' public status pages. Currently this is purely internal — surface a simplified, public-facing version (uptime/status page) for agency and enterprise buyers evaluating reliability.
- **Why:** Free win — the engineering work is already done, this is just packaging it as a sales asset.
- **Effort:** Small. A public read-only status page pulling from a subset of the existing `SystemCheckController` probes.
- **Done when:** A `/status` page exists showing uptime/health without exposing sensitive internals.

### 9. No-signup "try your own voice" landing widget
- **What:** A lightweight, unauthenticated widget on the landing page: record 10–15 seconds, hear it cloned back immediately, no account required.
- **Why:** Cloning-on-free-tier is Voxora's core differentiator, but a visitor currently has to sign up before experiencing it. Several competitors use exactly this kind of pre-signup demo specifically because it's the strongest conversion tool for a cloning-first product.
- **Effort:** Medium. Needs a heavily rate-limited, ephemeral (no-storage) synthesis endpoint and a short client-side recorder — the guest-session infrastructure already exists and can likely be extended rather than rebuilt.
- **Done when:** A first-time visitor can hear their own cloned voice within ~30 seconds of landing, zero signup.

### 10. SFX lane in the Assembly timeline
- **What:** Assembly currently supports voice + background-music lanes but no dedicated sound-effects lane/library.
- **Why:** Closes a gap with all-in-one editors like Descript and makes the timeline tool a more complete production surface rather than voice-plus-one-music-bed.
- **Effort:** Medium. Reuses existing lane/clip infrastructure (`TimelineClip`, lane config) — mainly a new asset-library UI and lane type, not new audio engineering.
- **Done when:** Users can drag SFX clips onto a dedicated lane alongside voice and music, with the same trim/volume controls already built for music.

### 11. Team / seat collaboration
- **What:** Multi-user workspaces with roles (owner/editor/viewer), shared projects and voice profiles within an org.
- **Why:** Every competitor above the entry tier sells multi-seat plans; Voxora's current schema is single-user-per-account with no team/org concept.
- **Effort:** Large. Requires a new data model (organizations, memberships, roles), permission checks across most existing controllers, and new billing logic (seat-based pricing). This touches a lot of the existing codebase, not just an additive feature.
- **Done when:** An account owner can invite teammates, assign roles, and share projects/voice profiles within a workspace, billed per seat.

---

## P3 — Nice to Have

*Ordered easy → hard.*

### 12. Design-tool integrations (Canva / PowerPoint / Google Slides)
- **What:** Plugins or app integrations that let users generate/insert Voxora voiceovers directly inside Canva, PowerPoint, or Slides.
- **Why:** This is Murf's single biggest enterprise wedge and Voxora has no equivalent. High value, but genuinely a separate integration-engineering effort per platform.
- **Effort:** Large, and multiplies per platform (each has its own extension/plugin SDK and review process). Recommend picking one (PowerPoint, given Anthropic's own ecosystem already has a Claude-for-PowerPoint precedent to model workflow off of) before attempting all three.
- **Done when:** At least one platform (recommend PowerPoint first) has a working add-in that can insert Voxora-generated narration into a slide deck without leaving the app.

### 13. Voice marketplace / shared library
- **What:** Let Pro/Creator users optionally publish a cloned voice to a shared library other users can license/use, with the existing consent-only framework governing what's publishable.
- **Why:** Turns a single-player feature (your own cloned voice) into a network-effect asset (a growing library), and fits the trust model already established by the recent consent-positioning work in the codebase.
- **Effort:** Large. Needs consent/verification workflow beyond current self-use consent, a licensing/attribution or royalty model, discovery/browse UI, and moderation — this is closer to a new product surface than a feature.
- **Done when:** A user can opt a cloned voice into a public library with explicit extended consent, and other users can discover and use it under whatever licensing terms are defined.

### 14. Native mobile app
- **What:** iOS/Android app for recording reference clips, browsing projects, and triggering synthesis on the go.
- **Why:** Speechify and VoiceClone AI both partly compete on mobile-first access; lowest priority here because it's a large build for a use case (recording on a phone) that's already achievable today via mobile web.
- **Effort:** Very large — full native (or cross-platform) app development and app-store maintenance overhead.
- **Done when:** Deferred until P0–P2 items are shipped and there's clear demand signal (e.g., support requests, analytics showing heavy mobile-web usage) to justify the investment.

---

## Suggested execution order (combining priority + difficulty)

1. Fix pricing/Terms mismatch *(P0, trivial — do this today)* ✅
2. Add self-hosted infrastructure messaging to marketing *(P1, easy)* ✅
3. Honest-ify RVC/F5-TTS UI state *(P1, easy–medium)* ✅
4. Add Chatterbox as a third TTS engine option *(P1, medium — closes a real licensing gap too)* ✅
5. Public API tier *(P1, medium)*
6. System-health public status page *(P2, easy — can slot in anytime as a quick win)*
7. Video dubbing MVP *(P1, medium–large)*
8. No-signup "try your voice" widget *(P2, medium)*
9. SFX lane *(P2, medium)*
10. Base model quality tier (proxy option first) *(P1, large but high-leverage)*
11. Team/seat collaboration *(P2, large)*
12. Design-tool integrations *(P3, large)*
13. Voice marketplace *(P3, large)*
14. Native mobile app *(P3, very large — revisit later)*
