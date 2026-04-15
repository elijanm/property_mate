import PublicShell from '@/layouts/PublicShell'

const LAST_UPDATED = '1 April 2025'

interface Section {
  heading: string
  body: string | string[]
}

const SECTIONS: Section[] = [
  {
    heading: '1. Who we are',
    body: 'FahariCloud is operated by Nexidra Limited, a company incorporated in Kenya (the "Company", "we", "us", "our"). Our registered address is Nairobi, Kenya. We operate the FahariCloud property management platform ("Platform"), accessible at faharicloud.com and via our mobile applications. We also operate SparcCloud (sparccloud.com), which uses the same underlying platform for international markets.',
  },
  {
    heading: '2. What data we collect',
    body: [
      'Account data: name, email address, phone number, and role (owner, agent, tenant, service provider) provided during registration.',
      'Property data: property addresses, unit details, lease terms, and rent amounts that you enter into the Platform.',
      'Tenant data: tenant identity information (national ID number and type, date of birth, emergency contact) provided during tenant onboarding.',
      'Payment data: Mpesa transaction references, payment amounts, and timestamps. We do not store raw Mpesa PIN or M-PESA credentials. Payment reconciliation data is received from Safaricom\'s C2B API.',
      'Document data: lease PDFs, ID scan uploads, meter-reading photos, and maintenance ticket attachments stored in our encrypted document store.',
      'Usage data: page views, feature interactions, error logs, and device/browser metadata collected to operate and improve the Platform.',
      'Communications data: support messages sent via WhatsApp, email, or in-app chat.',
    ],
  },
  {
    heading: '3. How we use your data',
    body: [
      'To provide the Platform: authenticate users, generate invoices, process payment reconciliations, store documents, and deliver notifications.',
      'To operate billing: generate and deliver invoices, track payment status, and manage arrears.',
      'To communicate with you: send transactional emails (invoice delivery, lease signing requests, maintenance updates), respond to support requests, and — where you\'ve opted in — send product updates.',
      'To improve the Platform: analyse usage patterns, identify bugs, and prioritise features.',
      'To comply with law: retain financial records as required by Kenyan tax and accounting regulations, and respond to lawful requests from authorities.',
    ],
  },
  {
    heading: '4. Legal basis for processing (GDPR / Kenya Data Protection Act 2019)',
    body: [
      'Contract performance: processing necessary to deliver the Platform you\'ve signed up for.',
      'Legitimate interests: fraud prevention, security monitoring, and product improvement.',
      'Legal obligation: retention of financial and tax records.',
      'Consent: marketing communications (where you\'ve opted in) and cookies beyond strictly necessary ones.',
    ],
  },
  {
    heading: '5. Data sharing',
    body: [
      'We do not sell your personal data.',
      'We share data with subprocessors strictly necessary to operate the Platform, including: MongoDB Atlas (database), AWS S3-compatible storage (documents), Safaricom (Mpesa payment processing), Deepgram / OpenAI (AI voice agent transcription — only when the voice agent feature is enabled), and Sendgrid (transactional email).',
      'We may share data with law enforcement or regulators where required by applicable law.',
      'If you are a tenant, your landlord or managing agent has access to your tenancy data within their FahariCloud account. They are the data controller for that data; we act as data processor on their behalf.',
    ],
  },
  {
    heading: '6. Data retention',
    body: [
      'Account data is retained for the duration of your subscription plus 12 months after cancellation, after which it is deleted or anonymised.',
      'Financial records (invoices, payment logs) are retained for 7 years to comply with Kenyan tax law.',
      'Tenant identity documents are retained for the duration of the tenancy plus 12 months, unless a longer retention period is required by applicable law.',
      'Deleted data may persist in encrypted backups for up to 30 days before permanent deletion.',
    ],
  },
  {
    heading: '7. Cookies',
    body: 'We use strictly necessary cookies to maintain your login session. We use analytics cookies (Plausible Analytics — privacy-preserving, no cross-site tracking) to understand how the Platform is used. We do not use advertising or tracking cookies. You can opt out of analytics cookies in your account settings.',
  },
  {
    heading: '8. Security',
    body: 'All data is encrypted in transit (TLS 1.2+) and at rest (AES-256). We operate MongoDB replica sets for durability, automated encrypted backups, and access controls restricted to authorised personnel. We conduct periodic security reviews. Despite these measures, no system is 100% secure — please notify us immediately at security@faharicloud.com if you discover a vulnerability.',
  },
  {
    heading: '9. Your rights',
    body: [
      'Access: request a copy of personal data we hold about you.',
      'Correction: request correction of inaccurate data.',
      'Deletion: request deletion of your data (subject to legal retention requirements).',
      'Portability: receive your data in a machine-readable format.',
      'Objection: object to processing based on legitimate interests.',
      'Withdrawal of consent: withdraw consent for optional processing (e.g. marketing emails) at any time.',
      'To exercise any of these rights, email privacy@faharicloud.com. We will respond within 30 days.',
    ],
  },
  {
    heading: '10. International transfers',
    body: 'Your data is processed primarily in the European Union (MongoDB Atlas EU region) and in Kenya. Where data is transferred outside Kenya, we rely on standard contractual clauses (SCCs) or equivalent safeguards to protect your data.',
  },
  {
    heading: '11. Children',
    body: 'The Platform is not directed at children under 18. We do not knowingly collect data from children. If you believe we have inadvertently collected data from a minor, contact us at privacy@faharicloud.com and we will delete it promptly.',
  },
  {
    heading: '12. Changes to this policy',
    body: 'We may update this policy from time to time. We will notify you of material changes via email or an in-app notice at least 14 days before they take effect. Continued use of the Platform after the effective date constitutes acceptance of the updated policy.',
  },
  {
    heading: '13. Contact us',
    body: 'For privacy-related questions or to exercise your rights, contact: Nexidra Limited, Nairobi, Kenya · privacy@faharicloud.com · +254 700 000 000.',
  },
]

export default function PrivacyPolicyPage() {
  return (
    <PublicShell>
      <div className="border-b border-gray-100 bg-gray-50 py-10">
        <div className="mx-auto max-w-3xl px-5">
          <p className="text-xs font-semibold uppercase tracking-widest text-blue-600 mb-1">Legal</p>
          <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Privacy Policy</h1>
          <p className="mt-2 text-sm text-gray-500">Last updated: {LAST_UPDATED}</p>
        </div>
      </div>

      <div className="py-10">
        <div className="mx-auto max-w-3xl px-5">
          <p className="text-sm text-gray-500 leading-relaxed mb-8">
            This Privacy Policy explains how Nexidra Limited ("FahariCloud") collects, uses, stores,
            and protects personal data when you use our property management platform. We are committed
            to protecting your privacy and complying with the Kenya Data Protection Act 2019 and,
            where applicable, the EU General Data Protection Regulation (GDPR).
          </p>

          <div className="space-y-8">
            {SECTIONS.map(section => (
              <div key={section.heading} className="border-t border-gray-100 pt-6">
                <h2 className="text-base font-bold text-gray-900 mb-3">{section.heading}</h2>
                {Array.isArray(section.body) ? (
                  <ul className="space-y-2">
                    {section.body.map((item, i) => (
                      <li key={i} className="flex items-start gap-2.5 text-sm text-gray-500 leading-relaxed">
                        <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gray-400" />
                        {item}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-gray-500 leading-relaxed">{section.body}</p>
                )}
              </div>
            ))}
          </div>

          <div className="mt-10 rounded-lg border border-blue-100 bg-blue-50 p-5">
            <p className="text-sm font-semibold text-blue-900 mb-1">Questions about this policy?</p>
            <p className="text-sm text-blue-700">
              Email us at{' '}
              <a href="mailto:privacy@faharicloud.com" className="underline font-medium">privacy@faharicloud.com</a>.
              {' '}We aim to respond within 5 business days.
            </p>
          </div>
        </div>
      </div>
    </PublicShell>
  )
}
