import { useState, useEffect, useRef } from 'react'
import { api } from './api'
import { toast } from './toast'
import { icons } from './constants'
import { LogoMark } from './LandingPage'
import type { Plan, User } from './types'

const PAYPAL_CLIENT_ID   = import.meta.env.VITE_PAYPAL_CLIENT_ID   as string | undefined
const PAYPAL_PLAN_STARTER = import.meta.env.VITE_PAYPAL_PLAN_STARTER as string | undefined
const PAYPAL_PLAN_PRO     = import.meta.env.VITE_PAYPAL_PLAN_PRO     as string | undefined

// ── Plan definitions ───────────────────────────────────────────────
interface PlanDef {
  id: Plan
  name: string
  price: string
  period: string
  tagline: string
  color: string
  features: string[]
  limits: string[]
}

const PLANS: PlanDef[] = [
  {
    id: 'free',
    name: 'Free',
    price: '$0',
    period: '',
    tagline: 'Get started without a credit card',
    color: 'var(--text-3)',
    features: [
      '3 voice syntheses per day',
      '1 voice profile',
      '1 project',
      'Up to 500 words per script',
      'WAV export',
    ],
    limits: [],
  },
  {
    id: 'starter',
    name: 'Starter',
    price: '$4.99',
    period: '/month',
    tagline: 'For creators and podcasters',
    color: 'var(--accent)',
    features: [
      '100 syntheses per month',
      '5 voice profiles',
      '10 projects',
      'Up to 5,000 words per script',
      'WAV + MP3 export',
      'Multi-voice scripts',
      'Timeline assembly',
    ],
    limits: [],
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$14.99',
    period: '/month',
    tagline: 'Unlimited for power users',
    color: '#4278c9',
    features: [
      'Unlimited syntheses',
      'Unlimited voice profiles',
      'Unlimited projects',
      'No word limit per script',
      'WAV + MP3 export',
      'Multi-voice scripts',
      'Timeline assembly',
      'Priority synthesis queue',
      'Data export (GDPR)',
    ],
    limits: [],
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
    return () => {
      try { document.head.removeChild(script) } catch { /* already removed */ }
    }
  }, [])

  return ready
}

// ── PayPal subscription button ────────────────────────────────────
function PayPalButton({ plan, onSuccess }: { plan: 'starter' | 'pro'; onSuccess: () => void }) {
  const containerId = `paypal-btn-${plan}`
  const rendered    = useRef(false)

  useEffect(() => {
    if (rendered.current) return
    const pp = (window as any).paypal
    if (!pp) return
    rendered.current = true

    pp.Buttons({
      style: {
        shape: 'rect', color: 'blue', layout: 'vertical',
        label: 'subscribe', height: 40,
      },
      createSubscription: (_data: unknown, actions: any) => {
        const planId = plan === 'starter' ? PAYPAL_PLAN_STARTER : PAYPAL_PLAN_PRO
        return actions.subscription.create({ plan_id: planId })
      },
      onApprove: async (data: { subscriptionID: string }) => {
        try {
          await api.post('/subscription/capture', { subscription_id: data.subscriptionID })
          toast.ok(`Subscribed to ${plan === 'starter' ? 'Starter' : 'Pro'} plan!`)
          onSuccess()
        } catch (e) {
          toast.err('Subscription activation failed. Please contact support.')
        }
      },
      onError: () => {
        toast.err('PayPal encountered an error. Please try again.')
      },
    }).render(`#${containerId}`)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div id={containerId} style={{ minHeight: 44 }} />
}

// ── Feature list ──────────────────────────────────────────────────
function FeatureList({ features }: { features: string[] }) {
  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {features.map(f => (
        <li key={f} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: 'var(--text-2)' }}>
          <span style={{ color: 'var(--ok)', width: 14, height: 14, flexShrink: 0 }}>{icons.check}</span>
          {f}
        </li>
      ))}
    </ul>
  )
}

// ═══════════════════════════════════════════════════════════════════
// PRICING PAGE
// ═══════════════════════════════════════════════════════════════════
export function PricingPage({ user, onBack, onSignUp, onSubscribed }: {
  user?: User | null
  onBack?: () => void
  onSignUp?: () => void
  onSubscribed?: () => void
}) {
  const ppReady = usePayPalSdk()
  const currentPlan: Plan = user?.plan_name ?? 'free'

  function handleFreeCta() {
    if (!user) onSignUp?.()
  }

  return (
    <div style={{ minHeight: '100svh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>
      {/* Topbar */}
      <div style={{
        borderBottom: '1px solid var(--border)', padding: '0 24px', height: 56,
        display: 'flex', alignItems: 'center', gap: 12, background: 'var(--surface)',
        position: 'sticky', top: 0, zIndex: 100,
      }}>
        {onBack && (
          <button className="btn btn--ghost btn--sm" onClick={onBack} style={{ gap: 5 }}>
            {icons.back} Back
          </button>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <LogoMark size={22} />
          <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-1)' }}>VoiceStudio</span>
          <span style={{ fontSize: 13, color: 'var(--text-3)' }}>/ Pricing</span>
        </div>
      </div>

      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '56px 24px 80px', width: '100%' }}>
        {/* Heading */}
        <div style={{ textAlign: 'center', marginBottom: 56 }}>
          <h1 style={{
            fontFamily: 'var(--serif)', fontSize: 42, fontWeight: 400,
            color: 'var(--text-1)', letterSpacing: '-1px', marginBottom: 12,
          }}>
            Simple, transparent pricing
          </h1>
          <p style={{ fontSize: 16, color: 'var(--text-2)', maxWidth: 480, margin: '0 auto' }}>
            Start free. Upgrade when you need more. Cancel any time.
          </p>
        </div>

        {/* Plan cards */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 20,
          alignItems: 'start',
        }}>
          {PLANS.map(plan => {
            const isCurrent = currentPlan === plan.id
            const isPro     = plan.id === 'pro'

            return (
              <div key={plan.id} style={{
                border: `2px solid ${isPro ? '#4278c9' : isCurrent ? 'var(--accent)' : 'var(--border-2)'}`,
                borderRadius: 'var(--radius-lg)',
                padding: '28px 24px 24px',
                background: isPro ? 'rgba(66,120,201,0.04)' : isCurrent ? 'var(--accent-lt)' : 'var(--surface)',
                position: 'relative',
                display: 'flex', flexDirection: 'column', gap: 20,
              }}>
                {/* Popular badge */}
                {isPro && (
                  <div style={{
                    position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)',
                    background: '#4278c9', color: '#fff', fontSize: 11, fontWeight: 700,
                    padding: '3px 12px', borderRadius: 99, letterSpacing: '0.5px',
                  }}>
                    MOST POPULAR
                  </div>
                )}

                {/* Current plan badge */}
                {isCurrent && (
                  <div style={{
                    position: 'absolute', top: 14, right: 14,
                    background: 'var(--accent)', color: '#fff', fontSize: 10, fontWeight: 700,
                    padding: '2px 8px', borderRadius: 99, letterSpacing: '0.4px',
                  }}>
                    CURRENT
                  </div>
                )}

                {/* Plan header */}
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: plan.color, textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 6 }}>
                    {plan.name}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 3, marginBottom: 6 }}>
                    <span style={{ fontSize: 36, fontWeight: 700, color: 'var(--text-1)', letterSpacing: '-1px' }}>
                      {plan.price}
                    </span>
                    {plan.period && (
                      <span style={{ fontSize: 14, color: 'var(--text-3)' }}>{plan.period}</span>
                    )}
                  </div>
                  <p style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.5 }}>{plan.tagline}</p>
                </div>

                {/* Feature list */}
                <FeatureList features={plan.features} />

                {/* CTA */}
                <div style={{ marginTop: 4 }}>
                  {plan.id === 'free' ? (
                    isCurrent ? (
                      <button className="btn" style={{ width: '100%', justifyContent: 'center', opacity: 0.6 }} disabled>
                        {icons.check} Current Plan
                      </button>
                    ) : (
                      <button className="btn" style={{ width: '100%', justifyContent: 'center' }} onClick={handleFreeCta}>
                        Get Started Free
                      </button>
                    )
                  ) : isCurrent ? (
                    <button className="btn" style={{ width: '100%', justifyContent: 'center', opacity: 0.6 }} disabled>
                      {icons.check} Current Plan
                    </button>
                  ) : !user ? (
                    <button
                      className={`btn ${isPro ? '' : 'btn--primary'}`}
                      style={{
                        width: '100%', justifyContent: 'center',
                        ...(isPro ? { background: '#4278c9', color: '#fff' } : {}),
                      }}
                      onClick={onSignUp}
                    >
                      Sign up & Subscribe
                    </button>
                  ) : ppReady ? (
                    <PayPalButton
                      plan={plan.id as 'starter' | 'pro'}
                      onSuccess={() => onSubscribed?.()}
                    />
                  ) : (
                    <div style={{
                      height: 44, background: 'var(--bg-2)', borderRadius: 6,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 12, color: 'var(--text-3)', gap: 6,
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

        {/* FAQ / notes */}
        <div style={{ marginTop: 56, textAlign: 'center' }}>
          <p style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.8 }}>
            All plans include a 7-day free trial period in guest mode.
            Subscriptions auto-renew monthly. Cancel any time from Settings.
            Payments processed securely by PayPal — credit and debit cards accepted.
          </p>
          {!PAYPAL_CLIENT_ID && (
            <div className="msg msg--warn" style={{ marginTop: 16, maxWidth: 480, margin: '16px auto 0' }}>
              PayPal not configured. Set VITE_PAYPAL_CLIENT_ID in your .env file.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
