import React, { useState } from 'react';
import { DownloadCloud, RefreshCw, Sparkles, X } from 'lucide-react';
import { applyNativeWebUpdate, isNativeAndroidApp } from '../lib/floatingBubble';
import { useTranslation } from '../lib/i18n';
import { triggerDirectApkDownload, type OtaUpdateInfo } from '../lib/otaUpdate';

interface OtaUpdateModalProps {
  updateInfo: OtaUpdateInfo;
  siteName?: string;
  mandatory?: boolean;
  onClose: () => void;
}

export const OtaUpdateModal: React.FC<OtaUpdateModalProps> = ({
  updateInfo,
  siteName = 'Go Driver Mobilidade',
  mandatory = false,
  onClose,
}) => {
  const { t } = useTranslation();
  const [applyingWeb, setApplyingWeb] = useState(false);
  const [downloadingApk, setDownloadingApk] = useState(false);

  const hasWebUpdate = Boolean(updateInfo.webUrl && updateInfo.webUrl.startsWith('http'));
  const isDirectApk =
    updateInfo.apkUrl.startsWith('http://') ||
    updateInfo.apkUrl.startsWith('https://') ||
    updateInfo.apkUrl.toLowerCase().includes('.apk');

  const handleDownloadApk = async (url: string) => {
    setDownloadingApk(true);
    try {
      const slug =
        siteName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '') || 'godriver-mobilidade';
      await triggerDirectApkDownload(url, `${slug}-v${updateInfo.latestVersion}.apk`);
    } finally {
      setDownloadingApk(false);
      onClose();
    }
  };

  const handleApplyLiveWeb = async () => {
    if (hasWebUpdate && updateInfo.webUrl && isNativeAndroidApp()) {
      setApplyingWeb(true);
      try {
        const applied = await applyNativeWebUpdate(updateInfo.webUrl);
        if (applied) {
          onClose();
          return;
        }
      } finally {
        setApplyingWeb(false);
      }
    }
    window.location.reload();
  };

  return (
    <div className="fixed inset-0 z-[1400] flex items-end sm:items-center justify-center bg-[#0F172A]/65 p-0 sm:p-4">
      <div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-white p-6 shadow-2xl space-y-4 border border-[#E2E8F0]">
        <div className="flex items-start justify-between gap-3 border-b border-[#E2E8F0] pb-3">
          <div className="flex items-center gap-3">
            <div className="aurora-accent-flow flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-white shadow-sm">
              <DownloadCloud className="h-6 w-6" />
            </div>
            <div>
              <span className="inline-flex items-center gap-1 rounded-full bg-[#EFF6FF] border border-[#BFDBFE] px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-[#2563EB]">
                <Sparkles className="h-3 w-3" /> {siteName}
              </span>
              <h3 className="mt-1 font-display text-lg font-extrabold text-[#0F172A]">
                {mandatory ? t.ota_mandatory_title : t.ota_new_update}
              </h3>
            </div>
          </div>
          {!mandatory && (
            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-[#F1F5F9] border border-[#E2E8F0] text-[#0F172A]"
              aria-label={t.close}
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <p className="text-sm font-medium text-[#475569] leading-relaxed">
          <strong className="text-[#0F172A]">{siteName}</strong> ·{' '}
          {mandatory ? t.ota_mandatory_desc : t.ota_optional_desc}
        </p>

        <div className="grid grid-cols-2 gap-2.5 rounded-2xl bg-[#F4F6F9] p-3.5 border border-[#E2E8F0]">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#475569]">
              {t.app_version_label}
            </p>
            <p className="font-mono-num text-sm font-extrabold text-[#0F172A]">
              v{updateInfo.currentVersion}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#2563EB]">
              {t.ota_new_update}
            </p>
            <p className="font-mono-num text-sm font-extrabold text-[#2563EB]">
              v{updateInfo.latestVersion}
            </p>
          </div>
        </div>

        {updateInfo.releaseNotes && (
          <div className="rounded-2xl bg-[#EFF6FF] border border-[#BFDBFE] p-3.5">
            <p className="text-[11px] font-extrabold uppercase tracking-wider text-[#1D4ED8] mb-1">
              {t.ota_whats_new}
            </p>
            <p className="text-xs text-[#1E3A8A] whitespace-pre-line leading-relaxed">
              {updateInfo.releaseNotes}
            </p>
          </div>
        )}

        <div className="flex flex-col gap-2 pt-1">
          {mandatory ? (
            <>
              {hasWebUpdate ? (
                <button
                  type="button"
                  disabled={applyingWeb}
                  onClick={handleApplyLiveWeb}
                  className="aurora-accent-flow flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl text-sm font-extrabold text-white shadow-sm active:scale-[0.98] transition"
                >
                  <RefreshCw className={`h-5 w-5 ${applyingWeb ? 'animate-spin' : ''}`} />
                  <span>{t.ota_apply_web}</span>
                </button>
              ) : isDirectApk ? (
                <button
                  type="button"
                  disabled={downloadingApk}
                  onClick={() => handleDownloadApk(updateInfo.apkUrl)}
                  className="aurora-accent-flow flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl text-sm font-extrabold text-white shadow-sm active:scale-[0.98] transition"
                >
                  <DownloadCloud className="h-5 w-5" />
                  <span>{downloadingApk ? 'Baixando APK...' : t.ota_download_now}</span>
                </button>
              ) : (
                <button
                  type="button"
                  disabled={applyingWeb}
                  onClick={handleApplyLiveWeb}
                  className="aurora-accent-flow flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl text-sm font-extrabold text-white shadow-sm active:scale-[0.98] transition"
                >
                  <RefreshCw className={`h-5 w-5 ${applyingWeb ? 'animate-spin' : ''}`} />
                  <span>{t.ota_apply_web}</span>
                </button>
              )}
              {hasWebUpdate && isDirectApk && updateInfo.apkUrl !== updateInfo.webUrl && (
                <button
                  type="button"
                  disabled={downloadingApk}
                  onClick={() => handleDownloadApk(updateInfo.apkUrl)}
                  className="flex min-h-[46px] w-full items-center justify-center gap-2 rounded-2xl border border-[#E2E8F0] bg-[#F1F5F9] text-xs font-extrabold text-[#0F172A] active:scale-[0.98] transition"
                >
                  <DownloadCloud className="h-4 w-4" />
                  <span>{downloadingApk ? 'Baixando APK...' : `${t.ota_download_now} (.apk)`}</span>
                </button>
              )}
            </>
          ) : (
            <>
              {hasWebUpdate && (
                <button
                  type="button"
                  disabled={applyingWeb}
                  onClick={handleApplyLiveWeb}
                  className="aurora-accent-flow flex min-h-[50px] w-full items-center justify-center gap-2 rounded-2xl text-sm font-extrabold text-white shadow-sm active:scale-[0.98] transition"
                >
                  <RefreshCw className={`h-5 w-5 ${applyingWeb ? 'animate-spin' : ''}`} />
                  <span>{t.ota_apply_web}</span>
                </button>
              )}
              {isDirectApk ? (
                <button
                  type="button"
                  disabled={downloadingApk}
                  onClick={() => handleDownloadApk(updateInfo.apkUrl)}
                  className={`flex min-h-[50px] w-full items-center justify-center gap-2 rounded-2xl text-sm font-extrabold shadow-sm active:scale-[0.98] transition ${
                    hasWebUpdate
                      ? 'border border-[#E2E8F0] bg-[#F1F5F9] text-[#0F172A]'
                      : 'aurora-accent-flow text-white'
                  }`}
                >
                  <DownloadCloud className="h-5 w-5" />
                  <span>{downloadingApk ? 'Baixando APK...' : t.ota_download_now}</span>
                </button>
              ) : !hasWebUpdate ? (
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="aurora-accent-flow flex min-h-[50px] w-full items-center justify-center gap-2 rounded-2xl text-sm font-extrabold text-white shadow-sm active:scale-[0.98] transition"
                >
                  <RefreshCw className="h-5 w-5" />
                  <span>{t.ota_apply_web}</span>
                </button>
              ) : null}
              <button
                type="button"
                onClick={onClose}
                className="min-h-[42px] w-full rounded-xl text-xs font-bold text-[#475569] hover:text-[#0F172A]"
              >
                {t.ota_later}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
