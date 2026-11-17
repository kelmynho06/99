import React from 'react';
import { DownloadCloud, ExternalLink, RefreshCw, Sparkles, X } from 'lucide-react';
import type { OtaUpdateInfo } from '../lib/otaUpdate';

interface OtaUpdateModalProps {
  updateInfo: OtaUpdateInfo;
  siteName?: string;
  onClose: () => void;
}

export const OtaUpdateModal: React.FC<OtaUpdateModalProps> = ({
  updateInfo,
  siteName = '66 Mobilidade',
  onClose,
}) => {
  const isDirectApk =
    updateInfo.apkUrl.toLowerCase().endsWith('.apk') ||
    updateInfo.apkUrl.toLowerCase().includes('apk') ||
    updateInfo.apkUrl.startsWith('http');

  return (
    <div className="fixed inset-0 z-[1400] flex items-end sm:items-center justify-center bg-black/75 p-0 sm:p-4">
      <div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-white dark:bg-neutral-900 p-6 shadow-2xl space-y-4 border border-neutral-200 dark:border-neutral-800">
        <div className="flex items-start justify-between gap-3 border-b border-neutral-100 dark:border-neutral-800 pb-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#FFD100] text-neutral-950 shadow-sm">
              <DownloadCloud className="h-6 w-6" />
            </div>
            <div>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 dark:bg-emerald-950/60 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                <Sparkles className="h-3 w-3" /> Atualização OTA
              </span>
              <h3 className="mt-1 font-display text-lg font-extrabold text-neutral-950 dark:text-white">
                Nova atualização disponível!
              </h3>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300"
            aria-label="Fechar aviso de atualização"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="text-sm font-medium text-neutral-700 dark:text-neutral-200 leading-relaxed">
          Uma nova versão do <strong>{siteName}</strong> está disponível. Deseja atualizar agora?
        </p>

        <div className="grid grid-cols-2 gap-2.5 rounded-2xl bg-neutral-50 dark:bg-neutral-800/70 p-3.5 border border-neutral-200 dark:border-neutral-700">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
              Versão Atual
            </p>
            <p className="font-mono-num text-sm font-extrabold text-neutral-900 dark:text-neutral-100">
              v{updateInfo.currentVersion}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
              Nova Versão
            </p>
            <p className="font-mono-num text-sm font-extrabold text-emerald-700 dark:text-emerald-300">
              v{updateInfo.latestVersion}
            </p>
          </div>
        </div>

        {updateInfo.releaseNotes && (
          <div className="rounded-2xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 p-3.5">
            <p className="text-[11px] font-extrabold uppercase tracking-wider text-amber-900 dark:text-amber-300 mb-1">
              Novidades desta versão
            </p>
            <p className="text-xs text-amber-950 dark:text-amber-100 whitespace-pre-line leading-relaxed">
              {updateInfo.releaseNotes}
            </p>
          </div>
        )}

        <div className="flex flex-col gap-2 pt-1">
          {isDirectApk ? (
            <a
              href={updateInfo.apkUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={onClose}
              className="flex min-h-[50px] w-full items-center justify-center gap-2 rounded-2xl bg-[#FFD100] text-sm font-extrabold text-neutral-950 shadow-sm active:scale-[0.98] transition"
            >
              <DownloadCloud className="h-5 w-5" />
              <span>Baixar e Instalar APK Agora</span>
              <ExternalLink className="h-4 w-4" />
            </a>
          ) : (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="flex min-h-[50px] w-full items-center justify-center gap-2 rounded-2xl bg-[#FFD100] text-sm font-extrabold text-neutral-950 shadow-sm active:scale-[0.98] transition"
            >
              <RefreshCw className="h-5 w-5" />
              <span>Atualizar Aplicativo Agora</span>
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="min-h-[42px] w-full rounded-xl text-xs font-bold text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white"
          >
            Depois
          </button>
        </div>
      </div>
    </div>
  );
};
