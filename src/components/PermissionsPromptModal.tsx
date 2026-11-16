import React, { useEffect, useState } from 'react';
import {
  Bell,
  Camera,
  CheckCircle2,
  Image as ImageIcon,
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
  requestMicrophonePermission,
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
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-extrabold text-emerald-700 border border-emerald-200">
        <CheckCircle2 className="h-3 w-3" />
        Permitido
      </span>
    );
  }
  if (state === 'denied') {
    return (
      <span className="rounded-full bg-red-50 px-2.5 py-0.5 text-[11px] font-extrabold text-red-700 border border-red-200">
        Bloqueado
      </span>
    );
  }
  return (
    <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-extrabold text-amber-800 border border-amber-200">
      Solicitar
    </span>
  );
}

export const PermissionsPromptModal: React.FC<PermissionsPromptModalProps> = ({
  siteName = 'Velo99',
  onClose,
}) => {
  const [status, setStatus] = useState<DevicePermissionsState>({
    notifications: 'prompt',
    location: 'prompt',
    camera: 'prompt',
    microphone: 'prompt',
    photos: 'granted',
  });
  const [requesting, setRequesting] = useState(false);

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
      markPermissionsPromptSeen();
    } finally {
      setRequesting(false);
    }
  };

  const closeModal = () => {
    markPermissionsPromptSeen();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[1320] flex items-end sm:items-center justify-center bg-black/70 p-0 sm:p-4">
      <div className="w-full max-w-lg rounded-t-3xl sm:rounded-3xl bg-white p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3 border-b border-neutral-100 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#FFD100] text-neutral-950">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-display text-lg font-extrabold text-neutral-950">
                Permissões do Aplicativo ({siteName})
              </h3>
              <p className="text-xs text-neutral-500">
                Padrão completo para Android (APK) e navegador em segundo plano
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={closeModal}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100 text-neutral-700"
            aria-label="Fechar permissões"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-2.5">
          {/* Notifications */}
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-neutral-200 bg-neutral-50 p-3.5">
            <div className="flex items-start gap-3">
              <Bell className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-extrabold text-neutral-950">
                  Notificações Pop-up e Alertas
                </p>
                <p className="text-[11px] text-neutral-600">
                  Avisa novas corridas, chegada do motorista e mensagens mesmo com a tela apagada.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={async () => {
                await requestNotificationPermission();
                await refreshStatus();
              }}
              className="shrink-0"
            >
              <StatusBadge state={status.notifications} />
            </button>
          </div>

          {/* Background / Always Location + Battery */}
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-neutral-200 bg-neutral-50 p-3.5">
            <div className="flex items-start gap-3">
              <MapPin className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-extrabold text-neutral-950">
                  Localização GPS Contínua e Segundo Plano
                </p>
                <p className="text-[11px] text-neutral-600">
                  Selecione &ldquo;Permitir o tempo todo&rdquo; e desative restrição de bateria para
                  manter o rastreamento e chamadas sempre ativos.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={async () => {
                await requestLocationPermission();
                await refreshStatus();
              }}
              className="shrink-0"
            >
              <StatusBadge state={status.location} />
            </button>
          </div>

          {/* Camera */}
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-neutral-200 bg-neutral-50 p-3.5">
            <div className="flex items-start gap-3">
              <Camera className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-extrabold text-neutral-950">Acesso à Câmera</p>
                <p className="text-[11px] text-neutral-600">
                  Para foto comprobatória da entrega de pacotes e envio de CNH/CRLV.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={async () => {
                await requestCameraPermission();
                await refreshStatus();
              }}
              className="shrink-0"
            >
              <StatusBadge state={status.camera} />
            </button>
          </div>

          {/* Microphone / Audio */}
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-neutral-200 bg-neutral-50 p-3.5">
            <div className="flex items-start gap-3">
              <Mic className="h-5 w-5 text-indigo-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-extrabold text-neutral-950">Áudio e Microfone</p>
                <p className="text-[11px] text-neutral-600">
                  Garante alertas sonoros nítidos, guia de voz PT-BR e suporte por voz durante corridas.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={async () => {
                await requestMicrophonePermission();
                await refreshStatus();
              }}
              className="shrink-0"
            >
              <StatusBadge state={status.microphone} />
            </button>
          </div>

          {/* Photos & Direct Calls */}
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-neutral-200 bg-neutral-50 p-3.5">
            <div className="flex items-start gap-3">
              <ImageIcon className="h-5 w-5 text-neutral-700 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-extrabold text-neutral-950">
                  Fotos, Galeria e Chamadas Diretas
                </p>
                <p className="text-[11px] text-neutral-600">
                  Permite salvar foto de perfil, anexar documentos e ligar com 1 toque para motorista/cliente.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <Phone className="h-3.5 w-3.5 text-emerald-700" />
              <StatusBadge state={status.photos} />
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2 pt-2">
          <button
            type="button"
            disabled={requesting}
            onClick={handleGrantAll}
            className="min-h-[50px] w-full rounded-2xl bg-[#FFD100] text-sm font-extrabold text-neutral-950 shadow-sm active:scale-[0.98] transition disabled:opacity-50"
          >
            {requesting ? 'Solicitando permissões...' : 'Ativar Todas as Permissões'}
          </button>
          <button
            type="button"
            onClick={closeModal}
            className="min-h-[42px] w-full text-xs font-bold text-neutral-500 hover:text-neutral-900"
          >
            Continuar para o aplicativo
          </button>
        </div>
      </div>
    </div>
  );
};
