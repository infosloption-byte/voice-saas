import { LogoMark } from './LandingPage'
import { icons } from './constants'

const COMPANY = 'Voxora'
const EMAIL   = 'legal@voicestudio.app'
const UPDATED = 'May 26, 2026'

// ── Shared shell ───────────────────────────────────────────────────
function LegalShell({ title, onBack, children }: {
  title: string
  onBack?: () => void
  children: React.ReactNode
}) {
  return (
    <div style={{ minHeight: '100svh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>
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
          <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-1)' }}>{COMPANY}</span>
          <span style={{ fontSize: 13, color: 'var(--text-3)' }}>/ {title}</span>
        </div>
      </div>

      <div style={{ maxWidth: 760, margin: '0 auto', padding: '48px 24px 80px', width: '100%' }}>
        <h1 style={{
          fontFamily: 'var(--serif)', fontSize: 36, fontWeight: 400,
          color: 'var(--text-1)', letterSpacing: '-0.8px', marginBottom: 8,
        }}>
          {title}
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 40 }}>
          Last updated: {UPDATED}
        </p>
        {children}
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 36 }}>
      <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-1)', marginBottom: 12 }}>
        {title}
      </h2>
      <div style={{ fontSize: 14.5, color: 'var(--text-2)', lineHeight: 1.75 }}>
        {children}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// PRIVACY POLICY
// ═══════════════════════════════════════════════════════════════════
export function PrivacyPage({ onBack }: { onBack?: () => void }) {
  return (
    <LegalShell title="Privacy Policy" onBack={onBack}>
      <Section title="1. Introduction">
        <p>
          {COMPANY} ("we", "us", or "our") operates the Voxora platform. This Privacy Policy
          explains how we collect, use, disclose, and protect your personal information when you
          use our service. By using Voxora, you agree to the collection and use of information
          in accordance with this policy.
        </p>
      </Section>

      <Section title="2. Information We Collect">
        <p style={{ marginBottom: 10 }}><strong>Account information:</strong> When you register, we collect your name,
        email address, and a hashed password. We never store your plain-text password.</p>
        <p style={{ marginBottom: 10 }}><strong>Voice data:</strong> When you create a voice profile, your audio recording
        is processed by our AI engine to create a voice model. The original recording is discarded after
        processing; only the processed voice model is retained.</p>
        <p style={{ marginBottom: 10 }}><strong>Content:</strong> Scripts, projects, and synthesised audio you create are
        stored on our servers and associated with your account.</p>
        <p style={{ marginBottom: 10 }}><strong>Usage data:</strong> We may collect information about how you use the
        service, including features accessed, synthesis frequency, and error logs, solely for the
        purpose of improving the platform.</p>
        <p><strong>Payment information:</strong> Payments are processed by PayPal. We do not store
        credit card numbers. We receive a subscription ID and plan status from PayPal.</p>
      </Section>

      <Section title="3. How We Use Your Information">
        <p>We use your information to:</p>
        <ul style={{ paddingLeft: 20, marginTop: 8 }}>
          <li style={{ marginBottom: 6 }}>Provide, operate, and maintain the Voxora service</li>
          <li style={{ marginBottom: 6 }}>Process transactions and manage your subscription</li>
          <li style={{ marginBottom: 6 }}>Send transactional emails (account verification, password resets)</li>
          <li style={{ marginBottom: 6 }}>Respond to support inquiries</li>
          <li style={{ marginBottom: 6 }}>Detect and prevent fraud or abuse</li>
          <li>Comply with legal obligations</li>
        </ul>
        <p style={{ marginTop: 10 }}>We do not sell, rent, or share your personal data with third parties
        for marketing purposes.</p>
      </Section>

      <Section title="4. Data Retention">
        <p>
          Your account data is retained for as long as your account is active. You may request
          deletion of your account and all associated data at any time from the Settings page.
          Upon deletion, we remove your personal data within 30 days, except where retention is
          required by law.
        </p>
      </Section>

      <Section title="5. Data Exports (Your Rights)">
        <p>
          You have the right to request a copy of your data in a machine-readable format. From the
          Settings &gt; Danger Zone page, you can export all your projects, scripts, and profile
          metadata as a JSON file. Under GDPR (for EU residents) and similar regulations, you also
          have the right to access, rectify, or erase your personal data.
        </p>
      </Section>

      <Section title="6. Security">
        <p>
          We take reasonable measures to protect your information from unauthorised access,
          including TLS encryption in transit, hashed password storage (bcrypt), and server-side
          API key authentication between service components. No method of transmission over the
          Internet is 100% secure, and we cannot guarantee absolute security.
        </p>
      </Section>

      <Section title="7. Cookies">
        <p>
          Voxora uses essential session cookies for authentication. We also use a preference
          cookie to remember your dark/light mode setting and notification preferences. We do not
          use third-party tracking or advertising cookies. You may clear cookies at any time through
          your browser settings.
        </p>
      </Section>

      <Section title="8. Third-Party Services">
        <p>
          We use the following third-party services which have their own privacy policies:
        </p>
        <ul style={{ paddingLeft: 20, marginTop: 8 }}>
          <li style={{ marginBottom: 6 }}><strong>PayPal</strong> — for subscription payment processing</li>
          <li style={{ marginBottom: 6 }}><strong>SMTP mail provider</strong> — for transactional emails</li>
        </ul>
      </Section>

      <Section title="9. Children">
        <p>
          Voxora is not directed at children under 13. We do not knowingly collect personal
          information from children. If you believe a child has provided us with personal information,
          please contact us and we will delete it promptly.
        </p>
      </Section>

      <Section title="10. Changes to This Policy">
        <p>
          We may update this Privacy Policy from time to time. We will notify you of significant
          changes by email or by a prominent notice in the application. Continued use of the
          service after changes constitutes acceptance of the updated policy.
        </p>
      </Section>

      <Section title="11. Contact">
        <p>
          Questions about this Privacy Policy? Contact us at{' '}
          <a href={`mailto:${EMAIL}`} style={{ color: 'var(--accent)' }}>{EMAIL}</a>.
        </p>
      </Section>
    </LegalShell>
  )
}

// ═══════════════════════════════════════════════════════════════════
// TERMS OF SERVICE
// ═══════════════════════════════════════════════════════════════════
export function TermsPage({ onBack }: { onBack?: () => void }) {
  return (
    <LegalShell title="Terms of Service" onBack={onBack}>
      <Section title="1. Acceptance of Terms">
        <p>
          By creating an account or using Voxora, you agree to be bound by these Terms of
          Service. If you do not agree to these terms, please do not use the service. These terms
          apply to all users, including free, trial, and paid subscribers.
        </p>
      </Section>

      <Section title="2. Description of Service">
        <p>
          Voxora is an AI-powered voice synthesis platform that allows registered users to
          clone their voice and generate text-to-speech audio for personal and commercial use,
          subject to the limitations of their subscription plan.
        </p>
      </Section>

      <Section title="3. Account Registration">
        <p>
          You must provide accurate and complete information when creating your account. You are
          responsible for maintaining the confidentiality of your password and for all activities
          under your account. You must notify us immediately of any unauthorised use of your account.
          You must be at least 18 years old to use Voxora.
        </p>
      </Section>

      <Section title="4. Subscription Plans and Billing">
        <p style={{ marginBottom: 10 }}>
          Voxora offers the following subscription plans:
        </p>
        <ul style={{ paddingLeft: 20, marginTop: 8, marginBottom: 10 }}>
          <li style={{ marginBottom: 6 }}><strong>Free:</strong> Limited usage with basic features. No payment required.</li>
          <li style={{ marginBottom: 6 }}><strong>Starter ($9/month):</strong> Increased synthesis quota, voice profiles, and projects.</li>
          <li style={{ marginBottom: 6 }}><strong>Creator ($29/month):</strong> Higher synthesis quota, more voice profiles, and priority synthesis queue.</li>
          <li><strong>Pro ($79/month):</strong> Highest synthesis quota, most voice profiles, unlimited translations, and data export.</li>
        </ul>
        <p>
          Subscriptions are billed monthly through PayPal. You may cancel your subscription at
          any time from the Settings page; cancellation takes effect at the end of the current
          billing period. We do not issue refunds for partial months.
        </p>
      </Section>

      <Section title="5. Acceptable Use">
        <p style={{ marginBottom: 10 }}>You agree not to use Voxora to:</p>
        <ul style={{ paddingLeft: 20 }}>
          <li style={{ marginBottom: 6 }}>Clone or impersonate another person's voice without their explicit consent</li>
          <li style={{ marginBottom: 6 }}>Generate audio designed to deceive, defraud, or harm others (deepfakes)</li>
          <li style={{ marginBottom: 6 }}>Produce content that is illegal, defamatory, harassing, or abusive</li>
          <li style={{ marginBottom: 6 }}>Violate intellectual property rights of third parties</li>
          <li style={{ marginBottom: 6 }}>Attempt to reverse-engineer, scrape, or overload the service</li>
          <li>Resell or sublicense access to the service to third parties</li>
        </ul>
      </Section>

      <Section title="6. Your Content">
        <p>
          You retain ownership of the scripts, voice profiles, and audio you create. By using
          Voxora, you grant us a limited licence to store, process, and transmit your content
          solely as necessary to provide the service. We do not claim ownership of your content and
          will not use it to train models without your explicit consent.
        </p>
      </Section>

      <Section title="7. Intellectual Property">
        <p>
          Voxora and its underlying software, design, and AI models are proprietary to{' '}
          {COMPANY}. You may not copy, modify, distribute, or reverse-engineer any part of the
          platform. The Voxora name and logo are trademarks of {COMPANY}.
        </p>
      </Section>

      <Section title="8. Disclaimer of Warranties">
        <p>
          Voxora is provided "AS IS" without warranties of any kind. We do not guarantee that
          the service will be uninterrupted, error-free, or meet your specific requirements. AI-generated
          audio quality may vary. We are not responsible for the accuracy of voice synthesis output.
        </p>
      </Section>

      <Section title="9. Limitation of Liability">
        <p>
          To the maximum extent permitted by law, {COMPANY} shall not be liable for any indirect,
          incidental, special, or consequential damages arising from your use of the service,
          including but not limited to loss of profits, data, or goodwill. Our total liability
          for any claim shall not exceed the amount paid by you in the 12 months preceding the claim.
        </p>
      </Section>

      <Section title="10. Termination">
        <p>
          We reserve the right to suspend or terminate your account for violation of these terms,
          non-payment, or any other reason at our discretion. You may terminate your account at
          any time from Settings &gt; Danger Zone. Upon termination, your data is deleted in
          accordance with our Privacy Policy.
        </p>
      </Section>

      <Section title="11. Governing Law">
        <p>
          These Terms are governed by and construed in accordance with applicable law. Any disputes
          shall be resolved through binding arbitration or in courts of competent jurisdiction.
        </p>
      </Section>

      <Section title="12. Changes">
        <p>
          We may revise these Terms at any time. We will notify you via email of material changes.
          Continued use of the service after the effective date of changes constitutes acceptance.
        </p>
      </Section>

      <Section title="13. Contact">
        <p>
          Questions about these Terms? Contact us at{' '}
          <a href={`mailto:${EMAIL}`} style={{ color: 'var(--accent)' }}>{EMAIL}</a>.
        </p>
      </Section>
    </LegalShell>
  )
}

// ═══════════════════════════════════════════════════════════════════
// ACCEPTABLE USE POLICY
// ═══════════════════════════════════════════════════════════════════
export function AcceptableUsePage({ onBack }: { onBack?: () => void }) {
  return (
    <LegalShell title="Acceptable Use Policy" onBack={onBack}>
      <Section title="1. Purpose">
        <p>
          This Acceptable Use Policy ("AUP") governs how you may use {COMPANY}. It exists to
          keep our voice technology safe, lawful, and respectful of every individual's identity.
          By using {COMPANY}, you agree to comply with this AUP in addition to our Terms of
          Service. Violations may result in immediate suspension or termination of your account.
        </p>
      </Section>

      <Section title="2. Consent-Only Voice Cloning">
        <p style={{ marginBottom: 10 }}>
          {COMPANY} is designed for one purpose: to let you create a voice from audio that you
          are legally entitled to use. You may only create a voice profile from:
        </p>
        <ul style={{ paddingLeft: 20, marginTop: 8, marginBottom: 10 }}>
          <li style={{ marginBottom: 6 }}>Your own voice; or</li>
          <li style={{ marginBottom: 6 }}>
            The voice of a person who has given you explicit, verifiable, written permission to
            clone and use their voice.
          </li>
        </ul>
        <p>
          Before recording or uploading a voice sample, you must affirmatively confirm that you
          meet one of these conditions. {COMPANY} does not provide, host, or offer any library of
          celebrity, public-figure, or other real persons' voices.
        </p>
      </Section>

      <Section title="3. Strictly Prohibited Uses">
        <p style={{ marginBottom: 10 }}>You must <strong>not</strong> use {COMPANY} to:</p>
        <ul style={{ paddingLeft: 20 }}>
          <li style={{ marginBottom: 6 }}>
            Clone, imitate, or synthesise the voice of any celebrity, politician, public figure,
            or any other real person without their explicit consent.
          </li>
          <li style={{ marginBottom: 6 }}>
            Create "deepfakes" or any audio intended to deceive listeners into believing a real
            person said something they did not.
          </li>
          <li style={{ marginBottom: 6 }}>
            Impersonate any individual or organisation for the purpose of fraud, scams, social
            engineering, or identity theft.
          </li>
          <li style={{ marginBottom: 6 }}>
            Produce content that is defamatory, harassing, hateful, sexually explicit involving
            real people, or that promotes violence.
          </li>
          <li style={{ marginBottom: 6 }}>
            Generate misinformation, fake endorsements, or fraudulent communications.
          </li>
          <li style={{ marginBottom: 6 }}>
            Violate any person's publicity, privacy, intellectual property, or other legal rights.
          </li>
          <li>Break any applicable local, national, or international law.</li>
        </ul>
      </Section>

      <Section title="4. Your Responsibility">
        <p>
          You are solely responsible for the voice samples you upload and the audio you generate.
          You represent and warrant that you hold all necessary rights and consents for every
          voice profile you create. {COMPANY} is a tool; lawful use of its output is your
          responsibility.
        </p>
      </Section>

      <Section title="5. Enforcement">
        <p>
          We take violations seriously. We may, at our discretion and without prior notice,
          remove content, suspend or terminate accounts, and report unlawful activity to the
          relevant authorities. We reserve the right to refuse service to anyone who breaches
          this policy.
        </p>
      </Section>

      <Section title="6. Reporting Abuse">
        <p>
          If you believe your voice or identity has been used on {COMPANY} without your consent,
          or you wish to report any other violation of this policy, contact us immediately at{' '}
          <a href={`mailto:${EMAIL}`} style={{ color: 'var(--accent)' }}>{EMAIL}</a>. We
          investigate all reports promptly.
        </p>
      </Section>

      <Section title="7. Changes">
        <p>
          We may update this Acceptable Use Policy from time to time. Material changes will be
          communicated by email or by a notice within the platform. Continued use of the service
          after such changes constitutes acceptance of the revised policy.
        </p>
      </Section>
    </LegalShell>
  )
}

// ═══════════════════════════════════════════════════════════════════
// REFUND POLICY
// ═══════════════════════════════════════════════════════════════════
export function RefundPolicyPage({ onBack }: { onBack?: () => void }) {
  return (
    <LegalShell title="Refund Policy" onBack={onBack}>
      <Section title="1. Overview">
        <p>
          At {COMPANY}, we want you to be satisfied with your subscription. This Refund Policy
          explains when refunds are available and how to request them. By subscribing to any
          paid plan, you agree to this policy.
        </p>
      </Section>

      <Section title="2. Subscription Plans">
        <p style={{ marginBottom: 10 }}>
          {COMPANY} offers the following paid subscription plans, billed monthly:
        </p>
        <ul style={{ paddingLeft: 20, marginTop: 8, marginBottom: 10 }}>
          <li style={{ marginBottom: 6 }}><strong>Starter — $9/month:</strong> Increased synthesis quota, voice profiles, and projects.</li>
          <li style={{ marginBottom: 6 }}><strong>Creator — $29/month:</strong> Higher synthesis quota, more voice profiles, and priority synthesis queue.</li>
          <li><strong>Pro — $79/month:</strong> Highest synthesis quota, most voice profiles, unlimited translations, and data export.</li>
        </ul>
        <p>
          All payments are processed securely through PayPal. Subscription fees are charged at
          the beginning of each billing period.
        </p>
      </Section>

      <Section title="3. No Refunds for Partial Months">
        <p>
          Subscriptions are billed on a monthly cycle. We do not issue refunds or credits for
          partial months of service, unused synthesis quota, or periods during which you did not
          actively use the service. When you cancel your subscription, you will retain access to
          your paid plan features until the end of the current billing period.
        </p>
      </Section>

      <Section title="4. Eligibility for a Refund">
        <p style={{ marginBottom: 10 }}>
          A full refund of the most recent payment may be granted in the following circumstances:
        </p>
        <ul style={{ paddingLeft: 20, marginTop: 8, marginBottom: 10 }}>
          <li style={{ marginBottom: 6 }}>
            <strong>Duplicate charge:</strong> You were charged more than once for the same
            billing period due to a technical error.
          </li>
          <li style={{ marginBottom: 6 }}>
            <strong>Service unavailability:</strong> The service experienced a verified outage
            of more than 72 consecutive hours during your paid period through no fault of your
            own (e.g. not caused by your account being suspended for a policy violation).
          </li>
          <li>
            <strong>Unauthorised charge:</strong> A payment was made without your authorisation
            and you notify us within 7 days of the charge.
          </li>
        </ul>
        <p>
          Refund requests based on dissatisfaction with AI-generated output quality, change of
          mind, or failure to cancel before the next billing date are not eligible for a refund.
        </p>
      </Section>

      <Section title="5. How to Request a Refund">
        <p style={{ marginBottom: 10 }}>
          To request a refund, email us at{' '}
          <a href={`mailto:${EMAIL}`} style={{ color: 'var(--accent)' }}>{EMAIL}</a> with:
        </p>
        <ul style={{ paddingLeft: 20, marginTop: 8, marginBottom: 10 }}>
          <li style={{ marginBottom: 6 }}>Your registered email address</li>
          <li style={{ marginBottom: 6 }}>The PayPal transaction ID</li>
          <li>A brief description of the reason for your request</li>
        </ul>
        <p>
          We aim to respond to all refund requests within 5 business days. Approved refunds
          are issued to the original payment method via PayPal and typically appear within
          3–7 business days, depending on your bank.
        </p>
      </Section>

      <Section title="6. Cancellation">
        <p>
          You may cancel your subscription at any time from the Settings page inside your
          Voxora account. Cancellation stops future charges; it does not trigger a refund for
          the current billing period unless you meet the eligibility criteria in Section 4.
        </p>
      </Section>

      <Section title="7. Changes to This Policy">
        <p>
          We reserve the right to update this Refund Policy at any time. Material changes will
          be communicated by email or by a notice within the platform. Continued use of the
          service after such changes constitutes your acceptance of the revised policy.
        </p>
      </Section>

      <Section title="8. Contact Us">
        <p>
          Questions about this Refund Policy? Contact us at{' '}
          <a href={`mailto:${EMAIL}`} style={{ color: 'var(--accent)' }}>{EMAIL}</a>.
        </p>
      </Section>
    </LegalShell>
  )
}
