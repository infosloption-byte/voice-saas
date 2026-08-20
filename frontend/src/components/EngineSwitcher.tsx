import { useLayoutEffect, useRef, useState } from 'react'
import { toast } from '../lib/toast'
import { icons } from '../lib/constants'
import { getEngineOptions } from '../lib/engineOptions'
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

const VIEWPORT_MARGIN = 12


/**
 * Reusable TTS engine picker dropdown. Shared between the Workspace editor
 * footer and the Voice Profiles page so switching engines doesn't require
 * a trip to Settings — both surfaces read/write the same `useTTSEngine()`
 * localStorage-backed preference, so a change here is picked up wherever
 * that hook is next read (e.g. on next render/navigation).
 *
 * Positioning is computed against the viewport (not the trigger's nearest
 * relative ancestor), and flips/clamps on both axes so the panel never
 * renders partly off-screen regardless of where the trigger sits on the
 * page — bottom-of-page, right edge, mobile widths, etc.
 */
export function EngineSwitcher({ engine, setEngine, engineCaps }: {
  engine: TTSEngine
  setEngine: (e: TTSEngine) => void
  engineCaps: EngineCaps
}) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [panelStyle, setPanelStyle] = useState<React.CSSProperties>({})

  const currentEngineAvailable =
    engine === 'f5' ? engineCaps.f5 :
    engine === 'chatterbox' ? (engineCaps.chatterbox ?? false) :
    engineCaps.xtts

  const options = getEngineOptions(engineCaps)

  // Measure the trigger + panel once the panel is open, then pick whichever
  // side (above/below, left/right-clamped) actually has room. This runs in
  // a layout effect keyed only on `open` — NOT as an inline ref callback,
  // since a ref callback re-created on every render gets called by React
  // on every commit, and calling setState from it causes an infinite
  // render loop (React error #185, "Maximum update depth exceeded").
  useLayoutEffect(() => {
    if (!open) return

    function reposition() {
      const trigger = triggerRef.current
      const el = panelRef.current
      if (!trigger || !el) return
      const tb = trigger.getBoundingClientRect()
      const panelW = el.offsetWidth
      const panelH = el.offsetHeight
      const vw = window.innerWidth
      const vh = window.innerHeight

      // Vertical: prefer below; flip above if not enough room below but
      // there IS enough room above; otherwise clamp within viewport.
      const spaceBelow = vh - tb.bottom
      const spaceAbove = tb.top
      let top: number
      if (spaceBelow >= panelH + VIEWPORT_MARGIN || spaceBelow >= spaceAbove) {
        top = tb.bottom + 6
      } else {
        top = tb.top - panelH - 6
      }
      top = Math.min(Math.max(VIEWPORT_MARGIN, top), Math.max(VIEWPORT_MARGIN, vh - panelH - VIEWPORT_MARGIN))

      // Horizontal: align to the trigger's left edge by default, then clamp
      // so the panel never spills past the right or left edge of the viewport.
      let left = tb.left
      if (left + panelW > vw - VIEWPORT_MARGIN) left = vw - panelW - VIEWPORT_MARGIN
      left = Math.max(VIEWPORT_MARGIN, left)

      setPanelStyle({ position: 'fixed', top, left, margin: 0, transform: 'none' })
    }

    reposition()
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [open])

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        ref={triggerRef}
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
          <div
            ref={panelRef}
            style={{
              // Rendered hidden for one frame until the layout effect measures
              // it and flips to real fixed coordinates — avoids a flash at
              // a wrong/clipped position.
              visibility: panelStyle.position ? 'visible' : 'hidden',
              position: 'fixed', top: 0, left: 0,
              background: 'var(--surface)', border: '1px solid var(--border-2)',
              borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-lg)',
              zIndex: 200, width: 260, maxWidth: 'calc(100vw - 24px)', overflow: 'hidden',
              ...panelStyle,
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
                    toast.info(opt.warning)
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
                    {opt.descLong}
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
