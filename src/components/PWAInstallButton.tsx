import React, { useState } from 'react';
import { Download, Smartphone, WifiOff, X } from 'lucide-react';
import { useOnlineStatus, usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC<{ variant?: 'compact' | 'menu' }> = ({
  variant = 'compact',
}) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) return null;

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className={
          variant === 'menu'
            ? 'flex w-full items-center justify-between rounded-2xl bg-[#FFCC00] px-4 py-3 text-sm font-bold text-neutral-950 transition active:scale-[0.98]'
            : 'flex min-h-[44px] items-center gap-2 rounded-full bg-neutral-950 px-4 py-2 text-xs font-bold text-[#FFCC00] shadow-lg transition hover:bg-neutral-800 whitespace-nowrap shrink-0'
        }
      >
        <span className="flex items-center gap-2">
          <Download className="h-4 w-4" />
          Instalar App (PWA)
        </span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className={
            variant === 'menu'
              ? 'flex w-full items-center justify-between rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm font-semibold text-neutral-900 transition hover:bg-neutral-100'
              : 'flex min-h-[44px] items-center gap-2 rounded-full border border-neutral-300 bg-white/95 px-3.5 py-2 text-xs font-semibold text-neutral-900 shadow-sm backdrop-blur whitespace-nowrap shrink-0'
          }
        >
          <Smartphone className="h-4 w-4" />
          Instalar no iPhone
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
            <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-neutral-950">Instalar no iPhone / iPad</h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100 text-neutral-700"
                  aria-label="Fechar"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <ol className="mt-4 space-y-2.5 text-sm text-neutral-700">
                <li>
                  1. Toque no botão <strong>Compartilhar</strong> na barra inferior do Safari.
                </li>
                <li>
                  2. Role para baixo e toque em <strong>Adicionar à Tela de Início</strong>.
                </li>
                <li>
                  3. Confirme tocando em <strong>Adicionar</strong>.
                </li>
              </ol>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-5 min-h-[44px] w-full rounded-2xl bg-[#FFCC00] font-bold text-neutral-950"
              >
                Entendi
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div className="fixed top-16 left-1/2 z-[1100] -translate-x-1/2 flex items-center gap-2 rounded-full bg-neutral-950 px-4 py-2 text-xs font-semibold text-[#FFCC00] shadow-xl">
      <WifiOff className="h-4 w-4 shrink-0" />
      <span>Sem conexão — exibindo dados em cache</span>
    </div>
  );
};
