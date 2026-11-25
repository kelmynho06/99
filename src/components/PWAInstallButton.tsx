import React, { useState } from 'react';
import {
  Apple,
  CheckCircle2,
  ChevronRight,
  Download,
  Info,
  Share,
  Smartphone,
  WifiOff,
  X,
} from 'lucide-react';
import { useOnlineStatus, usePWAInstall } from '../hooks/usePWAInstall';
import { isNativeAndroidApp } from '../lib/floatingBubble';
import { useTranslation } from '../lib/i18n';
import { triggerDirectApkDownload } from '../lib/otaUpdate';

interface PWAInstallButtonProps {
  variant?: 'compact' | 'menu' | 'settings';
  apkUrl?: string | null;
  siteName?: string;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({
  variant = 'menu',
  apkUrl,
  siteName = 'Go Driver Mobilidade',
}) => {
  const { t } = useTranslation();
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [modalOpen, setModalOpen] = useState(false);
  const [downloadingApk, setDownloadingApk] = useState(false);
  const [apkFeedback, setApkFeedback] = useState<string | null>(null);

  // Hide download/install options completely once the app (APK or PWA) is installed
  if (isNativeAndroidApp() || isInstalled) return null;

  const attachedApkUrl =
    apkUrl && (apkUrl.startsWith('http://') || apkUrl.startsWith('https://'))
      ? apkUrl.trim()
      : null;

  const handleDirectApkDownload = async () => {
    if (!attachedApkUrl) {
      setApkFeedback(
        'Nenhum arquivo .APK foi anexado pelo administrador ainda. Utilize a opção Instalar PWA abaixo.'
      );
      return;
    }
    setDownloadingApk(true);
    setApkFeedback(null);
    try {
      const slug =
        siteName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '') || 'godriver-mobilidade';
      await triggerDirectApkDownload(attachedApkUrl, `${slug}.apk`);
      setApkFeedback('Download do APK iniciado automaticamente no seu dispositivo!');
    } catch {
      setApkFeedback('Não foi possível iniciar o download agora. Tente novamente.');
    } finally {
      setDownloadingApk(false);
    }
  };

  return (
    <>
      {variant === 'settings' ? (
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="flex min-h-[54px] w-full items-center justify-between px-4 text-left hover:bg-[#F4F6F9] transition"
        >
          <span className="flex items-center gap-3">
            <span className="aurora-accent-flow flex h-8 w-8 items-center justify-center rounded-xl text-white shrink-0">
              <Smartphone className="h-4 w-4" />
            </span>
            <span>
              <span className="block text-sm font-extrabold text-[#0F172A]">
                {t.install_app_label}
              </span>
              <span className="block text-[11px] text-[#475569]">
                {t.install_app_sub}
              </span>
            </span>
          </span>
          <ChevronRight className="h-4 w-4 text-[#64748B] shrink-0" />
        </button>
      ) : variant === 'menu' ? (
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="aurora-accent-flow flex w-full items-center justify-between rounded-2xl px-4 py-3 text-sm font-extrabold text-white shadow-md transition hover:brightness-95 active:scale-[0.98]"
        >
          <span className="flex items-center gap-2.5 min-w-0">
            <Smartphone className="h-4 w-4 shrink-0" />
            <span className="truncate">{t.install_app_short}</span>
          </span>
          <span className="rounded-lg bg-white/20 px-2 py-0.5 text-[10px] font-extrabold text-white shrink-0">
            APK / PWA
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="aurora-accent-flow flex min-h-[42px] items-center gap-2 rounded-full px-3.5 py-2 text-xs font-extrabold text-white shadow-lg transition hover:brightness-95 whitespace-nowrap shrink-0"
        >
          <Download className="h-4 w-4" />
          <span>{t.install_app_android}</span>
        </button>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-[1300] flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4 backdrop-blur-xs">
          <div className="w-full max-w-md max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-white p-5 sm:p-6 shadow-2xl border border-[#E2E8F0] space-y-4 text-[#0F172A]">
            <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-3">
              <div className="flex items-center gap-2.5">
                <div className="aurora-accent-flow flex h-10 w-10 items-center justify-center rounded-2xl text-white shadow-xs">
                  <Smartphone className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-display text-lg font-extrabold text-[#0F172A] leading-tight">
                    {t.install_app_short} · {siteName}
                  </h3>
                  <p className="text-[11px] font-semibold text-[#475569]">
                    {t.install_choose_option}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-[#F1F5F9] text-[#0F172A] hover:bg-[#E2E8F0]"
                aria-label={t.close}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Difference Banner: Android APK vs iOS PWA */}
            <div className="flex items-start gap-2.5 rounded-2xl border border-[#BFDBFE] bg-[#EFF6FF] p-3.5 text-xs text-[#1E3A8A] leading-relaxed">
              <Info className="h-4 w-4 shrink-0 text-[#2563EB] mt-0.5" />
              <p>
                <strong>Android vs iPhone (iOS):</strong> O instalador nativo{' '}
                <strong>(.APK)</strong> é exclusivo para celulares <strong>Android</strong>. Se o
                seu aparelho for <strong>iPhone / iOS</strong>, utilize a opção{' '}
                <strong>Instalar PWA</strong> abaixo para rodar em tela cheia direto da tela
                inicial.
              </p>
            </div>

            {/* 1. Direct Android APK Download (no external redirect) */}
            <div className="rounded-2xl border-2 border-[#2563EB] bg-[#F4F6F9] p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <span className="inline-flex items-center gap-1 rounded-full bg-[#2563EB] px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-white">
                    {attachedApkUrl ? 'Download Direto · Android' : 'Android (.APK)'}
                  </span>
                  <h4 className="mt-1 font-display text-base font-extrabold text-[#0F172A]">
                    Aplicativo Android (.APK)
                  </h4>
                </div>
              </div>
              <p className="text-xs text-[#475569] leading-relaxed">
                {attachedApkUrl
                  ? `Clique abaixo para baixar o arquivo .APK oficial do ${siteName} diretamente para o seu celular, sem sair do aplicativo.`
                  : 'Use o aplicativo web (PWA) abaixo ou aguarde o administrador anexar o pacote .APK oficial.'}
              </p>

              <button
                type="button"
                disabled={downloadingApk || !attachedApkUrl}
                onClick={handleDirectApkDownload}
                className={`flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl text-sm font-extrabold shadow-md active:scale-[0.98] transition ${
                  attachedApkUrl
                    ? 'aurora-accent-flow text-white'
                    : 'bg-[#E2E8F0] text-[#475569] cursor-not-allowed'
                }`}
              >
                <Download className="h-4 w-4" />
                <span>
                  {downloadingApk
                    ? 'Baixando APK...'
                    : attachedApkUrl
                    ? t.install_apk_btn
                    : 'APK ainda não anexado'}
                </span>
              </button>

              {apkFeedback && (
                <p className="flex items-center gap-1.5 text-[11px] font-bold text-[#059669]">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                  <span>{apkFeedback}</span>
                </p>
              )}
            </div>

            {/* 2. PWA & iOS Tutorial */}
            <div className="rounded-2xl border border-[#E2E8F0] bg-white p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Apple className="h-5 w-5 text-[#0F172A] shrink-0" />
                  <div>
                    <h4 className="font-display text-sm font-extrabold text-[#0F172A]">
                      Instalar PWA (iPhone iOS &amp; Navegador)
                    </h4>
                    <p className="text-[11px] text-[#475569]">
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
                  className="flex min-h-[46px] w-full items-center justify-center gap-2 rounded-2xl border-2 border-[#2563EB] bg-white text-xs font-extrabold text-[#2563EB] hover:bg-[#EFF6FF] active:scale-[0.98] transition"
                >
                  <Download className="h-4 w-4" />
                  <span>{t.install_pwa_btn}</span>
                </button>
              )}

              <div className="rounded-2xl bg-[#F4F6F9] p-3.5 space-y-2 border border-[#E2E8F0]">
                <p className="text-xs font-extrabold text-[#0F172A] flex items-center gap-1.5">
                  <Share className="h-3.5 w-3.5 text-[#2563EB]" />
                  Tutorial para iPhone / iOS (Safari):
                </p>
                <ol className="space-y-1.5 text-xs text-[#475569] leading-relaxed">
                  <li>
                    <strong className="text-[#0F172A]">1.</strong> Abra este site no navegador{' '}
                    <strong className="text-[#0F172A]">Safari</strong> do seu iPhone.
                  </li>
                  <li>
                    <strong className="text-[#0F172A]">2.</strong> Toque no botão{' '}
                    <strong className="text-[#0F172A]">Compartilhar</strong> (quadrado com seta
                    para cima) na barra inferior.
                  </li>
                  <li>
                    <strong className="text-[#0F172A]">3.</strong> Role para baixo e toque em{' '}
                    <strong className="text-[#0F172A]">Adicionar à Tela de Início</strong>.
                  </li>
                  <li>
                    <strong className="text-[#0F172A]">4.</strong> Toque em{' '}
                    <strong className="text-[#0F172A]">Adicionar</strong> no canto superior direito
                    para criar o atalho do app.
                  </li>
                </ol>
                {!isIOS && (
                  <p className="pt-1 text-[11px] text-[#475569]">
                    No Chrome/Android, você também pode tocar nos 3 pontinhos do navegador →{' '}
                    <strong className="text-[#0F172A]">Instalar aplicativo</strong>.
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
  const { t } = useTranslation();
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div className="fixed top-16 left-1/2 z-[1100] -translate-x-1/2 flex items-center gap-2 rounded-full bg-white border border-[#E2E8F0] px-4 py-2 text-xs font-semibold text-[#0F172A] shadow-xl">
      <WifiOff className="h-4 w-4 shrink-0 text-[#2563EB]" />
      <span>{t.offline_cached}</span>
    </div>
  );
};
