import { ArrowLeft } from 'lucide-react'
import PageFooter from '@/components/PageFooter'
import Logo from '@/components/Logo'

interface Props { onBack: () => void; onTerms?: () => void }

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="text-base font-bold text-white mt-10 mb-3">{children}</h2>
}
function P({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-gray-400 leading-relaxed mb-3">{children}</p>
}
function Li({ children }: { children: React.ReactNode }) {
  return <li className="text-sm text-gray-400 leading-relaxed ml-4 list-disc">{children}</li>
}

export default function PrivacyPolicyPage({ onBack, onTerms }: Props) {
  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <nav className="border-b border-gray-800 sticky top-0 z-50 bg-gray-950/90 backdrop-blur">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 flex items-center h-14">
          <button onClick={onBack} className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors">
            <ArrowLeft size={14} />
            <Logo size="sm" />
          </button>
        </div>
      </nav>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-14">
        <div className="text-[10px] text-brand-500 font-bold uppercase tracking-widest mb-2">Legal</div>
        <h1 className="text-3xl font-extrabold text-white mb-2">Privacy Policy</h1>
        <p className="text-xs text-gray-600 mb-10">Last updated: March 2026 · Effective immediately</p>

        <P>
          MLDock.io ("we", "our", or "us") is operated by Kreateyou Technologies Ltd. This Privacy Policy explains how we collect,
          use, disclose, and safeguard your information when you use our platform at any MLDock.io-branded domain or
          self-hosted instance. Please read this carefully. By accessing or using MLDock.io you agree to this policy.
        </P>

        <H2>1. Information We Collect</H2>
        <P><strong className="text-gray-300">Account data:</strong> Email address, hashed password, organisation name, and role when you register.</P>
        <P><strong className="text-gray-300">Usage data:</strong> Training job logs, model metrics, inference request counts, and job run timestamps. These are used to display your history and compute billing.</P>
        <P><strong className="text-gray-300">Billing data:</strong> Wallet top-up amounts and Paystack transaction references. We do not store card numbers or M-Pesa PINs — all payment processing is handled by Paystack.</P>
        <P><strong className="text-gray-300">Technical data:</strong> IP address, browser type, and request metadata collected via server logs for security and abuse prevention.</P>
        <P><strong className="text-gray-300">Cookies:</strong> Session tokens stored as HTTP-only cookies, and optional analytics cookies (see Cookie Policy section).</P>

        <H2>2. How We Use Your Information</H2>
        <ul className="space-y-1.5 mb-3">
          <Li>To authenticate your account and maintain session security</Li>
          <Li>To provision cloud GPU instances on your behalf and track associated costs</Li>
          <Li>To process wallet top-ups and deduct GPU usage charges</Li>
          <Li>To send transactional emails (account activation, payment confirmation)</Li>
          <Li>To monitor platform abuse, fraud, and security incidents</Li>
          <Li>To improve platform reliability and performance</Li>
        </ul>
        <P>We do not sell your personal data to third parties.</P>

        <H2>3. Data Sharing</H2>
        <P>We share data only with the following third parties, strictly to operate the service:</P>
        <ul className="space-y-1.5 mb-3">
          <Li><strong className="text-gray-300">Paystack:</strong> Payment processing. Governed by Paystack's Privacy Policy.</Li>
          <Li><strong className="text-gray-300">RunPod:</strong> Cloud GPU provisioning. Job dispatch data (trainer code, config) is transmitted to RunPod pods you create.</Li>
          <Li><strong className="text-gray-300">AWS S3 / MinIO:</strong> Storage of trained model artifacts and uploaded datasets.</Li>
        </ul>

        <H2>4. Data Retention</H2>
        <P>
          Account data is retained for as long as your account is active. Training job records and model artifacts are
          retained indefinitely unless you explicitly delete them. Wallet transaction records are retained for 7 years
          for financial compliance. You may request deletion of your account and associated data by contacting us.
        </P>

        <H2>5. Security</H2>
        <P>
          All data is transmitted over HTTPS. Passwords are hashed using bcrypt. API keys are stored as salted hashes —
          the raw key is shown only once at creation. Wallet and billing operations require a valid JWT or API key on every request.
        </P>

        <H2>6. Your Rights</H2>
        <P>You have the right to access, correct, export, or delete your personal data. Contact us at the address below to exercise these rights. We will respond within 30 days.</P>

        <H2>7. Children</H2>
        <P>MLDock.io is not directed at children under 16. We do not knowingly collect data from minors.</P>

        <H2>8. Changes to This Policy</H2>
        <P>We may update this policy. We will notify registered users by email for material changes. Continued use after changes constitutes acceptance.</P>

        <H2>9. Contact</H2>
        <P>For privacy enquiries: <span className="text-brand-400">privacy@kreateyou.com</span></P>
      </div>
      <PageFooter onTerms={onTerms} />
    </div>
  )
}
