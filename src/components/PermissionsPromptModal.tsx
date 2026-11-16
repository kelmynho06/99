import React, { useEffect, useState } from 'react';
import {
  Bell,
  Camera,
  CheckCircle2,
  Image as ImageIcon,
  MapPin,
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
                Necessárias no Android (APK) e navegador para funcionamento em tempo real
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

          {/* Background / Always Location */}
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-neutral-200 bg-neutral-50 p-3.5">
            <div className="flex items-start gap-3">
              <MapPin className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-extrabold text-neutral-950">
                  Localização GPS Contínua e Segundo Plano
                </p>
                <p className="text-[11px] text-neutral-600">
                  No Android, selecione &ldquo;Permitir o tempo todo&rdquo; para navegação contínua e
                  rastreamento ao vivo.
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
                  Para tirar foto comprovando a entrega de pacotes e fotografar CNH/CRLV.
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

          {/* Photos / Media Gallery */}
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-neutral-200 bg-neutral-50 p-3.5">
            <div className="flex items-start gap-3">
              <ImageIcon className="h-5 w-5 text-neutral-700 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-extrabold text-neutral-950">Fotos e Galeria</p>
                <p className="text-[11px] text-neutral-600">
                  Permite enviar sua foto de perfil e selecionar documentos salvos no aparelho.
                </p>
              </div>
            </div>
            <StatusBadge state={status.photos} />
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
