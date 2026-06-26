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
interface Feature {
  text: string
  sub?: boolean   // "Everything in X, plus" line
}

interface PlanDef {
  id: Plan
  name: string
  price: string
  period: string
  tagline: string
  featured?: boolean
  heroGradient?: string   // CSS gradient for the hero card (free only)
  features: Feature[]
}

const PLANS: PlanDef[] = [
  {
    id: 'free',
    name: 'Free',
    price: '$0',
    period: 'per month',
    tagline: 'No credit card needed',
    heroGradient: 'linear-gradient(135deg, #1a1a6e 0%, #6b3fa0 45%, #c0604a 100%)',
    features: [
      { text: 'Voice synthesis' },
      { text: '20 syntheses / month' },
      { text: '1 voice profile' },
      { text: '1 project' },
      { text: 'Up to 500 words / script' },
      { text: '10 translations / month' },
      { text: 'WAV export' },
      { text: '16 languages' },
    ],
  },
  {
    id: 'starter',
    name: 'Starter',
    price: '$9',
    period: 'per month',
    tagline: 'For individuals getting started',
    features: [
      { text: 'Everything in Free, plus', sub: true },
      { text: '150 syntheses / month' },
      { text: '3 voice profiles' },
      { text: '10 projects' },
      { text: 'Up to 5,000 words / script' },
      { text: '50 translations / month' },
      { text: 'Multi-voice scripts' },
      { text: 'Timeline assembly' },
    ],
  },
  {
    id: 'creator',
    name: 'Creator',
    price: '$29',
    period: 'per month',
    tagline: 'For creators & podcasters',
    featured: true,
    features: [
      { text: 'Everything in Starter, plus', sub: true },
      { text: '600 syntheses / month' },
      { text: '10 voice profiles' },
      { text: 'Unlimited projects' },
      { text: 'No word limit per script' },
      { text: '200 translations / month' },
      { text: 'Priority synthesis queue' },
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$79',
    period: 'per month',
    tagline: 'For power users & studios',
    features: [
      { text: 'Everything in Creator, plus', sub: true },
      { text: '2,000 syntheses / month' },
      { text: '25 voice profiles' },
      { text: 'Unlimited translations' },
      { text: 'Data export (GDPR)' },
    ],
  },
]

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
    return () => { try { document.head.removeChild(script) } catch { /* ok */ } }
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
        const planId = plan === 'starter' ? PAYPAL_PLAN_STARTER
                     : plan === 'creator' ? PAYPAL_PLAN_CREATOR
                     : PAYPAL_PLAN_PRO
        return actions.subscription.create({ plan_id: planId })
      },
      onApprove: async (data: { subscriptionID: string }) => {
        try {
          await api.post('/subscription/capture', { subscription_id: data.subscriptionID })
          const label = plan === 'starter' ? 'Starter' : plan === 'creator' ? 'Creator' : 'Pro'
          toast.ok(`Subscribed to ${label} plan!`)
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

// ── Feature icon ──────────────────────────────────────────────────
function FeatIcon({ sub }: { sub?: boolean }) {
  if (sub) return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" style={{ flexShrink: 0, marginTop: 1 }}>
      <path d="M3 7.5h7M7.5 4l3.5 3.5L7.5 11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" opacity="0.5" />
    </svg>
  )
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" style={{ flexShrink: 0, marginTop: 1 }}>
      <path d="M2.5 7.5l3.5 3.5 6.5-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
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
  const ppReady     = usePayPalSdk()
  const currentPlan = user?.plan_name ?? 'free'
  const showChrome  = !user

  return (
    <div className="vox">
      <style>{`
        /* ── Pricing cards grid ─────────────────────────── */
        .prc-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 14px;
          align-items: start;
        }
        @media (max-width: 900px) {
          .prc-grid { grid-template-columns: repeat(2, 1fr); }
        }
        @media (max-width: 520px) {
          .prc-grid { grid-template-columns: 1fr; }
        }

        /* ── Card ───────────────────────────────────────── */
        .prc-card {
          background: var(--vx-surface-1);
          border: 1px solid var(--vx-border-1);
          border-radius: 18px;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          transition: border-color 0.2s, box-shadow 0.2s;
        }
        .prc-card:hover {
          border-color: var(--vx-border-2);
        }
        .prc-card--featured {
          border-color: rgba(139,92,246,0.45);
          box-shadow: 0 0 0 1px rgba(139,92,246,0.25), 0 8px 40px rgba(139,92,246,0.12);
        }
        .prc-card--featured:hover {
          border-color: rgba(139,92,246,0.7);
          box-shadow: 0 0 0 1px rgba(139,92,246,0.4), 0 12px 48px rgba(139,92,246,0.18);
        }

        /* ── Hero block (top of card) ────────────────────── */
        .prc-hero {
          padding: 20px 20px 16px;
          position: relative;
        }
        .prc-hero--gradient {
          min-height: 140px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          padding: 18px 20px;
          border-radius: 14px;
          margin: 10px 10px 0;
          background-size: cover;
          background-position: center;
        }
        .prc-hero--flat {
          padding: 20px 20px 0;
        }

        /* ── Badge ──────────────────────────────────────── */
        .prc-badge {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.5px;
          padding: 4px 10px;
          border-radius: 99px;
          border: 1px solid rgba(255,255,255,0.2);
          color: rgba(255,255,255,0.9);
          background: rgba(255,255,255,0.12);
          backdrop-filter: blur(4px);
          width: fit-content;
        }
        .prc-badge--popular {
          border-color: rgba(139,92,246,0.5);
          background: rgba(139,92,246,0.15);
          color: #c4b5fd;
        }

        /* ── Plan name on gradient hero ─────────────────── */
        .prc-name-on-grad {
          font-size: 22px;
          font-weight: 700;
          color: #fff;
          letter-spacing: -0.3px;
        }
        .prc-price-on-grad {
          font-size: 15px;
          color: rgba(255,255,255,0.85);
          font-weight: 500;
        }
        .prc-price-on-grad strong {
          font-size: 20px;
          font-weight: 800;
        }

        /* ── Plan name on flat hero ──────────────────────── */
        .prc-name-flat {
          font-size: 20px;
          font-weight: 700;
          color: var(--vx-text-1);
          letter-spacing: -0.3px;
          margin-bottom: 10px;
        }
        .prc-price-flat {
          display: flex;
          align-items: baseline;
          gap: 5px;
        }
        .prc-price-amount {
          font-size: 30px;
          font-weight: 800;
          letter-spacing: -1.5px;
          line-height: 1;
        }
        .prc-price-period {
          font-size: 13px;
          color: var(--vx-text-3);
          font-weight: 400;
        }
        .prc-tagline {
          font-size: 12px;
          color: var(--vx-text-3);
          margin-top: 6px;
        }

        /* ── CTA button ──────────────────────────────────── */
        .prc-cta-wrap {
          padding: 16px 16px 0;
        }
        .prc-btn {
          width: 100%;
          padding: 12px 16px;
          border-radius: 999px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          border: none;
          letter-spacing: 0.1px;
          transition: opacity 0.15s, transform 0.12s;
          display: block;
          text-align: center;
        }
        .prc-btn:hover:not(:disabled) {
          opacity: 0.88;
          transform: translateY(-1px);
        }
        .prc-btn:disabled {
          opacity: 0.45;
          cursor: default;
          transform: none;
        }
        .prc-btn--dark {
          background: var(--vx-text-1);
          color: var(--vx-bg);
        }
        .prc-btn--primary {
          background: linear-gradient(90deg, var(--vx-purple), var(--vx-coral));
          color: #fff;
        }
        .prc-btn--outline {
          background: transparent;
          border: 1px solid var(--vx-border-2) !important;
          color: var(--vx-text-2);
        }
        .prc-btn--current {
          background: var(--vx-surface-2);
          color: var(--vx-text-3);
        }

        /* ── Divider ─────────────────────────────────────── */
        .prc-divider {
          height: 1px;
          background: var(--vx-border-1);
          margin: 16px 0 0;
        }

        /* ── Feature list ────────────────────────────────── */
        .prc-feats {
          list-style: none;
          margin: 0;
          padding: 14px 20px 20px;
          display: flex;
          flex-direction: column;
          gap: 0;
        }
        .prc-feat {
          display: flex;
          align-items: flex-start;
          gap: 9px;
          padding: 9px 0;
          font-size: 13px;
          color: var(--vx-text-2);
          border-bottom: 1px dashed var(--vx-border-1);
          line-height: 1.4;
        }
        .prc-feat:last-child {
          border-bottom: none;
        }
        .prc-feat--sub {
          color: var(--vx-text-3);
          font-size: 12px;
          font-style: italic;
        }
        .prc-feat-icon {
          color: var(--vx-purple);
          margin-top: 1px;
        }
        .prc-feat-icon--sub {
          color: var(--vx-text-3);
        }

        /* ── Current badge ───────────────────────────────── */
        .prc-current-chip {
          display: inline-block;
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 0.6px;
          text-transform: uppercase;
          padding: 2px 8px;
          border-radius: 99px;
          background: var(--vx-surface-3);
          border: 1px solid var(--vx-border-2);
          color: var(--vx-text-3);
          margin-left: 8px;
          vertical-align: middle;
        }
      `}</style>

      <div className="vox-ambient"><div className="vox-ambient-3" /></div>

      {/* Nav */}
      {showChrome ? (
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
      <section className="vox-hero" style={{ paddingTop: 80, paddingBottom: 32 }}>
        <span className="vox-eyebrow"><span className="vox-eyebrow-dot" /> Pricing</span>
        <h1 className="vox-h1" style={{ fontSize: 'clamp(32px, 5vw, 58px)' }}>
          Simple, transparent<br /><span className="vox-grad-text">pricing</span>
        </h1>
        <p className="vox-lead" style={{ marginTop: 16 }}>
          Start free. Upgrade when you need more. Cancel any time.
        </p>
      </section>

      {/* Cards */}
      <section className="vox-section" style={{ paddingTop: 0, paddingBottom: 72 }}>
        <div className="vox-wrap" style={{ maxWidth: 1080 }}>
          <div className="prc-grid">
            {PLANS.map(plan => {
              const isCurrent  = user ? currentPlan === plan.id : false
              const isFeatured = plan.featured ?? false
              const isFree     = plan.id === 'free'

              return (
                <div
                  key={plan.id}
                  className={`prc-card${isFeatured ? ' prc-card--featured' : ''}`}
                >
                  {/* ── Hero ── */}
                  {isFree ? (
                    /* Gradient hero for Free */
                    <div className="prc-hero--gradient" style={{ background: plan.heroGradient }}>
                      <div
                        className="prc-badge"
                        style={{ backdropFilter: 'blur(6px)' }}
                      >
                        {plan.name}
                        {isCurrent && <span style={{ opacity: 0.7 }}>✓</span>}
                      </div>
                      <div>
                        <div className="prc-price-on-grad">
                          <strong>{plan.price}</strong> {plan.period}
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* Flat hero for paid plans */
                    <div className="prc-hero--flat">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                        <span className="prc-name-flat" style={{ margin: 0 }}>{plan.name}</span>
                        {isFeatured && (
                          <span className="prc-badge prc-badge--popular">Popular</span>
                        )}
                        {isCurrent && (
                          <span className="prc-current-chip">✓ Current</span>
                        )}
                      </div>
                      <div className="prc-price-flat">
                        <span className={`prc-price-amount${isFeatured ? ' vox-grad-text' : ''}`}>
                          {plan.price}
                        </span>
                        <span className="prc-price-period">{plan.period}</span>
                      </div>
                      <div className="prc-tagline">{plan.tagline}</div>
                    </div>
                  )}

                  {/* ── CTA ── */}
                  <div className="prc-cta-wrap">
                    {isFree ? (
                      isCurrent ? (
                        <button className="prc-btn prc-btn--current" disabled>✓ Current Plan</button>
                      ) : (
                        <button className="prc-btn prc-btn--dark" onClick={() => !user && onSignUp?.()}>
                          Build for free
                        </button>
                      )
                    ) : isCurrent ? (
                      <button className="prc-btn prc-btn--current" disabled>✓ Current Plan</button>
                    ) : !user ? (
                      <button
                        className={`prc-btn ${isFeatured ? 'prc-btn--primary' : 'prc-btn--dark'}`}
                        onClick={onSignUp}
                      >
                        Choose {plan.name}
                      </button>
                    ) : ppReady ? (
                      <PayPalButton
                        plan={plan.id as 'starter' | 'creator' | 'pro'}
                        onSuccess={() => onSubscribed?.()}
                      />
                    ) : (
                      <div style={{
                        height: 44, background: 'var(--vx-surface-2)', borderRadius: 999,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 12, color: 'var(--vx-text-3)', gap: 6,
                      }}>
                        <span className="spinner" style={{ width: 13, height: 13 }} />
                        Loading payment…
                      </div>
                    )}
                  </div>

                  {/* ── Divider ── */}
                  <div className="prc-divider" />

                  {/* ── Features ── */}
                  <ul className="prc-feats">
                    {plan.features.map((feat, fi) => (
                      <li key={fi} className={`prc-feat${feat.sub ? ' prc-feat--sub' : ''}`}>
                        <span className={`prc-feat-icon${feat.sub ? ' prc-feat-icon--sub' : ''}`}>
                          <FeatIcon sub={feat.sub} />
                        </span>
                        {feat.text}
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </div>

          {/* Footer note */}
          <p style={{
            fontSize: 12.5, color: 'var(--vx-text-3)', textAlign: 'center',
            marginTop: 32, lineHeight: 1.8,
          }}>
            All plans include a 7-day free trial in guest mode.
            Subscriptions auto-renew monthly — cancel any time from Settings.
            Payments processed securely by PayPal.
          </p>

          {!PAYPAL_CLIENT_ID && (
            <div style={{
              maxWidth: 440, margin: '14px auto 0',
              background: 'rgba(255,107,74,0.1)', border: '1px solid rgba(255,107,74,0.3)',
              color: 'var(--vx-coral)', borderRadius: 12, padding: '10px 16px',
              fontSize: 12.5, textAlign: 'center',
            }}>
              PayPal not configured — set VITE_PAYPAL_CLIENT_ID in .env
            </div>
          )}
        </div>
      </section>

      {showChrome && <VoxFooter onSignIn={onSignIn} onSignUp={onSignUp} onNavigate={onNavigate} />}
    </div>
  )
}