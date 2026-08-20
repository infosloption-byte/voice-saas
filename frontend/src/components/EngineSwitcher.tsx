import { useState } from 'react'
import { toast } from '../lib/toast'
import { icons } from '../lib/constants'
import type { TTSEngine } from '../hooks/useTTSEngine'
import type { EngineCaps } from '../lib/types'

// ── Small engine badge (label chip) ─────────────────────────────────
export function EngineBadge({ engine, size = 'sm' }: { engine: TTSEngine; size?: 'sm' | 'md' }) {
  const color = engine === 'f5' ? '#4278c9' : engine === 'chatterbox' ? '#e0703c' : 'var(--accent)'
  const bg    = engine === 'f5' ? 'rgba(66,120,201,0.12)' : engine === 'chatterbox' ? 'rgba(224,112,60,0.12)' : 'var(--accent-lt)'
  const border = engine === 'f5' ? 'rgba(66,120,201,0.25)' : engine === 'chatterbox' ? 'rgba(224,112,60,0.25)' : 'var(--accent-mid)'
  const label = size === 'md'
    ? (engine === 'f5' ? 'F5-TTS' : engine === 'chatterbox' ? 'Chatterbox' : 'XTTS v2')
    : (engine === 'f5' ? 'F5' : engine === 'chatterbox' ? 'CBX' : 'XTTS')
  return (
    <span style={{
      fontSize: size === 'md' ? 10 : 9,
      fontWeight: 700,
      letterSpacing: '0.5px',
      textTransform: 'uppercase' as const,
      padding: size === 'md' ? '3px 8px' : '2px 6px',
      borderRadius: size === 'md' ? 5 : 4,
      background: bg,
      color,
      border: `1px solid ${border}`,
      flexShrink: 0,
    }}>
      {label}
    </span>
  )
}

/**
 * Reusable TTS engine picker dropdown. Shared between the Workspace editor
 * footer and the Voice Profiles page so switching engines doesn't require
 * a trip to Settings — both surfaces read/write the same `useTTSEngine()`
 * localStorage-backed preference, so a change here is picked up wherever
 * that hook is next read (e.g. on next render/navigation).
 */
export function EngineSwitcher({ engine, setEngine, engineCaps, align = 'center' }: {
  engine: TTSEngine
  setEngine: (e: TTSEngine) => void
  engineCaps: EngineCaps
  /** Horizontal anchor of the dropdown relative to the trigger button. */
  align?: 'left' | 'center'
}) {
  const [open, setOpen] = useState(false)

  const currentEngineAvailable =
    engine === 'f5' ? engineCaps.f5 :
    engine === 'chatterbox' ? (engineCaps.chatterbox ?? false) :
    engineCaps.xtts

  const options = [
    {
      id: 'xtts' as TTSEngine,
      label: 'XTTS v2',
      desc: '16 languages · multilingual · fast',
      color: 'var(--accent)',
      available: engineCaps.xtts,
    },
    {
      id: 'f5' as TTSEngine,
      label: 'F5-TTS',
      desc: `Flow-matching · natural prosody · ${
        (engineCaps.f5_languages && engineCaps.f5_languages.length)
          ? engineCaps.f5_languages.join('/').toUpperCase()
          : 'English'
      } · all voices`,
      color: '#4278c9',
      available: engineCaps.f5,
    },
    {
      id: 'chatterbox' as TTSEngine,
      label: 'Chatterbox',
      desc: `MIT-licensed · expressive · ${
        (engineCaps.chatterbox_languages && engineCaps.chatterbox_languages.length)
          ? `${engineCaps.chatterbox_languages.length} languages`
          : 'multilingual'
      }`,
      color: '#e0703c',
      available: engineCaps.chatterbox ?? false,
    },
  ]

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        className="btn btn--sm btn--ghost"
        onClick={() => setOpen(v => !v)}
        title="Switch TTS engine"
        style={{ gap: 5, paddingRight: 8 }}
      >
        <EngineBadge engine={engine} />
        {!currentEngineAvailable && (
          <span
            title={`${engine === 'f5' ? 'F5-TTS' : engine === 'chatterbox' ? 'Chatterbox' : 'XTTS v2'} is not available on this server`}
            style={{
              width: 7, height: 7, borderRadius: '50%',
              background: 'var(--warn)', flexShrink: 0,
              boxShadow: '0 0 0 2px var(--warn-lt)',
            }}
          />
        )}
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"
          style={{ width: 10, height: 10, opacity: 0.5 }}>
          <path d="M5 8l5 5 5-5" />
        </svg>
      </button>

      {open && (
        <>
          {/* click-away overlay */}
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 199 }}
            onClick={() => setOpen(false)}
          />
          <div style={{
            position: 'absolute', top: 'calc(100% + 6px)',
            left: align === 'left' ? 0 : '50%',
            transform: align === 'left' ? 'none' : 'translateX(-50%)',
            background: 'var(--surface)', border: '1px solid var(--border-2)',
            borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-lg)',
            zIndex: 200, width: 260, maxWidth: 'calc(100vw - 24px)', overflow: 'hidden',
          }}>
            <div style={{ padding: '8px 12px 6px', fontSize: 10, fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '0.7px', color: 'var(--text-3)' }}>
              TTS Engine
            </div>

            {options.map(opt => (
              <button
                key={opt.id}
                disabled={!opt.available}
                onClick={() => {
                  if (!opt.available) {
                    const hint =
                      opt.id === 'f5' ? 'F5-TTS needs a GPU — use XTTS v2 instead.' :
                      opt.id === 'chatterbox' ? 'Chatterbox is not installed on this server — use XTTS v2 or F5-TTS instead.' :
                      ''
                    toast.info(`${opt.label} is unavailable on this server. ${hint}`)
                    return
                  }
                  setEngine(opt.id); setOpen(false)
                }}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10,
                  width: '100%', padding: '9px 12px', border: 'none',
                  background: engine === opt.id ? `${opt.color}10` : 'transparent',
                  cursor: opt.available ? 'pointer' : 'not-allowed', textAlign: 'left', transition: 'background 0.1s',
                  borderLeft: engine === opt.id ? `3px solid ${opt.color}` : '3px solid transparent',
                  opacity: opt.available ? 1 : 0.55,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 13, fontWeight: 600, color: 'var(--text-1)',
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}>
                    {opt.label}
                    {engine === opt.id && (
                      <span style={{ width: 14, height: 14, color: opt.color }}>{icons.check}</span>
                    )}
                    <span style={{
                      fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 99,
                      background: opt.available ? 'var(--ok-lt)' : 'var(--warn-lt)',
                      color: opt.available ? 'var(--ok)' : 'var(--warn)',
                      border: `1px solid ${opt.available ? 'rgba(59,125,99,0.25)' : 'rgba(160,117,48,0.25)'}`,
                      letterSpacing: '0.3px',
                    }}>
                      {opt.available ? 'Ready' : (opt.id === 'f5' ? 'Needs GPU' : 'Unavailable')}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 1 }}>
                    {opt.desc}
                  </div>
                </div>
              </button>
            ))}

            <div style={{
              padding: '6px 12px 8px', fontSize: 11, color: 'var(--text-3)',
              borderTop: '1px solid var(--border)', lineHeight: 1.5, marginTop: 2,
            }}>
              Applies to all future generations in this session.
            </div>
          </div>
        </>
      )}
    </div>
  )
}
