# Voxora Enhancement Task List

*Companion to `voxora-analysis.md`. Organized by priority tier first (what's required vs. optional), then within each tier ordered easiest → hardest so work can start immediately and build momentum.*

**How to read this:**
- **P0 — Must Fix Now**: broken, wrong, or actively losing you money/trust/customers. Not optional.
- **P1 — Must Have**: closes a real competitive gap or unlocks a revenue segment. Should be on the roadmap.
- **P2 — Should Have**: meaningfully strengthens the product but isn't blocking growth.
- **P3 — Nice to Have**: polish, differentiation, or long-horizon bets.

Each task includes: what it is, why it matters, rough effort, and what "done" looks like.

---

## P0 — Must Fix Now

### 1. Fix the pricing / Terms mismatch
- **What:** Terms of Service and Refund Policy pages still say Starter $9.99 / Pro $24.99 (2-tier, old model). Live pricing page says Free / Starter $9 / Creator $29 / Pro $79 (4-tier).
- **Why:** A legal document that doesn't match what you actually bill customers is a real compliance and dispute-liability problem — not cosmetic copy drift.
- **Effort:** Trivial (1–2 hours). Update `LegalPages.tsx` text to match `PricingPage.tsx`.
- **Done when:** Every price mentioned in Terms/Refund/Privacy exactly matches `PricingPage.tsx`, and there's a single source of truth (ideally pull plan names/prices from the same `PLANS` constant instead of hardcoding text twice).

---

## P1 — Must Have

*Ordered easy → hard.*

### 2. Add the self-hosted / white-label story to marketing
- **What:** State clearly on the landing page and pricing page that Voxora can be deployed under the buyer's own domain/infrastructure — full data residency, no per-seat SaaS lock-in.
- **Why:** This is a genuine structural advantage over every competitor reviewed (ElevenLabs, Murf, Speechify, Descript) and it currently appears nowhere in the marketing copy. Free, high-leverage.
- **Effort:** Small (copywriting + maybe one new landing section). No backend work.
- **Done when:** Landing page has a dedicated section/FAQ entry on self-hosting/white-labeling; pricing page or a new "Enterprise/Agency" tier references it explicitly.

### 3. Honest-ify RVC and F5-TTS instead of half-advertising them
- **What:** Either (a) hide RVC and F5-TTS from the picker until an operator has actually configured them (trained model / GPU + checkpoint), or (b) add plain-language in-app messaging explaining the prerequisite instead of a silent failure or confusing "unavailable" state.
- **Why:** Right now these are capabilities that exist in code but aren't usable by a typical operator without manual, undocumented ops work. Shipping a feature that looks broken is worse than not shipping it.
- **Effort:** Small–Medium. Mostly conditional UI logic + admin-panel messaging; the `f5_usable()` / `f5_languages` and RVC-loaded checks already exist server-side — this is about surfacing that state honestly in the UI.
- **Done when:** A user/admin can tell at a glance whether F5/RVC are actually usable on their deployment, with a clear next step if not.

### 4. Public API tier for developers
- **What:** Issue scoped API keys per user/plan, meter usage against the existing `SynthesisQuota` / `TranslationQuota` services, publish basic docs (endpoints, auth, rate limits, example request).
- **Why:** Every major competitor (ElevenLabs, Murf, historically Play.ht) monetizes a developer/API segment separately from the UI product. Voxora's engine proxy and quota services already exist internally — this is largely exposing what's already built, not new infrastructure.
- **Effort:** Medium. New `api_keys` table + auth guard (Sanctum personal access tokens are a natural fit), a docs page, and rate-limit tiers per plan.
- **Done when:** A developer can generate an API key from Settings, hit a documented `/api/v1/synthesize` endpoint with it, and see usage count against their plan's quota.

### 5. Video dubbing MVP
- **What:** Upload a video → transcribe (Whisper, already integrated) → translate (Gemini, already integrated) → clone-synthesize in the target language (XTTS, already integrated) → mux the new audio track back onto the video.
- **Why:** Dubbing is one of the fastest-growing categories in this market in 2026 (ElevenLabs and Murf both lead heavily with it) and Voxora currently has zero equivalent, despite already owning every individual building block (STT, translation, cloning).
- **Effort:** Medium–Large. Not new ML — it's an orchestration pipeline (background job that chains 3 existing capabilities) plus a video upload/mux step (ffmpeg, already used elsewhere in the codebase) plus new UI.
- **Done when:** A user can upload a short video, pick a target language, and download a version dubbed in their cloned voice with audio synced to the original timing (even if imperfect lip-sync — audio-only dubbing is an acceptable v1).

### 6. Upgrade the base TTS model / add a "quality tier"
- **What:** XTTS v2 (2023-era open model) is the hard ceiling on how natural Voxora's output can sound, and it's now behind ElevenLabs and Murf in every recent third-party comparison. Two viable paths: (a) integrate a newer open model that isn't GPU-only-gated the way the current F5 setup is, or (b) offer an optional "Premium Quality" tier that proxies to a commercial API (e.g., ElevenLabs or OpenAI TTS) behind the same UI, billed at cost-plus-margin.
- **Why:** This is the single biggest lever on output quality — the thing every buyer actually judges the product on — and it's currently the widest gap versus competitors.
- **Effort:** Large. Option (b) is faster to ship (proxy integration + billing logic, days–weeks) but has ongoing per-generation cost and vendor dependency. Option (a) is a deeper engine change (model integration, hosting/GPU cost, testing) but keeps the self-hosted story intact. Recommend starting with (b) as a paid add-on tier to validate demand before committing to (a).
- **Done when:** At least one synthesis path produces output that's competitive with ElevenLabs Multilingual v2 in a blind A/B, gated behind a plan tier or add-on.

---

## P2 — Should Have

*Ordered easy → hard.*

### 7. Highlight the system-health/admin tooling as a trust signal
- **What:** The 15-probe live system-check panel and audit log are already more thorough than most competitors' public status pages. Currently this is purely internal — surface a simplified, public-facing version (uptime/status page) for agency and enterprise buyers evaluating reliability.
- **Why:** Free win — the engineering work is already done, this is just packaging it as a sales asset.
- **Effort:** Small. A public read-only status page pulling from a subset of the existing `SystemCheckController` probes.
- **Done when:** A `/status` page exists showing uptime/health without exposing sensitive internals.

### 8. No-signup "try your own voice" landing widget
- **What:** A lightweight, unauthenticated widget on the landing page: record 10–15 seconds, hear it cloned back immediately, no account required.
- **Why:** Cloning-on-free-tier is Voxora's core differentiator, but a visitor currently has to sign up before experiencing it. Several competitors use exactly this kind of pre-signup demo specifically because it's the strongest conversion tool for a cloning-first product.
- **Effort:** Medium. Needs a heavily rate-limited, ephemeral (no-storage) synthesis endpoint and a short client-side recorder — the guest-session infrastructure already exists and can likely be extended rather than rebuilt.
- **Done when:** A first-time visitor can hear their own cloned voice within ~30 seconds of landing, zero signup.

### 9. SFX lane in the Assembly timeline
- **What:** Assembly currently supports voice + background-music lanes but no dedicated sound-effects lane/library.
- **Why:** Closes a gap with all-in-one editors like Descript and makes the timeline tool a more complete production surface rather than voice-plus-one-music-bed.
- **Effort:** Medium. Reuses existing lane/clip infrastructure (`TimelineClip`, lane config) — mainly a new asset-library UI and lane type, not new audio engineering.
- **Done when:** Users can drag SFX clips onto a dedicated lane alongside voice and music, with the same trim/volume controls already built for music.

### 10. Team / seat collaboration
- **What:** Multi-user workspaces with roles (owner/editor/viewer), shared projects and voice profiles within an org.
- **Why:** Every competitor above the entry tier sells multi-seat plans; Voxora's current schema is single-user-per-account with no team/org concept.
- **Effort:** Large. Requires a new data model (organizations, memberships, roles), permission checks across most existing controllers, and new billing logic (seat-based pricing). This touches a lot of the existing codebase, not just an additive feature.
- **Done when:** An account owner can invite teammates, assign roles, and share projects/voice profiles within a workspace, billed per seat.

---

## P3 — Nice to Have

*Ordered easy → hard.*

### 11. Design-tool integrations (Canva / PowerPoint / Google Slides)
- **What:** Plugins or app integrations that let users generate/insert Voxora voiceovers directly inside Canva, PowerPoint, or Slides.
- **Why:** This is Murf's single biggest enterprise wedge and Voxora has no equivalent. High value, but genuinely a separate integration-engineering effort per platform.
- **Effort:** Large, and multiplies per platform (each has its own extension/plugin SDK and review process). Recommend picking one (PowerPoint, given Anthropic's own ecosystem already has a Claude-for-PowerPoint precedent to model workflow off of) before attempting all three.
- **Done when:** At least one platform (recommend PowerPoint first) has a working add-in that can insert Voxora-generated narration into a slide deck without leaving the app.

### 12. Voice marketplace / shared library
- **What:** Let Pro/Creator users optionally publish a cloned voice to a shared library other users can license/use, with the existing consent-only framework governing what's publishable.
- **Why:** Turns a single-player feature (your own cloned voice) into a network-effect asset (a growing library), and fits the trust model already established by the recent consent-positioning work in the codebase.
- **Effort:** Large. Needs consent/verification workflow beyond current self-use consent, a licensing/attribution or royalty model, discovery/browse UI, and moderation — this is closer to a new product surface than a feature.
- **Done when:** A user can opt a cloned voice into a public library with explicit extended consent, and other users can discover and use it under whatever licensing terms are defined.

### 13. Native mobile app
- **What:** iOS/Android app for recording reference clips, browsing projects, and triggering synthesis on the go.
- **Why:** Speechify and VoiceClone AI both partly compete on mobile-first access; lowest priority here because it's a large build for a use case (recording on a phone) that's already achievable today via mobile web.
- **Effort:** Very large — full native (or cross-platform) app development and app-store maintenance overhead.
- **Done when:** Deferred until P0–P2 items are shipped and there's clear demand signal (e.g., support requests, analytics showing heavy mobile-web usage) to justify the investment.

---

## Suggested execution order (combining priority + difficulty)

1. Fix pricing/Terms mismatch *(P0, trivial — do this today)*
2. Add self-hosted/white-label messaging to marketing *(P1, easy)*
3. Honest-ify RVC/F5-TTS UI state *(P1, easy–medium)*
4. Public API tier *(P1, medium)*
5. System-health public status page *(P2, easy — can slot in anytime as a quick win)*
6. Video dubbing MVP *(P1, medium–large)*
7. No-signup "try your voice" widget *(P2, medium)*
8. SFX lane *(P2, medium)*
9. Base model quality tier (proxy option first) *(P1, large but high-leverage)*
10. Team/seat collaboration *(P2, large)*
11. Design-tool integrations *(P3, large)*
12. Voice marketplace *(P3, large)*
13. Native mobile app *(P3, very large — revisit later)*
