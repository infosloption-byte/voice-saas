import { type GateType } from './hooks/useGuestSession'
import { DEFAULT_GUEST_LIMITS } from './hooks/useGuestLimits'
import type { GuestLimits } from './types'

function buildContent(limits: GuestLimits): Record<GateType, { title: string; message: string; icon: string }> {
  return {
    synth_limit:     {
      icon: '🎙',
      title: 'Free generation used',
      message: `You've used your ${limits.synth_limit} free voiceover${limits.synth_limit !== 1 ? 's' : ''}. Subscribe to unlock unlimited synthesis with your cloned voice.`,
    },
    word_limit:      {
      icon: '📝',
      title: 'Script too long for guest mode',
      message: `Guest synthesis is limited to ${limits.word_limit} words. Subscribe to remove all word limits.`,
    },
    download:        {
      icon: '⬇️',
      title: 'Your audio is ready to download',
      message: 'Subscribe to download your synthesised audio as WAV, MP3 or ZIP — and keep everything you create.',
    },
    preview_limit:   {
      icon: '🔊',
      title: 'Preview limit reached',
      message: `You've used your ${limits.preview_limit} free voice preview${limits.preview_limit !== 1 ? 's' : ''}. Subscribe for unlimited previews and synthesis.`,
    },
    assembly_export: {
      icon: '🎛',
      title: 'Export your assembled mix',
      message: 'Subscribe to merge your timeline and export the final audio as WAV or MP3.',
    },
    script_limit:    {
      icon: '📄',
      title: 'Script limit reached',
      message: `Guest projects are limited to ${limits.script_limit} scripts. Subscribe to create unlimited scripts across unlimited projects.`,
    },
    profile_limit:   {
      icon: '🎤',
      title: 'Voice profile limit reached',
      message: `Guest sessions support up to ${limits.profile_limit} voice profiles stored locally. Subscribe to save unlimited profiles.`,
    },
  }
}

interface GuestUpgradeModalProps {
  type: GateType
  guestLimits?: GuestLimits
  onSignIn: () => void
  onSignUp: () => void
  onClose: () => void
}

export function GuestUpgradeModal({ type, guestLimits = DEFAULT_GUEST_LIMITS, onSignIn, onSignUp, onClose }: GuestUpgradeModalProps) {
  const c = buildContent(guestLimits)[type]

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 420, textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>{c.icon}</div>

        <div className="modal__title" style={{ fontSize: 18, marginBottom: 10 }}>{c.title}</div>

        <p style={{
          fontSize: 14, color: 'var(--text-2)', lineHeight: 1.65,
          marginBottom: 24, padding: '0 8px',
        }}>
          {c.message}
        </p>

        {/* Perks list */}
        <div style={{
          background: 'var(--bg-2)', border: '1px solid var(--border)',
          borderRadius: 10, padding: '14px 18px', marginBottom: 20, textAlign: 'left',
        }}>
          {[
            'Unlimited synthesis — any length, any script',
            'Download WAV, MP3 and ZIP exports',
            'Unlimited voice profiles saved to cloud',
            'Timeline assembly & background music',
            'Projects saved permanently to your account',
          ].map(item => (
            <div key={item} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ color: 'var(--ok)', fontSize: 13, flexShrink: 0 }}>✓</span>
              <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{item}</span>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, flexDirection: 'column' }}>
          <button
            className="btn btn--primary"
            style={{ width: '100%', justifyContent: 'center', padding: '11px 0', fontSize: 14 }}
            onClick={onSignUp}
          >
            Subscribe & Get Full Access
          </button>
          <button
            className="btn btn--ghost"
            style={{ width: '100%', justifyContent: 'center', fontSize: 13 }}
            onClick={onSignIn}
          >
            Already have an account? Sign in
          </button>
        </div>

        <button
          onClick={onClose}
          style={{
            marginTop: 14, background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 12, color: 'var(--text-3)',
          }}
        >
          Continue exploring as guest
        </button>
      </div>
    </div>
  )
}
