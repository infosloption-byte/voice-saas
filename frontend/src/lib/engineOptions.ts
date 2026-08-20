import type { TTSEngine } from '../hooks/useTTSEngine'
import type { EngineCaps } from './types'

export interface EngineMeta {
  id: TTSEngine
  label: string
  color: string
  available: boolean
  /** Full sentence, for surfaces with room (EngineSwitcher's dropdown option list). */
  descLong: string
  /** Short chip text, for compact surfaces (e.g. Settings' engine cards). */
  descShort: string
  /** Short, standalone reason text for a "not installed / unavailable" warning banner. */
  warning: string
}

/**
 * Single source of truth for TTS engine metadata (label, color, live
 * availability, and warning copy), derived from `engineCaps`. Used by both
 * `EngineSwitcher` (components/EngineSwitcher.tsx) and `SettingsPage`'s own
 * card-based picker — the two intentionally render different UI shapes
 * (compact dropdown vs. always-visible cards, since Settings has room for
 * the latter and a toolbar doesn't), but both need the exact same
 * underlying availability logic and shouldn't maintain two copies of it
 * that can silently drift.
 *
 * Lives in lib/ rather than components/EngineSwitcher.tsx itself because a
 * file that exports both React components and plain functions breaks Vite
 * Fast Refresh (react-refresh/only-export-components) — this codebase's
 * existing convention already separates shared logic (lib/) from shared UI
 * (components/) for exactly this reason.
 */
export function getEngineOptions(engineCaps: EngineCaps): EngineMeta[] {
  const f5Langs = engineCaps.f5_languages ?? []
  const cbLangs = engineCaps.chatterbox_languages ?? []
  return [
    {
      id: 'xtts', label: 'XTTS v2', color: 'var(--accent)',
      available: engineCaps.xtts,
      descLong: '16 languages · multilingual · fast',
      descShort: '16 languages',
      warning: 'XTTS v2 is not available on this server. Check the engine logs.',
    },
    {
      id: 'f5', label: 'F5-TTS', color: '#4278c9',
      available: engineCaps.f5,
      descLong: `Flow-matching · natural prosody · ${f5Langs.length ? f5Langs.join('/').toUpperCase() : 'English'} · all voices`,
      descShort: 'English-first',
      warning: 'F5-TTS is not installed. Run "pip install f5-tts" or switch to XTTS v2.',
    },
    {
      id: 'chatterbox', label: 'Chatterbox', color: '#e0703c',
      available: engineCaps.chatterbox ?? false,
      descLong: `MIT-licensed · expressive · ${cbLangs.length ? `${cbLangs.length} languages` : 'multilingual'}`,
      descShort: 'MIT-licensed',
      warning: 'Chatterbox is not installed. Run "pip install chatterbox-tts" or switch to XTTS v2 / F5-TTS.',
    },
  ]
}
