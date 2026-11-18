import React, { useState } from 'react';
import {
  Apple,
  ChevronRight,
  Download,
  ExternalLink,
  Info,
  Share,
  Smartphone,
  WifiOff,
  X,
} from 'lucide-react';
import { useOnlineStatus, usePWAInstall } from '../hooks/usePWAInstall';
import { isNativeAndroidApp } from '../lib/floatingBubble';

const DEFAULT_APK_URL =
  'https://github.com/kelmynho06/99/releases/latest/download/app-debug.apk';

interface PWAInstallButtonProps {
  variant?: 'compact' | 'menu' | 'settings';
  apkUrl?: string | null;
  siteName?: string;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({
  variant = 'menu',
  apkUrl,
  siteName = '66 Mobilidade',
}) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [modalOpen, setModalOpen] = useState(false);

  // Inside the native Android APK there is no need to show an installer button
  if (isNativeAndroidApp()) return null;

  const resolvedApkUrl =
    apkUrl && (apkUrl.startsWith('http://') || apkUrl.startsWith('https://'))
      ? apkUrl
      : DEFAULT_APK_URL;

  return (
    <>
      {variant === 'settings' ? (
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="flex min-h-[54px] w-full items-center justify-between px-4 text-left hover:bg-neutral-50 dark:hover:bg-neutral-800 transition"
        >
          <span className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#FFD100] text-neutral-950 shrink-0">
              <Smartphone className="h-4 w-4" />
            </span>
            <span>
              <span className="block text-sm font-extrabold text-neutral-950 dark:text-white">
                Instalar Aplicativo (Android APK &amp; iOS PWA)
              </span>
              <span className="block text-[11px] text-neutral-500 dark:text-neutral-400">
                Baixe o APK no Android ou siga o tutorial PWA no iPhone
              </span>
            </span>
          </span>
          <ChevronRight className="h-4 w-4 text-neutral-400 shrink-0" />
        </button>
      ) : variant === 'menu' ? (
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="flex w-full items-center justify-between rounded-2xl bg-[#FFD100] px-4 py-3 text-sm font-extrabold text-neutral-950 shadow-md transition hover:brightness-95 active:scale-[0.98]"
        >
          <span className="flex items-center gap-2.5 min-w-0">
            <Smartphone className="h-4 w-4 shrink-0" />
            <span className="truncate">Instalar Aplicativo</span>
          </span>
          <span className="rounded-lg bg-neutral-950 px-2 py-0.5 text-[10px] font-extrabold text-[#FFD100] shrink-0">
            APK / PWA
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="flex min-h-[42px] items-center gap-2 rounded-full bg-neutral-950 px-3.5 py-2 text-xs font-extrabold text-[#FFD100] shadow-lg transition hover:bg-neutral-800 whitespace-nowrap shrink-0"
        >
          <Download className="h-4 w-4" />
          <span>Instalar App (Android)</span>
        </button>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-[1300] flex items-end sm:items-center justify-center bg-black/75 p-0 sm:p-4 backdrop-blur-xs">
          <div className="w-full max-w-md max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-white dark:bg-neutral-900 p-5 sm:p-6 shadow-2xl border border-neutral-200 dark:border-neutral-800 space-y-4 text-neutral-950 dark:text-neutral-100">
            <div className="flex items-center justify-between border-b border-neutral-100 dark:border-neutral-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#FFD100] text-neutral-950 shadow-xs">
                  <Smartphone className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-display text-lg font-extrabold text-neutral-950 dark:text-white leading-tight">
                    Instalar {siteName}
                  </h3>
                  <p className="text-[11px] font-semibold text-neutral-500 dark:text-neutral-400">
                    Escolha a opção ideal para o seu celular
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200"
                aria-label="Fechar"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Difference Banner: Android APK vs iOS PWA */}
            <div className="flex items-start gap-2.5 rounded-2xl border border-amber-300 dark:border-amber-800/70 bg-amber-50 dark:bg-amber-950/30 p-3.5 text-xs text-amber-950 dark:text-amber-100 leading-relaxed">
              <Info className="h-4 w-4 shrink-0 text-amber-700 dark:text-[#FFD100] mt-0.5" />
              <p>
                <strong>Android vs iPhone (iOS):</strong> No momento, o instalador nativo{' '}
                <strong>(.APK)</strong> está disponível apenas para celulares{' '}
                <strong>Android</strong> (com suporte a balão flutuante e GPS em segundo plano). Se
                o seu celular for <strong>iPhone / iOS</strong>, utilize a opção{' '}
                <strong>Instalar PWA</strong> abaixo para rodar em tela cheia direto da tela inicial.
              </p>
            </div>

            {/* 1. Android APK Download */}
            <div className="rounded-2xl border-2 border-[#FFD100] bg-neutral-50 dark:bg-neutral-800/70 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <span className="inline-flex items-center gap-1 rounded-full bg-[#FFD100] px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-neutral-950">
                    Recomendado · Android
                  </span>
                  <h4 className="mt-1 font-display text-base font-extrabold text-neutral-950 dark:text-white">
                    Aplicativo Android (.APK)
                  </h4>
                </div>
              </div>
              <p className="text-xs text-neutral-600 dark:text-neutral-300 leading-relaxed">
                Baixe e instale o app oficial completo para Android com notificações prioritárias e
                ícone 66 na tela inicial.
              </p>
              <a
                href={resolvedApkUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl bg-neutral-950 dark:bg-[#FFD100] text-sm font-extrabold text-[#FFD100] dark:text-neutral-950 shadow-md active:scale-[0.98] transition"
              >
                <Download className="h-4 w-4" />
                <span>Baixar Aplicativo Android (APK)</span>
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>

            {/* 2. PWA & iOS Tutorial */}
            <div className="rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800/40 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Apple className="h-5 w-5 text-neutral-900 dark:text-white shrink-0" />
                  <div>
                    <h4 className="font-display text-sm font-extrabold text-neutral-950 dark:text-white">
                      Instalar PWA (iPhone iOS &amp; Navegador)
                    </h4>
                    <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                      Funciona em iPhone, iPad, Android e computador sem ocupar espaço
                    </p>
                  </div>
                </div>
              </div>

              {isInstallable && !isInstalled && (
                <button
                  type="button"
                  onClick={async () => {
                    await install();
                    setModalOpen(false);
                  }}
                  className="flex min-h-[46px] w-full items-center justify-center gap-2 rounded-2xl border-2 border-neutral-950 dark:border-[#FFD100] bg-white dark:bg-neutral-900 text-xs font-extrabold text-neutral-950 dark:text-[#FFD100] active:scale-[0.98] transition"
                >
                  <Download className="h-4 w-4" />
                  <span>Instalar App Web (PWA) Agora</span>
                </button>
              )}

              {isInstalled && (
                <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 px-3 py-2 text-xs font-bold text-emerald-800 dark:text-emerald-200">
                  PWA já instalado neste dispositivo!
                </div>
              )}

              <div className="rounded-2xl bg-neutral-50 dark:bg-neutral-900/70 p-3.5 space-y-2 border border-neutral-200/80 dark:border-neutral-700/80">
                <p className="text-xs font-extrabold text-neutral-950 dark:text-white flex items-center gap-1.5">
                  <Share className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                  Tutorial para iPhone / iOS (Safari):
                </p>
                <ol className="space-y-1.5 text-xs text-neutral-700 dark:text-neutral-300 leading-relaxed">
                  <li>
                    <strong>1.</strong> Abra este site no navegador <strong>Safari</strong> do seu
                    iPhone.
                  </li>
                  <li>
                    <strong>2.</strong> Toque no botão <strong>Compartilhar</strong> (quadrado com
                    seta para cima) na barra inferior.
                  </li>
                  <li>
                    <strong>3.</strong> Role para baixo e toque em{' '}
                    <strong>Adicionar à Tela de Início</strong>.
                  </li>
                  <li>
                    <strong>4.</strong> Toque em <strong>Adicionar</strong> no canto superior
                    direito para criar o atalho do app.
                  </li>
                </ol>
                {!isIOS && (
                  <p className="pt-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                    No Chrome/Android, você também pode tocar nos 3 pontinhos do navegador →{' '}
                    <strong>Instalar aplicativo</strong>.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
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
