import { GUEST_WORD_LIMIT, GUEST_PREVIEW_LIMIT, type GateType } from './hooks/useGuestSession'

const CONTENT: Record<GateType, { title: string; message: string; icon: string }> = {
  synth_limit:     {
    icon: '🎙',
    title: 'Free generation used',
    message: `You've used your 1 free voiceover. Subscribe to unlock unlimited synthesis with your cloned voice.`,
  },
  word_limit:      {
    icon: '📝',
    title: 'Script too long for guest mode',
    message: `Guest synthesis is limited to ${GUEST_WORD_LIMIT} words. Subscribe to remove all word limits.`,
  },
  download:        {
    icon: '⬇️',
    title: 'Your audio is ready to download',
    message: 'Subscribe to download your synthesised audio as WAV, MP3 or ZIP — and keep everything you create.',
  },
  preview_limit:   {
    icon: '🔊',
    title: 'Preview limit reached',
    message: `You've used your ${GUEST_PREVIEW_LIMIT} free voice previews. Subscribe for unlimited previews and synthesis.`,
  },
  assembly_export: {
    icon: '🎛',
    title: 'Export your assembled mix',
    message: 'Subscribe to merge your timeline and export the final audio as WAV or MP3.',
  },
  script_limit:    {
    icon: '📄',
    title: 'Script limit reached',
    message: 'Guest projects are limited to 3 scripts. Subscribe to create unlimited scripts across unlimited projects.',
  },
  profile_limit:   {
    icon: '🎤',
    title: 'Voice profile limit reached',
    message: 'Guest sessions support up to 2 voice profiles stored locally. Subscribe to save unlimited profiles.',
  },
}

interface GuestUpgradeModalProps {
  type: GateType
  onSignIn: () => void
  onSignUp: () => void
  onClose: () => void
}

export function GuestUpgradeModal({ type, onSignIn, onSignUp, onClose }: GuestUpgradeModalProps) {
  const c = CONTENT[type]

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
