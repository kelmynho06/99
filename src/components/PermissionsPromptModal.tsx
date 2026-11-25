import React, { useEffect, useState } from 'react';
import {
  BatteryCharging,
  Bell,
  Camera,
  CheckCircle2,
  ChevronRight,
  MapPin,
  Mic,
  Phone,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  checkDevicePermissionsStatus,
  requestAllDevicePermissions,
  requestCameraPermission,
  requestLocationPermission,
  requestNotificationPermission,
} from '../lib/capacitorDevice';
import {
  getNativeBubblePermissions,
  isNativeAndroidApp,
  requestNativeBatteryOptimization,
  requestNativeOverlayPermission,
} from '../lib/floatingBubble';
import { useTranslation } from '../lib/i18n';
import { markPermissionsPromptSeen } from '../lib/userPrefs';
import type { DevicePermissionsState, PermissionGrantState } from '../types/mobility';

interface PermissionsPromptModalProps {
  siteName?: string;
  onClose: () => void;
}

function StatusBadge({
  state,
  labels,
}: {
  state: PermissionGrantState;
  labels: { granted: string; denied: string; pending: string };
}) {
  if (state === 'granted') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[#ECFDF5] px-2.5 py-0.5 text-[11px] font-extrabold text-[#059669] border border-[#A7F3D0]">
        <CheckCircle2 className="h-3 w-3" />
        {labels.granted}
      </span>
    );
  }
  if (state === 'denied') {
    return (
      <span className="rounded-full bg-red-50 px-2.5 py-0.5 text-[11px] font-extrabold text-red-700 border border-red-200">
        {labels.denied}
      </span>
    );
  }
  return (
    <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-extrabold text-amber-800 border border-amber-200">
      {labels.pending}
    </span>
  );
}

export const PermissionsPromptModal: React.FC<PermissionsPromptModalProps> = ({
  siteName = 'Go Driver Mobilidade',
  onClose,
}) => {
  const { t } = useTranslation();
  const badgeLabels = {
    granted: t.perm_granted,
    denied: t.perm_denied,
    pending: t.perm_pending,
  };
  const [step, setStep] = useState<0 | 1 | 2 | 3>(0);
  const [status, setStatus] = useState<DevicePermissionsState>({
    notifications: 'prompt',
    location: 'prompt',
    camera: 'prompt',
    microphone: 'prompt',
    photos: 'granted',
  });
  const [requesting, setRequesting] = useState(false);
  const [batteryDone, setBatteryDone] = useState(false);
  const [overlayDone, setOverlayDone] = useState(false);
  const isAndroidApk = isNativeAndroidApp();

  useEffect(() => {
    checkDevicePermissionsStatus().then(setStatus).catch(() => {});
    if (isAndroidApk) {
      getNativeBubblePermissions()
        .then((p) => {
          setOverlayDone(p.overlay);
          setBatteryDone(p.batteryIgnored);
        })
        .catch(() => {});
    }
  }, [isAndroidApk]);

  const refreshStatus = async () => {
    const next = await checkDevicePermissionsStatus();
    setStatus(next);
    if (isAndroidApk) {
      const bp = await getNativeBubblePermissions();
      setOverlayDone(bp.overlay);
      setBatteryDone(bp.batteryIgnored);
    }
  };

  const handleGrantAll = async () => {
    setRequesting(true);
    try {
      const next = await requestAllDevicePermissions();
      setStatus(next);
      if (isAndroidApk) {
        const bp = await getNativeBubblePermissions();
        if (!bp.overlay) {
          await requestNativeOverlayPermission();
        }
        if (!bp.batteryIgnored) {
          await requestNativeBatteryOptimization();
        }
        const bpAfter = await getNativeBubblePermissions();
        setOverlayDone(bpAfter.overlay);
        setBatteryDone(bpAfter.batteryIgnored);
      } else {
        setBatteryDone(true);
      }
      markPermissionsPromptSeen();
      onClose();
    } finally {
      setRequesting(false);
    }
  };

  const closeModal = () => {
    markPermissionsPromptSeen();
    onClose();
  };

  const stepsMeta = [
    { title: t.perm_step_push, icon: Bell, badge: status.notifications },
    { title: t.perm_step_gps, icon: MapPin, badge: status.location },
    { title: t.perm_step_cam, icon: Camera, badge: status.camera },
    { title: t.perm_step_battery, icon: BatteryCharging, badge: batteryDone ? ('granted' as const) : ('prompt' as const) },
  ];

  return (
    <div className="fixed inset-0 z-[1320] flex items-end sm:items-center justify-center bg-[#0F172A]/65 p-0 sm:p-4">
      <div className="w-full max-w-lg rounded-t-3xl sm:rounded-3xl bg-white p-6 shadow-2xl space-y-4 max-h-[92vh] overflow-y-auto border border-[#E2E8F0]">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-[#E2E8F0] pb-3">
          <div className="flex items-center gap-2.5">
            <div className="aurora-accent-flow flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-wider text-[#475569]">
                {step + 1}/4 · {t.permissions_btn} ({siteName})
              </p>
              <h3 className="font-display text-lg font-extrabold text-[#0F172A]">
                {stepsMeta[step].title}
              </h3>
            </div>
          </div>
          <button
            type="button"
            onClick={closeModal}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-[#F1F5F9] border border-[#E2E8F0] text-[#0F172A]"
            aria-label={t.close}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Step Indicator Dots */}
        <div className="grid grid-cols-4 gap-2">
          {stepsMeta.map((s, idx) => (
            <button
              key={s.title}
              type="button"
              onClick={() => setStep(idx as 0 | 1 | 2 | 3)}
              className={`rounded-xl py-2 px-1 text-center transition border ${
                step === idx
                  ? 'bg-[#2563EB] text-white border-[#2563EB]'
                  : 'bg-[#F4F6F9] text-[#475569] border-[#E2E8F0]'
              }`}
            >
              <p className="text-[10px] font-extrabold truncate">{idx + 1}. {s.title.split(' ')[0]}</p>
            </button>
          ))}
        </div>

        {/* Step 1: Notifications */}
        {step === 0 && (
          <div className="space-y-3 rounded-2xl border border-[#E2E8F0] bg-[#F4F6F9] p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
                  <Bell className="h-6 w-6" />
                </div>
                <div>
                  <h4 className="text-sm font-extrabold text-[#0F172A]">
                    {t.perm_push_title}
                  </h4>
                  <p className="mt-1 text-xs text-[#475569] leading-relaxed">
                    {t.perm_push_desc}
                  </p>
                </div>
              </div>
              <StatusBadge state={status.notifications} labels={badgeLabels} />
            </div>

            <button
              type="button"
              onClick={async () => {
                setRequesting(true);
                await requestNotificationPermission();
                await refreshStatus();
                setRequesting(false);
                setStep(1);
              }}
              disabled={requesting}
              className="flex min-h-[46px] w-full items-center justify-center gap-2 rounded-2xl bg-[#2563EB] text-xs font-extrabold text-white"
            >
              <Bell className="h-4 w-4" />
              {t.perm_push_btn}
            </button>
          </div>
        )}

        {/* Step 2: Always Location */}
        {step === 1 && (
          <div className="space-y-3 rounded-2xl border border-[#E2E8F0] bg-[#F4F6F9] p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#EFF6FF] text-[#2563EB] border border-[#BFDBFE]">
                  <MapPin className="h-6 w-6" />
                </div>
                <div>
                  <h4 className="text-sm font-extrabold text-[#0F172A]">
                    {t.perm_gps_title}
                  </h4>
                  <p className="mt-1 text-xs text-[#475569] leading-relaxed">
                    {t.perm_gps_desc}
                  </p>
                </div>
              </div>
              <StatusBadge state={status.location} labels={badgeLabels} />
            </div>

            <button
              type="button"
              onClick={async () => {
                setRequesting(true);
                await requestLocationPermission();
                await refreshStatus();
                setRequesting(false);
                setStep(2);
              }}
              disabled={requesting}
              className="flex min-h-[46px] w-full items-center justify-center gap-2 rounded-2xl bg-[#2563EB] text-xs font-extrabold text-white"
            >
              <MapPin className="h-4 w-4" />
              {t.perm_gps_btn}
            </button>
          </div>
        )}

        {/* Step 3: Camera & Gallery with automatic compression */}
        {step === 2 && (
          <div className="space-y-3 rounded-2xl border border-[#E2E8F0] bg-[#F4F6F9] p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#ECFDF5] text-[#059669] border border-[#A7F3D0]">
                  <Camera className="h-6 w-6" />
                </div>
                <div>
                  <h4 className="text-sm font-extrabold text-[#0F172A]">
                    {t.perm_cam_title}
                  </h4>
                  <p className="mt-1 text-xs text-[#475569] leading-relaxed">
                    {t.perm_cam_desc}
                  </p>
                </div>
              </div>
              <StatusBadge state={status.camera} labels={badgeLabels} />
            </div>

            <button
              type="button"
              onClick={async () => {
                setRequesting(true);
                await requestCameraPermission();
                await refreshStatus();
                setRequesting(false);
                setStep(3);
              }}
              disabled={requesting}
              className="flex min-h-[46px] w-full items-center justify-center gap-2 rounded-2xl bg-[#2563EB] text-xs font-extrabold text-white"
            >
              <Camera className="h-4 w-4" />
              {t.perm_cam_btn}
            </button>
          </div>
        )}

        {/* Step 4: Native Android Battery Optimization & Background Floating Bubble */}
        {step === 3 && (
          <div className="space-y-3 rounded-2xl border border-[#BFDBFE] bg-[#EFF6FF] p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="aurora-accent-flow flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-white">
                  <BatteryCharging className="h-6 w-6" />
                </div>
                <div>
                  <h4 className="text-sm font-extrabold text-[#0F172A]">
                    {t.perm_bat_title}
                  </h4>
                  <p className="mt-1 text-xs text-[#475569] leading-relaxed">
                    {t.perm_bat_desc} ({siteName})
                  </p>
                </div>
              </div>
              <StatusBadge state={overlayDone && batteryDone ? 'granted' : 'prompt'} labels={badgeLabels} />
            </div>

            {isAndroidApk ? (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={async () => {
                    const ok = await requestNativeOverlayPermission();
                    setOverlayDone(ok);
                  }}
                  className="flex min-h-[44px] w-full items-center justify-between rounded-xl bg-white border border-[#E2E8F0] px-3.5 text-xs font-extrabold text-[#0F172A]"
                >
                  <span>1. Permitir Balão Sobrepor Outros Apps</span>
                  <StatusBadge state={overlayDone ? 'granted' : 'prompt'} labels={badgeLabels} />
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const ok = await requestNativeBatteryOptimization();
                    setBatteryDone(ok);
                  }}
                  className="flex min-h-[44px] w-full items-center justify-between rounded-xl bg-white border border-[#E2E8F0] px-3.5 text-xs font-extrabold text-[#0F172A]"
                >
                  <span>2. Bateria Irrestrita (Economia Inteligente)</span>
                  <StatusBadge state={batteryDone ? 'granted' : 'prompt'} labels={badgeLabels} />
                </button>
              </div>
            ) : (
              <div className="rounded-xl bg-white border border-[#E2E8F0] p-3 space-y-2 text-xs">
                <div className="flex items-center gap-2 font-bold text-[#0F172A]">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#2563EB] text-white text-[10px]">1</span>
                  <span>No APK Android: Configurações &gt; Aplicativos &gt; {siteName}</span>
                </div>
                <div className="flex items-center gap-2 font-bold text-[#0F172A]">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#2563EB] text-white text-[10px]">2</span>
                  <span>Em Bateria, marque &ldquo;Irrestrito&rdquo; (Sem restrições)</span>
                </div>
                <div className="flex items-center gap-2 font-extrabold text-[#2563EB]">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#2563EB] text-white text-[10px]">3</span>
                  <span>Ative &ldquo;Sobrepor a outros apps&rdquo; para o balão em segundo plano</span>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between text-[11px] text-[#475569] px-1">
              <span className="inline-flex items-center gap-1">
                <Mic className="h-3.5 w-3.5 text-[#2563EB]" /> {t.perm_voice_ready}
              </span>
              <span className="inline-flex items-center gap-1">
                <Phone className="h-3.5 w-3.5 text-[#10B981]" /> {t.perm_call_ready}
              </span>
            </div>
          </div>
        )}

        {/* Navigation / Action Buttons */}
        <div className="flex flex-col gap-2 pt-1">
          {step < 3 ? (
            <div className="flex gap-2">
              <button
                type="button"
                disabled={requesting}
                onClick={handleGrantAll}
                className="aurora-accent-flow min-h-[48px] flex-1 rounded-2xl text-xs sm:text-sm font-extrabold text-white shadow-sm active:scale-[0.98] transition disabled:opacity-50"
              >
                {requesting ? t.saving : t.perm_activate_all}
              </button>
              <button
                type="button"
                onClick={() => setStep((prev) => Math.min(3, prev + 1) as 0 | 1 | 2 | 3)}
                className="flex min-h-[48px] items-center justify-center gap-1 rounded-2xl border border-[#E2E8F0] bg-[#F1F5F9] px-4 text-xs font-extrabold text-[#0F172A]"
              >
                <span>{t.perm_next}</span>
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={requesting}
              onClick={handleGrantAll}
              className="aurora-accent-flow min-h-[50px] w-full rounded-2xl text-sm font-extrabold text-white shadow-sm active:scale-[0.98] transition disabled:opacity-50"
            >
              {requesting ? t.saving : t.perm_finish_enter}
            </button>
          )}
          <button
            type="button"
            onClick={closeModal}
            className="min-h-[40px] w-full text-xs font-bold text-[#475569] hover:text-[#0F172A]"
          >
            {t.continue_btn}
          </button>
        </div>
      </div>
    </div>
  );
};
