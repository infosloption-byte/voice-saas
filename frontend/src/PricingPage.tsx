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

// ── Plan column definitions ───────────────────────────────────────
interface PlanCol {
  id: Plan
  name: string
  price: string
  period: string
  tagline: string
  featured?: boolean
}

const PLAN_COLS: PlanCol[] = [
  { id: 'free',    name: 'Free',    price: '$0',  period: '',       tagline: 'Try it free'              },
  { id: 'starter', name: 'Starter', price: '$9',  period: '/month', tagline: 'For individuals'          },
  { id: 'creator', name: 'Creator', price: '$29', period: '/month', tagline: 'For creators & podcasters', featured: true },
  { id: 'pro',     name: 'Pro',     price: '$79', period: '/month', tagline: 'For power users & studios' },
]

// ── Feature row definitions ───────────────────────────────────────
type CellValue = string | boolean | null

interface FeatureRow {
  label: string
  group?: string          // group heading rendered above this row
  cells: [CellValue, CellValue, CellValue, CellValue]   // free, starter, creator, pro
  highlight?: boolean     // bold/accent the whole row
}

const FEATURES: FeatureRow[] = [
  // ── Voice Synthesis ──────────────────────────────────────────
  {
    label: 'Voice syntheses',
    group: 'Voice Synthesis',
    cells: ['20 / month', '150 / month', '600 / month', '2,000 / month'],
    highlight: true,
  },
  {
    label: 'Script translations',
    cells: ['10 / month', '50 / month', '200 / month', 'Unlimited'],
  },
  {
    label: 'Words per script',
    cells: ['500', '5,000', 'Unlimited', 'Unlimited'],
  },
  {
    label: 'Languages supported',
    cells: ['16', '16', '16', '16'],
  },
  // ── Voice Profiles ───────────────────────────────────────────
  {
    label: 'Voice profiles (clones)',
    group: 'Voice Profiles',
    cells: ['1', '3', '10', '25'],
    highlight: true,
  },
  {
    label: 'Multi-voice scripts',
    cells: [false, true, true, true],
  },
  // ── Projects ─────────────────────────────────────────────────
  {
    label: 'Projects',
    group: 'Projects & Storage',
    cells: ['1', '10', 'Unlimited', 'Unlimited'],
    highlight: true,
  },
  {
    label: 'Timeline assembly',
    cells: [false, true, true, true],
  },
  {
    label: 'Audio export (WAV)',
    cells: [true, true, true, true],
  },
  // ── Performance ──────────────────────────────────────────────
  {
    label: 'Priority synthesis queue',
    group: 'Performance & Support',
    cells: [false, false, true, true],
  },
  {
    label: 'Data export (GDPR)',
    cells: [false, false, false, true],
  },
]

// ── Icons ────────────────────────────────────────────────────────
const IconCheck = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
    <circle cx="9" cy="9" r="8.5" stroke="currentColor" strokeOpacity="0.15" />
    <path d="M5.5 9.5l2.5 2.5 4.5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const IconMinus = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
    <path d="M5.5 9h7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" opacity="0.3" />
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
    return () => { try { document.head.removeChild(script) } catch { /* already removed */ } }
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
      style: { shape: 'rect', color: 'silver', layout: 'vertical', label: 'subscribe', height: 40 },
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

  return <div id={containerId} style={{ minHeight: 40 }} />
}

// ── Cell renderer ─────────────────────────────────────────────────
function Cell({ value, featured }: { value: CellValue; featured?: boolean }) {
  const color = featured ? 'var(--vx-purple)' : 'var(--vx-text-1)'
  const dimColor = 'var(--vx-text-3)'

  if (value === true)  return <span style={{ color, display: 'flex', justifyContent: 'center' }}><IconCheck /></span>
  if (value === false) return <span style={{ color: dimColor, display: 'flex', justifyContent: 'center' }}><IconMinus /></span>
  if (value === null)  return <span style={{ color: dimColor }}>—</span>

  // Bold "Unlimited" for visual pop
  if (value === 'Unlimited') {
    return <span style={{ color, fontWeight: 600, fontSize: 13 }}>Unlimited</span>
  }
  return <span style={{ color: featured ? color : 'var(--vx-text-2)', fontSize: 13 }}>{value}</span>
}

// ── Inline style helpers ──────────────────────────────────────────
const COL_W = 'minmax(100px, 1fr)'
const LABEL_W = '200px'

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
  const ppReady      = usePayPalSdk()
  const currentPlan  = user?.plan_name ?? 'free'
  const showChrome   = !user

  // Mobile: which plan column the user is viewing
  const [mobileCol, setMobileCol] = useState<number>(
    Math.max(0, PLAN_COLS.findIndex(p => p.id === currentPlan))
  )

  return (
    <div className="vox">
      <style>{`
        /* ── Pricing table ──────────────────────────────────── */
        .px-table-wrap {
          width: 100%;
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
          border-radius: 16px;
        }
        .px-table {
          width: 100%;
          min-width: 640px;
          border-collapse: collapse;
          table-layout: fixed;
        }
        .px-table th,
        .px-table td {
          padding: 0;
          text-align: center;
          vertical-align: middle;
        }
        .px-table th:first-child,
        .px-table td:first-child {
          text-align: left;
          width: ${LABEL_W};
        }
        /* header row */
        .px-th-plan {
          padding: 20px 16px 16px;
          position: relative;
        }
        /* data rows */
        .px-row td {
          padding: 12px 16px;
          border-top: 1px solid var(--vx-border-1);
          font-size: 13px;
          line-height: 1.4;
          transition: background 0.15s;
        }
        .px-row:hover td {
          background: rgba(255,255,255,0.025);
        }
        .px-row--highlight td {
          background: rgba(139, 92, 246, 0.04);
        }
        .px-row--highlight:hover td {
          background: rgba(139, 92, 246, 0.08);
        }
        /* group heading row */
        .px-group td {
          padding: 20px 16px 6px;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.8px;
          text-transform: uppercase;
          color: var(--vx-text-3);
          border-top: 1px solid var(--vx-border-1);
        }
        /* featured col highlight */
        .px-col--featured {
          background: rgba(139, 92, 246, 0.06);
          position: relative;
        }
        .px-col--featured::before {
          content: '';
          position: absolute;
          inset: 0;
          border-left: 1px solid rgba(139, 92, 246, 0.3);
          border-right: 1px solid rgba(139, 92, 246, 0.3);
          pointer-events: none;
        }
        .px-featured-top {
          border-top-left-radius: 12px;
          border-top-right-radius: 12px;
          border-top: 1px solid rgba(139, 92, 246, 0.4) !important;
        }
        .px-featured-bottom {
          border-bottom-left-radius: 12px;
          border-bottom-right-radius: 12px;
          border-bottom: 1px solid rgba(139, 92, 246, 0.4) !important;
        }
        /* mobile tab switcher */
        .px-mobile-tabs {
          display: none;
          gap: 6px;
          margin-bottom: 20px;
          overflow-x: auto;
          padding-bottom: 4px;
        }
        .px-mobile-tab {
          flex-shrink: 0;
          padding: 6px 14px;
          border-radius: 99px;
          border: 1px solid var(--vx-border-2);
          background: transparent;
          color: var(--vx-text-2);
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.15s;
        }
        .px-mobile-tab--active {
          background: var(--vx-purple);
          border-color: var(--vx-purple);
          color: #fff;
        }
        /* mobile: show only selected column */
        .px-mobile-hide { display: none; }

        @media (max-width: 700px) {
          .px-table-wrap { border-radius: 12px; }
          .px-mobile-tabs { display: flex; }
          .px-table { min-width: unset; }
          .px-table th:first-child,
          .px-table td:first-child { width: 130px; }
        }
        /* CTA cell */
        .px-cta-cell {
          padding: 16px 12px 20px !important;
        }
        /* plan name */
        .px-plan-name {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.6px;
          text-transform: uppercase;
          color: var(--vx-text-3);
          margin-bottom: 6px;
        }
        .px-plan-price {
          font-size: 28px;
          font-weight: 800;
          line-height: 1;
          letter-spacing: -1px;
        }
        .px-plan-period {
          font-size: 12px;
          color: var(--vx-text-3);
          margin-left: 2px;
          font-weight: 400;
        }
        .px-plan-tagline {
          font-size: 11px;
          color: var(--vx-text-3);
          margin-top: 4px;
        }
        /* current badge */
        .px-current-badge {
          display: inline-block;
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 0.6px;
          padding: 2px 8px;
          border-radius: 99px;
          background: var(--vx-surface-3);
          border: 1px solid var(--vx-border-2);
          color: var(--vx-text-3);
          margin-top: 6px;
        }
        /* popular badge */
        .px-popular-badge {
          display: inline-block;
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 0.8px;
          text-transform: uppercase;
          padding: 3px 10px;
          border-radius: 99px;
          background: linear-gradient(90deg, var(--vx-purple), var(--vx-coral));
          color: #fff;
          margin-bottom: 8px;
        }
        /* CTA btn full width */
        .px-cta-btn {
          width: 100%;
          padding: 10px 12px;
          border-radius: 10px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          border: none;
          transition: opacity 0.15s, transform 0.1s;
        }
        .px-cta-btn:hover:not(:disabled) { opacity: 0.88; transform: translateY(-1px); }
        .px-cta-btn:disabled { opacity: 0.45; cursor: default; }
        .px-cta-btn--primary {
          background: linear-gradient(90deg, var(--vx-purple), var(--vx-coral));
          color: #fff;
        }
        .px-cta-btn--ghost {
          background: transparent;
          border: 1px solid var(--vx-border-2) !important;
          color: var(--vx-text-2);
        }
        .px-cta-btn--current {
          background: var(--vx-surface-2);
          color: var(--vx-text-3);
        }
        /* label col */
        .px-feat-label {
          font-size: 13px;
          color: var(--vx-text-2);
          padding-right: 8px;
        }
      `}</style>

      <div className="vox-ambient"><div className="vox-ambient-3" /></div>

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

      {/* Pricing table */}
      <section className="vox-section" style={{ paddingTop: 0, paddingBottom: 64 }}>
        <div className="vox-wrap" style={{ maxWidth: 900 }}>

          {/* Mobile plan switcher */}
          <div className="px-mobile-tabs" role="tablist">
            {PLAN_COLS.map((col, i) => (
              <button
                key={col.id}
                role="tab"
                aria-selected={mobileCol === i}
                className={`px-mobile-tab${mobileCol === i ? ' px-mobile-tab--active' : ''}`}
                onClick={() => setMobileCol(i)}
              >
                {col.name}
                {col.id === currentPlan && user ? ' ✓' : ''}
              </button>
            ))}
          </div>

          <div className="px-table-wrap">
            <table className="px-table" role="table" aria-label="Plan comparison">
              <colgroup>
                <col style={{ width: LABEL_W }} />
                {PLAN_COLS.map((_, i) => (
                  <col key={i} style={{ width: COL_W }} />
                ))}
              </colgroup>

              {/* ── Header: plan names + prices + CTAs ── */}
              <thead>
                <tr>
                  {/* empty label cell */}
                  <th scope="col" />

                  {PLAN_COLS.map((col, i) => {
                    const isFeatured = col.featured
                    const isCurrent  = user ? currentPlan === col.id : false
                    const hideMobile = i !== mobileCol ? 'px-mobile-hide' : ''

                    return (
                      <th
                        key={col.id}
                        scope="col"
                        className={`px-th-plan ${isFeatured ? 'px-col--featured px-featured-top' : ''} ${hideMobile}`}
                      >
                        {isFeatured && <div className="px-popular-badge">Most Popular</div>}
                        <div className="px-plan-name">{col.name}</div>
                        <div>
                          <span className={`px-plan-price ${isFeatured ? 'vox-grad-text' : ''}`}>{col.price}</span>
                          {col.period && <span className="px-plan-period">{col.period}</span>}
                        </div>
                        <div className="px-plan-tagline">{col.tagline}</div>
                        {isCurrent && <div className="px-current-badge">✓ CURRENT</div>}
                      </th>
                    )
                  })}
                </tr>
              </thead>

              {/* ── Body: feature rows ── */}
              <tbody>
                {FEATURES.map((row, rowIdx) => {
                  const isLastRow = rowIdx === FEATURES.length - 1
                  return [
                    // Group heading
                    row.group && (
                      <tr key={`group-${rowIdx}`} className="px-group">
                        <td colSpan={5}>
                          {row.group}
                        </td>
                      </tr>
                    ),

                    // Feature row
                    <tr
                      key={`row-${rowIdx}`}
                      className={`px-row${row.highlight ? ' px-row--highlight' : ''}`}
                    >
                      <td className="px-feat-label">{row.label}</td>
                      {row.cells.map((val, colIdx) => {
                        const col = PLAN_COLS[colIdx]
                        const isFeatured = col.featured
                        const hideMobile = colIdx !== mobileCol ? 'px-mobile-hide' : ''
                        const featuredClass = isFeatured
                          ? `px-col--featured${isLastRow ? ' px-featured-bottom' : ''}`
                          : ''
                        return (
                          <td key={colIdx} className={`${featuredClass} ${hideMobile}`}>
                            <Cell value={val} featured={isFeatured} />
                          </td>
                        )
                      })}
                    </tr>,
                  ]
                })}

                {/* ── CTA row ── */}
                <tr className="px-row">
                  <td />
                  {PLAN_COLS.map((col, i) => {
                    const isFeatured = col.featured
                    const isCurrent  = user ? currentPlan === col.id : false
                    const hideMobile = i !== mobileCol ? 'px-mobile-hide' : ''
                    const featClass  = isFeatured ? 'px-col--featured px-featured-bottom' : ''

                    return (
                      <td key={col.id} className={`px-cta-cell ${featClass} ${hideMobile}`}>
                        {col.id === 'free' ? (
                          isCurrent ? (
                            <button className="px-cta-btn px-cta-btn--current" disabled>✓ Current Plan</button>
                          ) : (
                            <button className="px-cta-btn px-cta-btn--ghost" onClick={() => !user && onSignUp?.()}>
                              Get Started Free
                            </button>
                          )
                        ) : isCurrent ? (
                          <button className="px-cta-btn px-cta-btn--current" disabled>✓ Current Plan</button>
                        ) : !user ? (
                          <button
                            className={`px-cta-btn ${isFeatured ? 'px-cta-btn--primary' : 'px-cta-btn--ghost'}`}
                            onClick={onSignUp}
                          >
                            Sign up &amp; Subscribe
                          </button>
                        ) : ppReady ? (
                          <PayPalButton
                            plan={col.id as 'starter' | 'creator' | 'pro'}
                            onSuccess={() => onSubscribed?.()}
                          />
                        ) : (
                          <div style={{
                            height: 40, background: 'var(--vx-surface-2)', borderRadius: 10,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 12, color: 'var(--vx-text-3)', gap: 6,
                          }}>
                            <span className="spinner" style={{ width: 13, height: 13 }} />
                            Loading…
                          </div>
                        )}
                      </td>
                    )
                  })}
                </tr>
              </tbody>
            </table>
          </div>

          {/* Footer note */}
          <p style={{ fontSize: 12.5, color: 'var(--vx-text-3)', textAlign: 'center', marginTop: 28, lineHeight: 1.8 }}>
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