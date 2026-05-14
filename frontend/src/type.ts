// ── Shared types for VoiceStudio ──────────────────────────────────

export type Page =
  | 'landing' | 'signin' | 'signup'
  | 'dashboard' | 'projects' | 'workspace' | 'profiles' | 'settings'

export type WorkspaceTab = 'scripts' | 'assembly'
export type SaveState = 'saved' | 'saving' | 'unsaved'

export interface Project {
  id: string
  name: string
  emoji: string
  description: string
  createdAt: string
  scripts: Script[]
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
  waveformPeaks?: number[]
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
  profile_id: string
  filename: string
  duration?: number
}

export interface HistoryState {
  past: string[]
  present: string
  future: string[]
}