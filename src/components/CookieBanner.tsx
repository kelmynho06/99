import React, { useState } from 'react';
import { Cookie, ShieldCheck } from 'lucide-react';
import { getCookieConsent, setCookieConsent } from '../lib/userPrefs';
import { LegalDocsModal } from './LegalDocsModal';

interface CookieBannerProps {
  siteName?: string;
}

export const CookieBanner: React.FC<CookieBannerProps> = ({ siteName = 'Velo99' }) => {
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
      <div className="fixed bottom-3 left-3 right-3 z-[1250] mx-auto max-w-2xl rounded-3xl border border-neutral-200 bg-white p-4 shadow-2xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[#FFD100] text-neutral-950">
              <Cookie className="h-5 w-5" />
            </div>
            <div className="text-xs text-neutral-700 leading-relaxed">
              <p className="font-extrabold text-neutral-950 flex items-center gap-1.5">
                Cookies e Privacidade ({siteName})
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
              </p>
              <p className="mt-0.5">
                Usamos cookies essenciais e armazenamento local para manter sua sessão, mapa em tempo
                real e preferências de voz/notificações no site e no aplicativo Android.{' '}
                <button
                  type="button"
                  onClick={() => setShowDocs(true)}
                  className="font-extrabold text-neutral-950 underline"
                >
                  Ler Política de Cookies e Segurança
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
              className="min-h-[40px] rounded-xl border border-neutral-300 bg-neutral-50 px-3 text-xs font-bold text-neutral-800 hover:bg-neutral-100"
            >
              Essenciais
            </button>
            <button
              type="button"
              onClick={() => {
                setCookieConsent('all');
                setChoice('all');
              }}
              className="min-h-[40px] rounded-xl bg-neutral-950 px-4 text-xs font-extrabold text-[#FFD100] hover:bg-neutral-800"
            >
              Aceitar Tudo
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
