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
import { markPermissionsPromptSeen } from '../lib/userPrefs';
import type { DevicePermissionsState, PermissionGrantState } from '../types/mobility';

interface PermissionsPromptModalProps {
  siteName?: string;
  onClose: () => void;
}

function StatusBadge({ state }: { state: PermissionGrantState }) {
  if (state === 'granted') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 dark:bg-emerald-950/60 px-2.5 py-0.5 text-[11px] font-extrabold text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
        <CheckCircle2 className="h-3 w-3" />
        Permitido
      </span>
    );
  }
  if (state === 'denied') {
    return (
      <span className="rounded-full bg-red-50 dark:bg-red-950/60 px-2.5 py-0.5 text-[11px] font-extrabold text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800">
        Bloqueado
      </span>
    );
  }
  return (
    <span className="rounded-full bg-amber-50 dark:bg-amber-950/60 px-2.5 py-0.5 text-[11px] font-extrabold text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
      Pendente
    </span>
  );
}

export const PermissionsPromptModal: React.FC<PermissionsPromptModalProps> = ({
  siteName = 'Velo99',
  onClose,
}) => {
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

  useEffect(() => {
    checkDevicePermissionsStatus().then(setStatus).catch(() => {});
  }, []);

  const refreshStatus = async () => {
    const next = await checkDevicePermissionsStatus();
    setStatus(next);
  };

  const handleGrantAll = async () => {
    setRequesting(true);
    try {
      const next = await requestAllDevicePermissions();
      setStatus(next);
      setBatteryDone(true);
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
    { title: 'Notificações Push', icon: Bell, badge: status.notifications },
    { title: 'GPS Contínuo', icon: MapPin, badge: status.location },
    { title: 'Câmera & Documentos', icon: Camera, badge: status.camera },
    { title: 'Bateria & Segundo Plano', icon: BatteryCharging, badge: batteryDone ? ('granted' as const) : ('prompt' as const) },
  ];

  return (
    <div className="fixed inset-0 z-[1320] flex items-end sm:items-center justify-center bg-black/75 p-0 sm:p-4">
      <div className="w-full max-w-lg rounded-t-3xl sm:rounded-3xl bg-white dark:bg-neutral-900 p-6 shadow-2xl space-y-4 max-h-[92vh] overflow-y-auto border border-neutral-200 dark:border-neutral-800">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-neutral-100 dark:border-neutral-800 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#FFD100] text-neutral-950">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                Passo {step + 1} de 4 · Configuração Guiada ({siteName})
              </p>
              <h3 className="font-display text-lg font-extrabold text-neutral-950 dark:text-white">
                {stepsMeta[step].title}
              </h3>
            </div>
          </div>
          <button
            type="button"
            onClick={closeModal}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200"
            aria-label="Fechar permissões"
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
                  ? 'bg-neutral-950 dark:bg-[#FFD100] text-[#FFD100] dark:text-neutral-950 border-neutral-950 dark:border-[#FFD100]'
                  : 'bg-neutral-50 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 border-neutral-200 dark:border-neutral-700'
              }`}
            >
              <p className="text-[10px] font-extrabold truncate">{idx + 1}. {s.title.split(' ')[0]}</p>
            </button>
          ))}
        </div>

        {/* Step 1: Notifications */}
        {step === 0 && (
          <div className="space-y-3 rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800/70 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300">
                  <Bell className="h-6 w-6" />
                </div>
                <div>
                  <h4 className="text-sm font-extrabold text-neutral-950 dark:text-white">
                    Alertas Pop-up e Toque Contínuo de Corridas
                  </h4>
                  <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-300 leading-relaxed">
                    Essencial para motoristas e entregadores ouvirem novas chamadas e passageiros
                    receberem aviso imediato de embarque ou mensagens do chat mesmo com a tela bloqueada.
                  </p>
                </div>
              </div>
              <StatusBadge state={status.notifications} />
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
              className="flex min-h-[46px] w-full items-center justify-center gap-2 rounded-2xl bg-neutral-950 dark:bg-[#FFD100] text-xs font-extrabold text-[#FFD100] dark:text-neutral-950"
            >
              <Bell className="h-4 w-4" />
              Permitir Notificações e Avançar
            </button>
          </div>
        )}

        {/* Step 2: Always Location */}
        {step === 1 && (
          <div className="space-y-3 rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800/70 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300">
                  <MapPin className="h-6 w-6" />
                </div>
                <div>
                  <h4 className="text-sm font-extrabold text-neutral-950 dark:text-white">
                    Localização GPS &ldquo;Permitir o tempo todo&rdquo;
                  </h4>
                  <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-300 leading-relaxed">
                    Mantém o rastreamento em tempo real, o cálculo exato de rota e o envio da sua
                    posição no mapa mesmo ao alternar para outros aplicativos ou bloquear a tela.
                  </p>
                </div>
              </div>
              <StatusBadge state={status.location} />
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
              className="flex min-h-[46px] w-full items-center justify-center gap-2 rounded-2xl bg-neutral-950 dark:bg-[#FFD100] text-xs font-extrabold text-[#FFD100] dark:text-neutral-950"
            >
              <MapPin className="h-4 w-4" />
              Ativar GPS Contínuo e Avançar
            </button>
          </div>
        )}

        {/* Step 3: Camera & Gallery with automatic compression */}
        {step === 2 && (
          <div className="space-y-3 rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800/70 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300">
                  <Camera className="h-6 w-6" />
                </div>
                <div>
                  <h4 className="text-sm font-extrabold text-neutral-950 dark:text-white">
                    Câmera &amp; Galeria (Foto de Perfil, CNH e CRLV)
                  </h4>
                  <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-300 leading-relaxed">
                    Utilizada apenas para atualizar sua foto de perfil e enviar documentos (CNH/CRLV).
                    As imagens passam por <strong>compressão automática em Canvas</strong> para evitar
                    travamentos ou falta de memória em celulares Android de entrada.
                  </p>
                  <p className="mt-1 text-[11px] font-bold text-emerald-700 dark:text-emerald-400">
                    Obs.: A confirmação de corridas e entregas é feita 100% por PIN de 4 dígitos.
                  </p>
                </div>
              </div>
              <StatusBadge state={status.camera} />
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
              className="flex min-h-[46px] w-full items-center justify-center gap-2 rounded-2xl bg-neutral-950 dark:bg-[#FFD100] text-xs font-extrabold text-[#FFD100] dark:text-neutral-950"
            >
              <Camera className="h-4 w-4" />
              Autorizar Câmera / Galeria e Avançar
            </button>
          </div>
        )}

        {/* Step 4: Visual Android Battery Optimization Guide */}
        {step === 3 && (
          <div className="space-y-3 rounded-2xl border border-amber-300 dark:border-amber-700 bg-amber-50/70 dark:bg-amber-950/30 p-4">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#FFD100] text-neutral-950">
                <BatteryCharging className="h-6 w-6" />
              </div>
              <div>
                <h4 className="text-sm font-extrabold text-neutral-950 dark:text-white">
                  Guia Visual: Otimização de Bateria Android
                </h4>
                <p className="mt-1 text-xs text-neutral-700 dark:text-neutral-200 leading-relaxed">
                  Para que o Android nunca suspenda seu GPS ou toque de chamadas quando o celular estiver
                  no bolso, siga este caminho:
                </p>
              </div>
            </div>

            <div className="rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 p-3 space-y-2 text-xs">
              <div className="flex items-center gap-2 font-bold text-neutral-900 dark:text-neutral-100">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-neutral-950 text-[#FFD100] text-[10px]">1</span>
                <span>Abra Configurações &gt; Aplicativos &gt; {siteName}</span>
              </div>
              <div className="flex items-center gap-2 font-bold text-neutral-900 dark:text-neutral-100">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-neutral-950 text-[#FFD100] text-[10px]">2</span>
                <span>Toque em Bateria / Uso da bateria</span>
              </div>
              <div className="flex items-center gap-2 font-extrabold text-emerald-700 dark:text-emerald-400">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-white text-[10px]">3</span>
                <span>Marque &ldquo;Irrestrito&rdquo; (ou &ldquo;Sem restrições&rdquo;)</span>
              </div>
            </div>

            <div className="flex items-center justify-between text-[11px] text-neutral-600 dark:text-neutral-300 px-1">
              <span className="inline-flex items-center gap-1">
                <Mic className="h-3.5 w-3.5 text-indigo-500" /> Áudio &amp; Voz PT-BR prontos
              </span>
              <span className="inline-flex items-center gap-1">
                <Phone className="h-3.5 w-3.5 text-emerald-600" /> Chamada direta ativa
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
                className="min-h-[48px] flex-1 rounded-2xl bg-[#FFD100] text-xs sm:text-sm font-extrabold text-neutral-950 shadow-sm active:scale-[0.98] transition disabled:opacity-50"
              >
                {requesting ? 'Solicitando...' : 'Ativar Todas Agora'}
              </button>
              <button
                type="button"
                onClick={() => setStep((prev) => Math.min(3, prev + 1) as 0 | 1 | 2 | 3)}
                className="flex min-h-[48px] items-center justify-center gap-1 rounded-2xl border border-neutral-200 dark:border-neutral-700 px-4 text-xs font-extrabold text-neutral-800 dark:text-neutral-200"
              >
                <span>Próximo</span>
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={requesting}
              onClick={handleGrantAll}
              className="min-h-[50px] w-full rounded-2xl bg-[#FFD100] text-sm font-extrabold text-neutral-950 shadow-sm active:scale-[0.98] transition disabled:opacity-50"
            >
              {requesting ? 'Finalizando...' : 'Concluir Configuração & Entrar'}
            </button>
          )}
          <button
            type="button"
            onClick={closeModal}
            className="min-h-[40px] w-full text-xs font-bold text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white"
          >
            Continuar para o aplicativo
          </button>
        </div>
      </div>
    </div>
  );
};
