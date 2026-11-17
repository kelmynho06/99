import React, { useState } from 'react';
import { Cookie, ShieldCheck } from 'lucide-react';
import { useTranslation } from '../lib/i18n';
import { getCookieConsent, setCookieConsent } from '../lib/userPrefs';
import { LegalDocsModal } from './LegalDocsModal';

interface CookieBannerProps {
  siteName?: string;
}

export const CookieBanner: React.FC<CookieBannerProps> = ({ siteName = '66 Mobilidade' }) => {
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
      <div className="fixed bottom-3 left-3 right-3 z-[1250] mx-auto max-w-2xl rounded-3xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 shadow-2xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[#FFD100] text-neutral-950">
              <Cookie className="h-5 w-5" />
            </div>
            <div className="text-xs text-neutral-700 dark:text-neutral-300 leading-relaxed">
              <p className="font-extrabold text-neutral-950 dark:text-white flex items-center gap-1.5">
                {t.cookies_notice_title} ({siteName})
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              </p>
              <p className="mt-0.5">
                Usamos cookies essenciais e armazenamento local para manter sua sessão, mapa em tempo
                real e preferências de idioma, tema e notificações no site e no aplicativo Android.{' '}
                <button
                  type="button"
                  onClick={() => setShowDocs(true)}
                  className="font-extrabold text-neutral-950 dark:text-[#FFD100] underline"
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
              className="min-h-[40px] rounded-xl border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 px-3 text-xs font-bold text-neutral-800 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-700"
            >
              Essenciais
            </button>
            <button
              type="button"
              onClick={() => {
                setCookieConsent('all');
                setChoice('all');
              }}
              className="min-h-[40px] rounded-xl bg-neutral-950 dark:bg-[#FFD100] px-4 text-xs font-extrabold text-[#FFD100] dark:text-neutral-950 hover:bg-neutral-800 dark:hover:bg-[#f5c400]"
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
