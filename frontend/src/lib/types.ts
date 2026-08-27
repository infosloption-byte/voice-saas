// ── Shared types for Voxora ──────────────────────────────────

export type Plan = 'free' | 'starter' | 'creator' | 'pro'

export type Page =
  | 'landing' | 'signin' | 'signup'
  | 'forgot-password' | 'reset-password'
  | 'dashboard' | 'projects' | 'workspace' | 'profiles' | 'video-projects' | 'dubbing-studio' | 'settings' | 'admin'
  | 'pricing' | 'privacy' | 'terms' | 'refund' | 'acceptable-use'
  | 'email-verified'
  | 'feature-studio' | 'feature-voices' | 'feature-translation'
  | 'feature-timeline' | 'feature-audiobooks'

export type WorkspaceTab = 'scripts' | 'assembly'
export type SaveState = 'saved' | 'saving' | 'unsaved'
export type EngineStatus = 'checking' | 'online' | 'offline'

export interface User {
  id: string | number
  name: string
  email: string
  email_verified_at?: string | null
  plan_name?: Plan
  role?: 'user' | 'admin' | 'super_admin'
  is_admin?: boolean
  impersonated?: boolean
  suspended_at?: string | null
  plan_override?: 'starter' | 'creator' | 'pro' | null
}

export interface Subscription {
  plan: Plan
  status: string
  current_period_end?: string | null
  paypal_subscription_id?: string | null
}

export interface Project {
  id: string
  name: string
  emoji: string
  description: string
  createdAt: string
  scripts: Script[]
  timelineClips?: TimelineClip[]
  laneConfig?: { solo: Record<number, boolean>; mute: Record<number, boolean> }
}

export interface Script {
  id: string
  title: string
  content: string
  hasAudio: boolean
  profileId: string | null
  language: string
  duration: number | null
  speed: number          // 0.5–2.0
  tone: string           // 'natural' | 'expressive' | 'calm' | 'energetic'
  engine?: string        // 'xtts' | 'f5' — engine that last produced this script's audio
  speakerMap?: Record<string, string>  // speaker label → profile_id
  waveformPeaks?: number[]
  audioUrl?: string       // server-side audio backup URL (storage path)
  advancedParams?: { temperature?: number; top_k?: number; top_p?: number }
}

export interface TimelineClip {
  id: string
  scriptId: string
  start: number       // seconds from timeline origin
  dur: number         // visible duration (after trim)
  trimStart: number   // seconds trimmed from clip head
  trimEnd: number     // seconds trimmed from clip tail
  rawDur: number      // original full duration
  title: string
  ci: number          // colour index
  volume: number      // 0–2 gain
  isGap: boolean      // silence pad
  lane?: number       // vertical lane index (0-based); undefined = lane 0
  fadeIn?: number     // fade-in duration in seconds (applied at clip head)
  fadeOut?: number    // fade-out duration in seconds (applied at clip tail)
}

export type TimelineAction =
  | { type: 'SET'; clips: TimelineClip[] }
  | { type: 'UNDO' }
  | { type: 'REDO' }

export interface TimelineHistory {
  past: TimelineClip[][]
  present: TimelineClip[]
  future: TimelineClip[][]
}

export interface VoiceProfile {
  id: number
  profile_id: string
  engine_key?: string
  name: string
  status: string
  duration?: number | null
}

export interface HistoryState {
  past: string[]
  present: string
  future: string[]
}

// ── Dubbing review timeline ────────────────────────────────────────
// Deliberately separate from TimelineClip/TimelineHistory above — a dub
// segment isn't a mixable multi-lane audio clip (no trim/fade/volume/lane,
// can't overlap a neighbor), it's a single-lane, always-chronological
// slice of speech tied 1:1 to a translated line. Reusing TimelineClip
// would mean either bolting on a bunch of fields that make no sense here
// or fighting its invariants; a parallel, narrower type is clearer.
export interface DubSegment {
  id: string
  start: number       // seconds, absolute position in the source video
  end: number         // seconds; end > start always
  original: string     // source-language transcript text — read-only in the editor
  text: string         // translated text — the only field the review UI can edit
}

export type DubSegmentAction =
  | { type: 'SET'; segments: DubSegment[] }
  | { type: 'UNDO' }
  | { type: 'REDO' }

export interface DubSegmentHistory {
  past: DubSegment[][]
  present: DubSegment[]
  future: DubSegment[][]
}

/**
 * Task #15 (Video Studio) Phase 1 — mirrors VideoProjectController's
 * summarize() shape. `assets` is only present when fetched via
 * fetchVideoProject() (the show() endpoint); listVideoProjects() (index())
 * omits it, same asset_count-only-on-the-list-view pattern the audio
 * Project/Script relationship already uses.
 */
export interface VideoProject {
  id: string
  name: string
  status: 'draft' | 'rendering' | 'done' | 'failed'
  error: string | null
  duration_seconds: number | null
  has_output: boolean
  asset_count: number
  created_at: string | null
  updated_at: string | null
  assets?: VideoProjectAsset[]
  /** Task #15 Phase 5 — only present on the show() (fetchVideoProject) response, same asset_count-only-on-the-list-view pattern as `assets` above. Empty array on a project with no arrangement yet, never null. */
  timeline_json?: VideoTimelineClip[]
}

// ── Video Studio multi-lane timeline (task #15 Phase 5) ────────────
// Deliberately its own type, not a reuse of TimelineClip (Assembly,
// audio-only) or DubSegment (single-lane dubbing review) — see
// VideoProject's migration docblock on the backend for why this shape
// exists: independent `lane`/`start_time` per clip (real multi-lane,
// clips in different lanes can overlap in time — that's the whole
// point of lanes), `trim_in`/`trim_out` instead of TimelineClip's
// start/dur/trimStart/trimEnd/rawDur (simpler here since there's no
// waveform-peak/fade/volume mixing to carry), and `kind` carried
// per-clip (not derived) so the editor and backend agree on it without
// a join back to the asset on every read.
export interface VideoTimelineClip {
  id: string
  asset_id: string
  lane: number
  start_time: number
  trim_in: number
  trim_out: number
  kind: 'video' | 'image' | 'audio'
}

export type VideoTimelineAction =
  | { type: 'SET'; clips: VideoTimelineClip[] }
  | { type: 'UNDO' }
  | { type: 'REDO' }

export interface VideoTimelineHistory {
  past: VideoTimelineClip[][]
  present: VideoTimelineClip[]
  future: VideoTimelineClip[][]
}


export interface VideoProjectAssetTranscriptSegment {
  id: string
  start: number
  end: number
  /** Original transcribed text — kept for reference, never edited by the client. */
  original: string
  /** Possibly user-edited text — what actually gets synthesized. */
  text: string
}

export interface VideoProjectAsset {
  id: string
  kind: 'video' | 'image' | 'audio'
  source: 'upload' | 'dubbed' | 'extracted_audio' | 'synthesized_audio'
  parent_asset_id: string | null
  dubbing_job_id: string | null
  original_filename: string | null
  duration_seconds: number | null
  status: 'processing' | 'ready' | 'failed'
  /** Task #15 Phase 4 — only ever set on an 'extracted_audio' asset. */
  transcript_json: VideoProjectAssetTranscriptSegment[] | null
  /** Task #15 Phase 4 follow-up — Whisper's detected source language (e.g. 'es'), only ever set on an 'extracted_audio' asset. Not guaranteed to be one of LANGUAGES' codes. */
  detected_language: string | null
  /** Task #15 Phase 4 — extract/resynthesize failure reason; null otherwise. */
  error: string | null
  created_at: string | null
}


/**
 * Mirrors the `engines` object returned by the AI engine's GET / endpoint.
 * { xtts: true, f5: false } means XTTS is loaded but F5-TTS is not installed.
 */
export interface EngineCaps {
  xtts: boolean
  f5: boolean
  /** Language codes the loaded F5 checkpoint speaks (e.g. ['es'] or ['en']). */
  f5_languages?: string[]
  /** Chatterbox — unlike F5, runs on CPU too, so this isn't GPU-gated. */
  chatterbox?: boolean
  /** Language codes the loaded Chatterbox model speaks. */
  chatterbox_languages?: string[]
}

export interface GuestLimits {
  synth_limit: number
  word_limit: number
  preview_limit: number
  script_limit: number
  profile_limit: number
  session_days: number
}

// ── API response shapes ────────────────────────────────────────────
export interface SynthesisResult {
  warning?: string
}

export interface VoiceProfileSaveResult {
  profile_id: string
  duration_seconds?: number
  clips_saved?: number
  warning?: string
}

export interface TranscriptionResult {
  text: string
}