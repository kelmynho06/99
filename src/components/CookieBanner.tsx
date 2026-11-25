import React, { useState } from 'react';
import { Cookie, ShieldCheck } from 'lucide-react';
import { useTranslation } from '../lib/i18n';
import { getCookieConsent, setCookieConsent } from '../lib/userPrefs';
import { LegalDocsModal } from './LegalDocsModal';

interface CookieBannerProps {
  siteName?: string;
}

export const CookieBanner: React.FC<CookieBannerProps> = ({ siteName = 'Go Driver Mobilidade' }) => {
  const { t } = useTranslation();
  const [choice, setChoice] = useState<'all' | 'essential' | null>(() => getCookieConsent());
  const [showDocs, setShowDocs] = useState(false);

  if (choice !== null) {
    return showDocs ? (
      <LegalDocsModal
        initialTab="cookies"
        siteName={siteName}
        onClose={() => setShowDocs(false)}
      />
    ) : null;
  }

  return (
    <>
      <div className="fixed bottom-3 left-3 right-3 z-[1250] mx-auto max-w-2xl rounded-3xl border border-[#E2E8F0] bg-white p-4 shadow-2xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="aurora-accent-flow flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-white">
              <Cookie className="h-5 w-5" />
            </div>
            <div className="text-xs text-[#475569] leading-relaxed">
              <p className="font-extrabold text-[#0F172A] flex items-center gap-1.5">
                {t.cookies_notice_title} ({siteName})
                <ShieldCheck className="h-3.5 w-3.5 text-[#10B981]" />
              </p>
              <p className="mt-0.5">
                {t.cookies_notice_body}{' '}
                <button
                  type="button"
                  onClick={() => setShowDocs(true)}
                  className="font-extrabold text-[#2563EB] underline"
                >
                  {t.privacy_security}
                </button>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                setCookieConsent('essential');
                setChoice('essential');
              }}
              className="min-h-[40px] rounded-xl border border-[#E2E8F0] bg-[#F1F5F9] px-3 text-xs font-bold text-[#0F172A] hover:bg-[#E2E8F0]"
            >
              {t.cookies_essential_btn}
            </button>
            <button
              type="button"
              onClick={() => {
                setCookieConsent('all');
                setChoice('all');
              }}
              className="aurora-accent-flow min-h-[40px] rounded-xl px-4 text-xs font-extrabold text-white hover:opacity-95"
            >
              {t.accept_cookies_btn}
            </button>
          </div>
        </div>
      </div>

      {showDocs && (
        <LegalDocsModal
          initialTab="cookies"
          siteName={siteName}
          onClose={() => setShowDocs(false)}
        />
      )}
    </>
  );
};
