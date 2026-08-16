interface GuestBannerProps {
  daysRemaining: number
  hoursRemaining: number
  onSignUp: () => void
  onSignIn: () => void
}

export function GuestBanner({ daysRemaining, hoursRemaining, onSignUp, onSignIn }: GuestBannerProps) {
  const urgent   = hoursRemaining <= 24
  const warning  = daysRemaining <= 3 && !urgent
  const bgColor  = urgent  ? 'rgba(192,57,43,0.12)'  : warning ? 'rgba(160,117,48,0.10)' : 'var(--bg-2)'
  const border   = urgent  ? 'rgba(192,57,43,0.30)'  : warning ? 'rgba(160,117,48,0.25)' : 'var(--border)'
  const textCol  = urgent  ? 'var(--err)'             : warning ? 'var(--warn)'           : 'var(--text-2)'
  const dot      = urgent  ? '#e74c3c' : warning ? '#d4a017' : 'var(--accent)'

  const timeLabel = urgent
    ? `${hoursRemaining}h remaining`
    : `${daysRemaining} day${daysRemaining !== 1 ? 's' : ''} remaining`

  const msg = urgent
    ? `⚠ Your guest session expires in ${timeLabel} — sign up now or your work will be lost`
    : warning
      ? `Your guest session expires in ${timeLabel} — sign up to keep your project`
      : `Guest session · ${timeLabel}`

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '6px 16px',
      background: bgColor,
      borderBottom: `1px solid ${border}`,
      fontSize: 12,
      flexShrink: 0,
    }}>
      <span style={{
        width: 7, height: 7, borderRadius: '50%',
        background: dot, flexShrink: 0,
        boxShadow: urgent ? '0 0 0 3px rgba(231,76,60,0.25)' : 'none',
      }} />
      <span style={{ color: textCol, flex: 1 }}>{msg}</span>

      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        <button
          className="btn btn--ghost btn--sm"
          style={{ fontSize: 11, padding: '3px 10px' }}
          onClick={onSignIn}
        >
          Sign in
        </button>
        <button
          className="btn btn--primary btn--sm"
          style={{ fontSize: 11, padding: '3px 10px' }}
          onClick={onSignUp}
        >
          Subscribe & Save
        </button>
      </div>
    </div>
  )
}
