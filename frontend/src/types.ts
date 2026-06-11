// ── Shared types for Voxora ──────────────────────────────────

export type Plan = 'free' | 'starter' | 'pro'

export type Page =
  | 'landing' | 'signin' | 'signup'
  | 'forgot-password' | 'reset-password'
  | 'dashboard' | 'projects' | 'workspace' | 'profiles' | 'settings' | 'admin'
  | 'pricing' | 'privacy' | 'terms'
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
  plan_override?: 'starter' | 'pro' | null
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

/**
 * Mirrors the `engines` object returned by the AI engine's GET / endpoint.
 * { xtts: true, f5: false } means XTTS is loaded but F5-TTS is not installed.
 */
export interface EngineCaps {
  xtts: boolean
  f5: boolean
  /** Language codes the loaded F5 checkpoint speaks (e.g. ['es'] or ['en']). */
  f5_languages?: string[]
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
  warning?: string
}

export interface TranscriptionResult {
  text: string
}
