import { ArrowLeft, AlertTriangle } from 'lucide-react'
import PageFooter from '@/components/PageFooter'
import Logo from '@/components/Logo'

interface Props { onBack: () => void; onPrivacy?: () => void }

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="text-base font-bold text-white mt-10 mb-3">{children}</h2>
}
function P({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-gray-400 leading-relaxed mb-3">{children}</p>
}
function Li({ children }: { children: React.ReactNode }) {
  return <li className="text-sm text-gray-400 leading-relaxed ml-4 list-disc">{children}</li>
}

export default function TermsPage({ onBack, onPrivacy }: Props) {
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
        <h1 className="text-3xl font-extrabold text-white mb-2">Terms of Service</h1>
        <p className="text-xs text-gray-600 mb-10">Last updated: March 2026 · Effective immediately</p>

        <P>
          These Terms of Service ("Terms") govern your access to and use of MLDock.io, operated by Kreateyou Technologies Ltd ("we", "us").
          By creating an account or using the platform you agree to be bound by these Terms.
          If you do not agree, do not use MLDock.io.
        </P>

        <H2>1. Eligibility</H2>
        <P>You must be at least 18 years old and have the legal capacity to enter into a binding contract in your jurisdiction. By using MLDock.io you represent that you meet these requirements.</P>

        <H2>2. Account Responsibilities</H2>
        <P>You are responsible for keeping your credentials secure. You must not share your account, API keys, or JWT tokens with third parties. You are liable for all activity that occurs under your account.</P>
        <P>You must not use MLDock.io to:</P>
        <ul className="space-y-1.5 mb-3">
          <Li>Train or deploy models for illegal purposes</Li>
          <Li>Attempt to access other users' data or workspaces</Li>
          <Li>Reverse-engineer, resell, or sublicense the platform software itself</Li>
          <Li>Conduct denial-of-service attacks or abuse GPU resources</Li>
          <Li>Upload malicious code disguised as trainer plugins</Li>
        </ul>

        <H2>3. Wallet, Billing &amp; GPU Usage</H2>
        <P>GPU training jobs are billed against your pre-funded wallet balance. When a cloud GPU job starts, up to 3× the estimated hourly cost is reserved. On completion, you are charged only for actual GPU time used. Any unused reservation is returned to your wallet immediately.</P>
        <P>GPU prices are displayed inclusive of a platform service fee. Prices are subject to change at any time based on upstream provider pricing. The price shown at job submission is not a fixed quote — actual charges depend on the duration of your job.</P>

        {/* No-refund policy — highlighted */}
        <div className="my-8 bg-red-950/30 border border-red-800/50 rounded-2xl p-5 space-y-2">
          <div className="flex items-center gap-2 text-red-400 font-bold text-sm">
            <AlertTriangle size={15} /> No-Refund Policy
          </div>
          <p className="text-sm text-red-300/80 leading-relaxed">
            <strong className="text-red-300">All wallet top-ups are non-refundable.</strong> Once funds are added to your MLDock.io wallet they cannot be withdrawn or refunded under any circumstances, including but not limited to:
          </p>
          <ul className="space-y-1.5">
            <Li>Unused wallet balance</Li>
            <Li>Failed or cancelled training jobs where GPU time was already consumed</Li>
            <Li>Account termination or suspension for policy violations</Li>
            <Li>Dissatisfaction with model results or training outcomes</Li>
            <Li>Accidental top-up of incorrect amounts</Li>
          </ul>
          <p className="text-sm text-red-300/80 leading-relaxed">
            Wallet credits have no cash value and are not transferable between accounts. In the event of a confirmed
            Paystack payment error (i.e. money deducted but wallet not credited), contact us within 14 days with your
            Paystack reference and we will investigate and credit your wallet if the payment is verified.
          </p>
        </div>

        <H2>4. Trainer Plugins &amp; Model Artifacts</H2>
        <P>You retain full ownership of any trainer code you upload and any models you train. By uploading trainer code you grant us a limited licence to execute that code on your behalf on cloud GPU infrastructure. We do not claim any intellectual property rights over your models or training data.</P>
        <P>You are solely responsible for ensuring your trainer code and training data do not infringe third-party intellectual property rights or violate applicable laws.</P>

        <H2>5. Service Availability</H2>
        <P>We do not guarantee 100% uptime. GPU availability depends on third-party providers (RunPod). We are not liable for job failures caused by upstream provider outages. In such cases, any reserved wallet balance will be released back to your available balance.</P>

        <H2>6. Acceptable Use</H2>
        <P>GPU resources are shared infrastructure. Jobs that consume excessive resources beyond what was estimated, run for more than 24 hours continuously, or are found to be mining cryptocurrency will be terminated without warning and no wallet credit will be issued.</P>

        <H2>7. Termination</H2>
        <P>We reserve the right to suspend or terminate your account at any time for violations of these Terms. Upon termination, access to your models, jobs, and API keys will be revoked. Wallet balances are non-refundable on termination for policy violations.</P>

        <H2>8. Limitation of Liability</H2>
        <P>To the maximum extent permitted by law, Kreateyou Technologies Ltd shall not be liable for any indirect, incidental, special, consequential, or punitive damages, including loss of profits, data, or models arising from your use of MLDock.io. Our total liability to you for any claim shall not exceed the amount you paid to us in the 30 days prior to the claim.</P>

        <H2>9. Indemnification</H2>
        <P>You agree to indemnify and hold harmless Kreateyou Technologies Ltd and its affiliates from any claims, damages, or expenses (including legal fees) arising from your use of the platform, your trainer code, your training data, or your violation of these Terms.</P>

        <H2>10. Governing Law</H2>
        <P>These Terms are governed by the laws of Kenya. Any disputes shall be resolved in the courts of Nairobi, Kenya.</P>

        <H2>11. Changes to These Terms</H2>
        <P>We may update these Terms at any time. We will notify registered users by email at least 14 days before material changes take effect. Continued use after the effective date constitutes acceptance of the revised Terms.</P>

        <H2>12. Contact</H2>
        <P>For legal enquiries: <span className="text-brand-400">legal@kreateyou.com</span></P>
      </div>
      <PageFooter onPrivacy={onPrivacy} />
    </div>
  )
}
