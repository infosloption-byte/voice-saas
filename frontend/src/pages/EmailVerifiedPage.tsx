import { useEffect, useState } from 'react'

interface Props {
  onGoToLogin: () => void
}

export function EmailVerifiedPage({ onGoToLogin }: Props) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    // Slight delay so the animation feels intentional
    const t = setTimeout(() => setVisible(true), 80)
    return () => clearTimeout(t)
  }, [])

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg)',
      padding: '24px',
    }}>
      <div style={{
        maxWidth: 440,
        width: '100%',
        background: 'var(--surface)',
        border: '1px solid var(--border-2)',
        borderRadius: 'var(--radius-xl)',
        padding: '48px 40px',
        textAlign: 'center',
        boxShadow: 'var(--shadow-lg)',
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(12px)',
        transition: 'opacity 0.35s ease, transform 0.35s ease',
      }}>
        {/* Success icon */}
        <div style={{
          width: 72,
          height: 72,
          borderRadius: '50%',
          background: 'rgba(34,197,94,0.12)',
          border: '2px solid rgba(34,197,94,0.35)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 28px',
          fontSize: 32,
        }}>
          ✓
        </div>

        {/* Voxora logo mark */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          marginBottom: 28,
        }}>
          <span style={{
            width: 32,
            height: 32,
            background: '#c0533a',
            borderRadius: 8,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 800,
            fontSize: 16,
            color: '#fff',
          }}>V</span>
          <span style={{
            fontSize: 18,
            fontWeight: 700,
            color: 'var(--text-1)',
            letterSpacing: '-0.4px',
          }}>Voxora</span>
        </div>

        <h1 style={{
          fontSize: 22,
          fontWeight: 700,
          color: 'var(--text-1)',
          letterSpacing: '-0.4px',
          marginBottom: 12,
        }}>
          Email verified!
        </h1>

        <p style={{
          fontSize: 15,
          color: 'var(--text-2)',
          lineHeight: 1.65,
          marginBottom: 32,
        }}>
          Your email address has been successfully verified.
          You're all set — sign in to start creating with Voxora.
        </p>

        <button
          className="btn btn--primary"
          style={{ width: '100%', fontSize: 15, padding: '12px 0' }}
          onClick={onGoToLogin}
        >
          Go to sign in
        </button>

        <p style={{
          marginTop: 20,
          fontSize: 13,
          color: 'var(--text-3)',
        }}>
          A confirmation email has been sent to your inbox.
        </p>
      </div>
    </div>
  )
}
