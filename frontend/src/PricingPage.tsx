import { useEffect, useRef } from 'react'
import { api } from './api'
import { toast } from './toast'
import { LogoMark, VoxNav, VoxFooter } from './LandingPage'
import './landing.css'
import type { Plan, User } from './types'

const PAYPAL_CLIENT_ID    = import.meta.env.VITE_PAYPAL_CLIENT_ID    as string | undefined
const PAYPAL_PLAN_STARTER = import.meta.env.VITE_PAYPAL_PLAN_STARTER as string | undefined
const PAYPAL_PLAN_CREATOR = import.meta.env.VITE_PAYPAL_PLAN_CREATOR as string | undefined
const PAYPAL_PLAN_PRO     = import.meta.env.VITE_PAYPAL_PLAN_PRO     as string | undefined

interface Feature { text: string; sub?: boolean }
interface PlanDef {
  id: Plan; name: string; price: string; period: string
  tagline: string; featured?: boolean; features: Feature[]
}

const PLANS: PlanDef[] = [
  {
    id: 'free', name: 'Free', price: '$0', period: 'per month',
    tagline: 'No credit card needed',
    features: [
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
    id: 'starter', name: 'Starter', price: '$9', period: 'per month',
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
    id: 'creator', name: 'Creator', price: '$29', period: 'per month',
    tagline: 'For creators & podcasters', featured: true,
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
    id: 'pro', name: 'Pro', price: '$79', period: 'per month',
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

function usePayPalSdk() {
  useEffect(() => {
    if (!PAYPAL_CLIENT_ID || (window as any).paypal) return
    const s = document.createElement('script')
    s.src = `https://www.paypal.com/sdk/js?client-id=${PAYPAL_CLIENT_ID}&vault=true&intent=subscription`
    s.async = true
    document.head.appendChild(s)
  }, [])
}

function PayPalButton({ plan, onSuccess }: { plan: 'starter' | 'creator' | 'pro'; onSuccess: () => void }) {
  const id       = `paypal-btn-${plan}`
  const rendered = useRef(false)
  useEffect(() => {
    if (rendered.current) return
    const pp = (window as any).paypal
    if (!pp) return
    rendered.current = true
    pp.Buttons({
      style: { shape: 'pill', color: 'silver', layout: 'vertical', label: 'subscribe', height: 44 },
      createSubscription: (_: unknown, actions: any) => actions.subscription.create({
        plan_id: plan === 'starter' ? PAYPAL_PLAN_STARTER : plan === 'creator' ? PAYPAL_PLAN_CREATOR : PAYPAL_PLAN_PRO,
      }),
      onApprove: async (data: { subscriptionID: string }) => {
        try {
          await api.post('/subscription/capture', { subscription_id: data.subscriptionID })
          toast.ok(`Subscribed to ${plan === 'starter' ? 'Starter' : plan === 'creator' ? 'Creator' : 'Pro'} plan!`)
          onSuccess()
        } catch { toast.err('Subscription activation failed. Please contact support.') }
      },
      onError: () => toast.err('PayPal encountered an error. Please try again.'),
    }).render(`#${id}`)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return <div id={id} style={{ minHeight: 44 }} />
}

function FeatIcon({ sub }: { sub?: boolean }) {
  return sub ? (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0, marginTop: 2 }}>
      <path d="M2 7h8M7 4l3 3-3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" opacity="0.4" />
    </svg>
  ) : (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0, marginTop: 2 }}>
      <path d="M2 7l3.5 3.5 6.5-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function PricingPage({ user, onBack, onSignUp, onSubscribed, onSignIn, onNavigate }: {
  user?: User | null; onBack?: () => void; onSignUp?: () => void
  onSubscribed?: () => void; onSignIn?: () => void; onNavigate?: (page: string) => void
}) {
  usePayPalSdk()
  const currentPlan = user?.plan_name ?? 'free'

  return (
    <div className="vox">
      <style>{`
        .prc-scroll {
          width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch;
          padding-bottom: 10px; scrollbar-width: thin;
          scrollbar-color: rgba(139,92,246,0.3) transparent;
        }
        .prc-scroll::-webkit-scrollbar { height: 4px; }
        .prc-scroll::-webkit-scrollbar-track { background: transparent; }
        .prc-scroll::-webkit-scrollbar-thumb { background: rgba(139,92,246,0.3); border-radius: 99px; }

        .prc-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(230px, 1fr));
          gap: 14px;
          min-width: 968px;
          align-items: start;
        }

        .prc-card {
          background: var(--vx-surface-1);
          border: 1px solid rgba(139,92,246,0.28);
          border-radius: 18px; overflow: hidden;
          display: flex; flex-direction: column;
          transition: border-color 0.2s, box-shadow 0.2s;
          box-shadow: 0 2px 20px rgba(139,92,246,0.06);
        }
        .prc-card:hover {
          border-color: rgba(139,92,246,0.5);
          box-shadow: 0 4px 32px rgba(139,92,246,0.12);
        }
        .prc-card--featured {
          border-color: rgba(139,92,246,0.55);
          box-shadow: 0 0 0 1px rgba(139,92,246,0.2), 0 6px 36px rgba(139,92,246,0.14);
        }
        .prc-card--featured:hover {
          border-color: rgba(139,92,246,0.8);
          box-shadow: 0 0 0 1px rgba(139,92,246,0.35), 0 10px 48px rgba(139,92,246,0.2);
        }

        .prc-hero { padding: 20px 20px 0; }
        .prc-accent { height: 3px; border-radius: 99px; margin-bottom: 18px; }
        .prc-badges { display: flex; align-items: center; gap: 7px; margin-bottom: 10px; flex-wrap: wrap; }
        .prc-name { font-size: 20px; font-weight: 700; color: var(--vx-text-1); letter-spacing: -0.3px; }
        .prc-badge-pop {
          font-size: 10px; font-weight: 700; letter-spacing: 0.4px;
          padding: 3px 10px; border-radius: 99px;
          border: 1px solid rgba(139,92,246,0.4); background: rgba(139,92,246,0.12); color: #c4b5fd;
        }
        .prc-badge-cur {
          font-size: 10px; font-weight: 700; letter-spacing: 0.4px;
          padding: 3px 9px; border-radius: 99px;
          background: var(--vx-surface-3); border: 1px solid var(--vx-border-2); color: var(--vx-text-3);
        }
        .prc-price-row { display: flex; align-items: baseline; gap: 5px; line-height: 1; }
        .prc-price { font-size: 32px; font-weight: 800; letter-spacing: -1.5px; }
        .prc-period { font-size: 13px; color: var(--vx-text-3); }
        .prc-tagline { font-size: 12px; color: var(--vx-text-3); margin-top: 5px; }

        .prc-cta { padding: 16px 16px 0; }
        .prc-btn {
          width: 100%; padding: 12px 16px; border-radius: 999px;
          font-size: 14px; font-weight: 600; cursor: pointer; border: none;
          transition: opacity 0.15s, transform 0.12s;
        }
        .prc-btn:hover:not(:disabled) { opacity: 0.86; transform: translateY(-1px); }
        .prc-btn:disabled { opacity: 0.4; cursor: default; transform: none; }
        .prc-btn--solid   { background: var(--vx-text-1); color: var(--vx-bg); }
        .prc-btn--grad    { background: linear-gradient(90deg, var(--vx-purple), var(--vx-coral)); color: #fff; }
        .prc-btn--outline { background: transparent; border: 1px solid var(--vx-border-2) !important; color: var(--vx-text-2); }
        .prc-btn--dim     { background: var(--vx-surface-2); color: var(--vx-text-3); }

        .prc-divider { height: 1px; background: var(--vx-border-1); margin: 16px 0 0; }

        .prc-feats { list-style: none; margin: 0; padding: 12px 20px 20px; display: flex; flex-direction: column; }
        .prc-feat {
          display: flex; align-items: flex-start; gap: 9px;
          padding: 9px 0; font-size: 13px; color: var(--vx-text-2);
          border-bottom: 1px dashed var(--vx-border-1); line-height: 1.4;
        }
        .prc-feat:last-child { border-bottom: none; }
        .prc-feat--sub { color: var(--vx-text-3); font-size: 12px; font-style: italic; }
        .prc-feat-icon { color: var(--vx-purple); }
        .prc-feat-icon--sub { color: var(--vx-text-3); }
      `}</style>

      <div className="vox-ambient"><div className="vox-ambient-3" /></div>

      {!user ? (
        <VoxNav onSignIn={onSignIn} onSignUp={onSignUp} onNavigate={onNavigate} />
      ) : (
        <nav className="vox-nav">
          {onBack && (
            <button className="vox-btn vox-btn--ghost" style={{ padding: '8px 16px', fontSize: 13.5 }} onClick={onBack}>← Back</button>
          )}
          <button className="vox-brand" style={{ marginLeft: 8 }} onClick={onBack}>
            <LogoMark size={28} />
            <span className="vox-brand-name">Voxora</span>
            <span style={{ fontSize: 13, color: 'var(--vx-text-3)', marginLeft: 4 }}>/ Pricing</span>
          </button>
          <div style={{ flex: 1 }} />
        </nav>
      )}

      <section className="vox-hero" style={{ paddingTop: 80, paddingBottom: 32 }}>
        <span className="vox-eyebrow"><span className="vox-eyebrow-dot" /> Pricing</span>
        <h1 className="vox-h1" style={{ fontSize: 'clamp(32px, 5vw, 58px)' }}>
          Simple, transparent<br /><span className="vox-grad-text">pricing</span>
        </h1>
        <p className="vox-lead" style={{ marginTop: 16 }}>
          Start free. Upgrade when you need more. Cancel any time.
        </p>
      </section>

      <section className="vox-section" style={{ paddingTop: 0, paddingBottom: 72 }}>
        <div className="vox-wrap" style={{ maxWidth: 1080 }}>
          <div className="prc-scroll">
            <div className="prc-grid">
              {PLANS.map(plan => {
                const isCurrent  = user ? currentPlan === plan.id : false
                const isFeatured = plan.featured ?? false
                const accent     = isFeatured
                  ? 'linear-gradient(90deg, var(--vx-purple), var(--vx-coral))'
                  : 'linear-gradient(90deg, rgba(139,92,246,0.4), rgba(139,92,246,0.08))'

                return (
                  <div key={plan.id} className={`prc-card${isFeatured ? ' prc-card--featured' : ''}`}>

                    <div className="prc-hero">
                      <div className="prc-accent" style={{ background: accent }} />
                      <div className="prc-badges">
                        <span className="prc-name">{plan.name}</span>
                        {isFeatured && <span className="prc-badge-pop">Popular</span>}
                        {isCurrent  && <span className="prc-badge-cur">✓ Current</span>}
                      </div>
                      <div className="prc-price-row">
                        <span className={`prc-price${isFeatured ? ' vox-grad-text' : ''}`}>{plan.price}</span>
                        {plan.period && <span className="prc-period">{plan.period}</span>}
                      </div>
                      <div className="prc-tagline">{plan.tagline}</div>
                    </div>

                    <div className="prc-cta">
                      {isCurrent ? (
                        <button className="prc-btn prc-btn--dim" disabled>✓ Current Plan</button>
                      ) : !user ? (
                        <button
                          className={`prc-btn ${isFeatured ? 'prc-btn--grad' : plan.id === 'free' ? 'prc-btn--solid' : 'prc-btn--outline'}`}
                          onClick={onSignUp}
                        >
                          {plan.id === 'free' ? 'Get started free' : `Choose ${plan.name}`}
                        </button>
                      ) : plan.id === 'free' ? (
                        <button className="prc-btn prc-btn--outline" disabled>Free plan</button>
                      ) : (
                        <PayPalButton plan={plan.id as 'starter' | 'creator' | 'pro'} onSuccess={() => onSubscribed?.()} />
                      )}
                    </div>

                    <div className="prc-divider" />

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
          </div>

          <p style={{ fontSize: 12.5, color: 'var(--vx-text-3)', textAlign: 'center', marginTop: 28, lineHeight: 1.8 }}>
            All plans include a 7-day free trial in guest mode. Subscriptions auto-renew monthly — cancel any time from Settings. Payments processed securely by PayPal.
          </p>

          <p style={{ fontSize: 12.5, color: 'var(--vx-text-3)', textAlign: 'center', marginTop: 6, lineHeight: 1.8 }}>
            Need full data residency or your own domain? Voxora is self-hostable and white-label ready — <button onClick={() => onNavigate?.('landing')} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--vx-accent, #6c5ce7)', textDecoration: 'underline', cursor: 'pointer', fontSize: 'inherit' }}>learn more</button>.
          </p>

          {!PAYPAL_CLIENT_ID && (
            <div style={{
              maxWidth: 440, margin: '14px auto 0',
              background: 'rgba(255,107,74,0.08)', border: '1px solid rgba(255,107,74,0.3)',
              color: 'var(--vx-coral)', borderRadius: 12, padding: '10px 16px',
              fontSize: 12.5, textAlign: 'center',
            }}>
              PayPal not configured — set VITE_PAYPAL_CLIENT_ID in .env
            </div>
          )}
        </div>
      </section>

      {!user && <VoxFooter onSignIn={onSignIn} onSignUp={onSignUp} onNavigate={onNavigate} />}
    </div>
  )
}