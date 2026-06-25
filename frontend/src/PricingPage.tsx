import { useState, useEffect, useRef } from 'react'
import { api } from './api'
import { toast } from './toast'
import { LogoMark, VoxNav, VoxFooter } from './LandingPage'
import './landing.css'
import type { Plan, User } from './types'

const PAYPAL_CLIENT_ID    = import.meta.env.VITE_PAYPAL_CLIENT_ID    as string | undefined
const PAYPAL_PLAN_STARTER = import.meta.env.VITE_PAYPAL_PLAN_STARTER as string | undefined
const PAYPAL_PLAN_CREATOR = import.meta.env.VITE_PAYPAL_PLAN_CREATOR as string | undefined
const PAYPAL_PLAN_PRO     = import.meta.env.VITE_PAYPAL_PLAN_PRO     as string | undefined

// ── Plan definitions ───────────────────────────────────────────────
interface PlanDef {
  id: Plan
  name: string
  price: string
  period: string
  tagline: string
  features: string[]
}

const PLANS: PlanDef[] = [
  {
    id: 'free',
    name: 'Free',
    price: '$0',
    period: '',
    tagline: 'Try it — no credit card needed',
    features: [
      '20 voice syntheses per month',
      '10 script translations per month',
      '1 voice profile',
      '1 project',
      'Up to 500 words per script',
      'WAV export',
      '16 languages',
    ],
  },
  {
    id: 'starter',
    name: 'Starter',
    price: '$9',
    period: '/month',
    tagline: 'For individuals getting started',
    features: [
      '150 voice syntheses per month',
      '50 script translations per month',
      '3 voice profiles',
      '10 projects',
      'Up to 5,000 words per script',
      'WAV export',
      'Multi-voice scripts',
      'Timeline assembly',
      '16 languages',
    ],
  },
  {
    id: 'creator',
    name: 'Creator',
    price: '$29',
    period: '/month',
    tagline: 'For creators and podcasters',
    features: [
      '600 voice syntheses per month',
      '200 script translations per month',
      '10 voice profiles',
      'Unlimited projects',
      'No word limit per script',
      'WAV export',
      'Multi-voice scripts',
      'Timeline assembly',
      '16 languages',
      'Priority synthesis queue',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$79',
    period: '/month',
    tagline: 'For power users and studios',
    features: [
      '2,000 voice syntheses per month',
      'Unlimited script translations',
      '25 voice profiles',
      'Unlimited projects',
      'No word limit per script',
      'WAV export',
      'Multi-voice scripts',
      'Timeline assembly',
      '16 languages',
      'Priority synthesis queue',
      'Data export (GDPR)',
    ],
  },
]

const CHECK = (
  <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M1.5 5.5l2.5 2.5 4.5-5" />
  </svg>
)

// ── PayPal loader ─────────────────────────────────────────────────
function usePayPalSdk() {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (!PAYPAL_CLIENT_ID) return
    if ((window as any).paypal) { setReady(true); return }
    const script = document.createElement('script')
    script.src = `https://www.paypal.com/sdk/js?client-id=${PAYPAL_CLIENT_ID}&vault=true&intent=subscription`
    script.async = true
    script.onload  = () => setReady(true)
    script.onerror = () => console.error('[PayPal] SDK failed to load')
    document.head.appendChild(script)
    return () => {
      try { document.head.removeChild(script) } catch { /* already removed */ }
    }
  }, [])
  return ready
}

// ── PayPal subscription button ────────────────────────────────────
function PayPalButton({ plan, onSuccess }: { plan: 'starter' | 'creator' | 'pro'; onSuccess: () => void }) {
  const containerId = `paypal-btn-${plan}`
  const rendered    = useRef(false)

  useEffect(() => {
    if (rendered.current) return
    const pp = (window as any).paypal
    if (!pp) return
    rendered.current = true

    pp.Buttons({
      style: { shape: 'rect', color: 'silver', layout: 'vertical', label: 'subscribe', height: 44 },
      createSubscription: (_data: unknown, actions: any) => {
        const planId = plan === 'starter' ? PAYPAL_PLAN_STARTER : plan === 'creator' ? PAYPAL_PLAN_CREATOR : PAYPAL_PLAN_PRO
        return actions.subscription.create({ plan_id: planId })
      },
      onApprove: async (data: { subscriptionID: string }) => {
        try {
          await api.post('/subscription/capture', { subscription_id: data.subscriptionID })
          toast.ok(`Subscribed to ${plan === 'starter' ? 'Starter' : 'Pro'} plan!`)
          onSuccess()
        } catch {
          toast.err('Subscription activation failed. Please contact support.')
        }
      },
      onError: () => { toast.err('PayPal encountered an error. Please try again.') },
    }).render(`#${containerId}`)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div id={containerId} style={{ minHeight: 44 }} />
}

// ═══════════════════════════════════════════════════════════════════
// PRICING PAGE
// ═══════════════════════════════════════════════════════════════════
export function PricingPage({ user, onBack, onSignUp, onSubscribed, onSignIn, onNavigate }: {
  user?: User | null
  onBack?: () => void
  onSignUp?: () => void
  onSubscribed?: () => void
  onSignIn?: () => void
  onNavigate?: (page: string) => void
}) {
  const ppReady = usePayPalSdk()
  const currentPlan: Plan = user?.plan_name ?? 'free'

  function handleFreeCta() {
    if (!user) onSignUp?.()
  }

  // Signed-out visitors get the full marketing nav/footer; signed-in users
  // get a lightweight bar with a Back button to return to the app.
  const showMarketingChrome = !user

  return (
    <div className="vox">
      <div className="vox-ambient"><div className="vox-ambient-3" /></div>

      {showMarketingChrome ? (
        <VoxNav onSignIn={onSignIn} onSignUp={onSignUp} onNavigate={onNavigate} />
      ) : (
        <nav className="vox-nav">
          {onBack && (
            <button className="vox-btn vox-btn--ghost" style={{ padding: '8px 16px', fontSize: 13.5 }} onClick={onBack}>
              ← Back
            </button>
          )}
          <button className="vox-brand" style={{ marginLeft: 8 }} onClick={onBack}>
            <LogoMark size={28} />
            <span className="vox-brand-name">Voxora</span>
            <span style={{ fontSize: 13, color: 'var(--vx-text-3)', marginLeft: 4 }}>/ Pricing</span>
          </button>
          <div style={{ flex: 1 }} />
        </nav>
      )}

      {/* Heading */}
      <section className="vox-hero" style={{ paddingTop: 80, paddingBottom: 24 }}>
        <span className="vox-eyebrow"><span className="vox-eyebrow-dot" /> Pricing</span>
        <h1 className="vox-h1" style={{ fontSize: 'clamp(36px, 5.5vw, 62px)' }}>
          Simple, transparent<br /><span className="vox-grad-text">pricing</span>
        </h1>
        <p className="vox-lead" style={{ marginTop: 20 }}>
          Start free. Upgrade when you need more. Cancel any time.
        </p>
      </section>

      {/* Plan cards */}
      <section className="vox-section" style={{ paddingTop: 32 }}>
        <div className="vox-wrap" style={{ maxWidth: 1200 }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 20,
            alignItems: 'stretch',
          }}>
            {PLANS.map(plan => {
              const isCurrent  = user ? currentPlan === plan.id : false
              const isFeatured = plan.id === 'creator'

              return (
                <div key={plan.id} className={`vox-price-card${isFeatured ? ' vox-price-card--featured' : ''}`} style={{ position: 'relative', display: 'flex', flexDirection: 'column' }}>
                  {isFeatured && (
                    <div style={{
                      position: 'absolute', top: -13, left: '50%', transform: 'translateX(-50%)',
                      background: 'linear-gradient(90deg, var(--vx-purple), var(--vx-coral))',
                      color: '#fff', fontSize: 10, fontWeight: 700,
                      padding: '4px 14px', borderRadius: 99, letterSpacing: '0.8px', whiteSpace: 'nowrap',
                    }}>
                      
                    </div>
                  )}
                  {isCurrent && (
                    <div style={{
                      position: 'absolute', top: 14, right: 14,
                      background: 'var(--vx-surface-3)', border: '1px solid var(--vx-border-2)',
                      color: 'var(--vx-text-2)', fontSize: 10, fontWeight: 700,
                      padding: '3px 9px', borderRadius: 99, letterSpacing: '0.4px',
                    }}>
                      CURRENT
                    </div>
                  )}

                  <div>
                    <div className="vox-price-name">{plan.name}</div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginTop: 8 }}>
                      <span className="vox-price-amount vox-grad-text">{plan.price}</span>
                      {plan.period && <span className="vox-price-period">{plan.period}</span>}
                    </div>
                    <div className="vox-price-desc" style={{ marginTop: 8 }}>{plan.tagline}</div>
                  </div>

                  <ul className="vox-price-feats">
                    {plan.features.map(f => (
                      <li key={f} className="vox-price-feat">
                        <span className="vox-price-check">{CHECK}</span>
                        {f}
                      </li>
                    ))}
                  </ul>

                  <div style={{ marginTop: 'auto' }}>
                    {plan.id === 'free' ? (
                      isCurrent ? (
                        <button className="vox-btn vox-btn--ghost" style={{ width: '100%', opacity: 0.6 }} disabled>
                          ✓ Current Plan
                        </button>
                      ) : (
                        <button className="vox-btn vox-btn--ghost" style={{ width: '100%' }} onClick={handleFreeCta}>
                          Get Started Free
                        </button>
                      )
                    ) : isCurrent ? (
                      <button className="vox-btn vox-btn--ghost" style={{ width: '100%', opacity: 0.6 }} disabled>
                        ✓ Current Plan
                      </button>
                    ) : !user ? (
                      <button
                        className={`vox-btn ${isFeatured ? 'vox-btn--primary' : 'vox-btn--ghost'}`}
                        style={{ width: '100%' }}
                        onClick={onSignUp}
                      >
                        Sign up &amp; Subscribe
                      </button>
                    ) : ppReady ? (
                      <PayPalButton plan={plan.id as 'starter' | 'creator' | 'pro'} onSuccess={() => onSubscribed?.()} />
                    ) : (
                      <div style={{
                        height: 44, background: 'var(--vx-surface-2)', borderRadius: 10,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 12, color: 'var(--vx-text-3)', gap: 6,
                      }}>
                        <span className="spinner" style={{ width: 14, height: 14 }} />
                        Loading payment…
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Notes */}
          <div style={{ marginTop: 48, textAlign: 'center' }}>
            <p style={{ fontSize: 13, color: 'var(--vx-text-3)', lineHeight: 1.8, maxWidth: 560, margin: '0 auto' }}>
              All plans include a 7-day free trial period in guest mode.
              Subscriptions auto-renew monthly. Cancel any time from Settings.
              Payments processed securely by PayPal — credit and debit cards accepted.
            </p>
            {!PAYPAL_CLIENT_ID && (
              <div style={{
                maxWidth: 480, margin: '16px auto 0',
                background: 'rgba(255,107,74,0.1)', border: '1px solid rgba(255,107,74,0.3)',
                color: 'var(--vx-coral)', borderRadius: 12, padding: '10px 16px', fontSize: 13,
              }}>
                PayPal not configured. Set VITE_PAYPAL_CLIENT_ID in your .env file.
              </div>
            )}
          </div>
        </div>
      </section>

      {showMarketingChrome && <VoxFooter onSignIn={onSignIn} onSignUp={onSignUp} onNavigate={onNavigate} />}
    </div>
  )
}