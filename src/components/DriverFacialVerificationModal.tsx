import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera,
  CheckCircle2,
  Clock,
  Loader2,
  RefreshCw,
  ShieldCheck,
  X,
  XCircle,
} from 'lucide-react';
import {
  fetchMyLatestFacialVerification,
  submitDriverFacialVerification,
} from '../lib/mobilityApi';
import { speakPtBr } from '../lib/sound';
import { supabase } from '../lib/supabase';
import type { DriverFacialVerification, UserProfile } from '../types/mobility';

interface DriverFacialVerificationModalProps {
  open: boolean;
  driver: UserProfile;
  onClose: () => void;
  onApprovedOnline: () => void;
}

export const DriverFacialVerificationModal: React.FC<DriverFacialVerificationModalProps> = ({
  open,
  driver,
  onClose,
  onApprovedOnline,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [verification, setVerification] = useState<DriverFacialVerification | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraReady(false);
  }, []);

  const startCamera = useCallback(async () => {
    setCameraError(null);
    setCameraReady(false);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError('Câmera ao vivo indisponível neste navegador.');
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 640 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setCameraReady(true);
    } catch {
      setCameraError(
        'Não foi possível acessar a câmera frontal. Libere a permissão da câmera para continuar.'
      );
    }
  }, []);

  useEffect(() => {
    if (!open) {
      stopCamera();
      setCapturedPhoto(null);
      setErrorMsg(null);
      return;
    }

    let active = true;
    fetchMyLatestFacialVerification(driver.id)
      .then((latest) => {
        if (!active) return;
        if (latest && latest.status === 'pending') {
          setVerification(latest);
          setCapturedPhoto(latest.selfie_data_url);
        } else {
          setVerification(null);
          void startCamera();
        }
      })
      .catch(() => {
        if (active) void startCamera();
      });

    return () => {
      active = false;
      stopCamera();
    };
  }, [driver.id, open, startCamera, stopCamera]);

  useEffect(() => {
    if (!open || verification?.status !== 'pending') return;

    const handleCheck = async () => {
      const latest = await fetchMyLatestFacialVerification(driver.id).catch(() => null);
      if (!latest) return;
      setVerification(latest);
      if (latest.status === 'approved') {
        speakPtBr(
          `${driver.full_name.split(' ')[0]}, seu reconhecimento facial foi aprovado pelo administrador! Você já está online.`
        );
        onApprovedOnline();
      } else if (latest.status === 'rejected') {
        speakPtBr(
          'Sua verificação facial precisa ser refeita. Posicione o rosto em um local bem iluminado e envie novamente.'
        );
      }
    };

    const channel = supabase
      .channel(`driver-facial-${driver.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'driver_facial_verifications',
          filter: `driver_id=eq.${driver.id}`,
        },
        () => {
          void handleCheck();
        }
      )
      .subscribe();

    const poll = window.setInterval(() => {
      void handleCheck();
    }, 3500);

    return () => {
      window.clearInterval(poll);
      supabase.removeChannel(channel);
    };
  }, [driver.full_name, driver.id, onApprovedOnline, open, verification?.status]);

  if (!open) return null;

  const handleCapture = () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    const size = 480;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const vw = video.videoWidth || 480;
    const vh = video.videoHeight || 480;
    const side = Math.min(vw, vh);
    const sx = (vw - side) / 2;
    const sy = (vh - side) / 2;

    ctx.translate(size, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, sx, sy, side, side, 0, 0, size, size);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
    setCapturedPhoto(dataUrl);
    stopCamera();
  };

  const handleSubmit = async () => {
    if (!capturedPhoto) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await submitDriverFacialVerification(driver.id, capturedPhoto);
      setVerification(res);
      speakPtBr(
        'Foto facial enviada para a fila ao vivo! Aguarde o administrador confirmar para ficar online.'
      );
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Erro ao enviar reconhecimento facial ao vivo.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleRetry = () => {
    setVerification(null);
    setCapturedPhoto(null);
    setErrorMsg(null);
    void startCamera();
  };

  return (
    <div className="fixed inset-0 z-[1260] flex flex-col bg-[#F4F6F9] text-[#0F172A] h-[100dvh] w-screen overflow-hidden">
      <header className="flex items-center justify-between border-b border-[#E2E8F0] bg-white px-4 py-3.5 pt-safe shrink-0 shadow-xs">
        <div className="flex items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#2563EB] text-white">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-display text-base font-extrabold text-[#0F172A]">
              Reconhecimento Facial ao Vivo
            </h2>
            <p className="text-[11px] font-semibold text-[#475569]">
              Validação rápida de segurança antes de ficar online
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-[#F1F5F9] text-[#0F172A] hover:bg-[#E2E8F0]"
          aria-label="Fechar"
        >
          <X className="h-5 w-5" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-6 flex flex-col items-center justify-center max-w-lg mx-auto w-full space-y-5">
        {verification?.status === 'pending' ? (
          <div className="w-full rounded-3xl border border-[#BFDBFE] bg-white p-6 text-center shadow-lg space-y-4">
            <div className="relative mx-auto h-36 w-36 overflow-hidden rounded-full border-4 border-[#2563EB] shadow-md">
              <img
                src={verification.selfie_data_url}
                alt="Selfie em análise"
                className="h-full w-full object-cover"
              />
            </div>

            <div className="inline-flex items-center gap-2 rounded-full bg-[#EFF6FF] border border-[#BFDBFE] px-4 py-1.5 text-xs font-extrabold text-[#1D4ED8]">
              <Clock className="h-4 w-4 animate-spin" />
              <span>
                Na fila ao vivo · Posição #{verification.queue_position || 1}
              </span>
            </div>

            <h3 className="font-display text-xl font-extrabold text-[#0F172A]">
              Aguardando liberação do Administrador
            </h3>
            <p className="text-sm text-[#475569] leading-relaxed">
              A Melissa já avisou o Administrador ao vivo. Assim que sua foto for conferida na fila,
              você ficará <strong>Online automaticamente</strong> para receber chamadas!
            </p>

            <button
              type="button"
              onClick={handleRetry}
              className="inline-flex items-center gap-2 rounded-2xl border border-[#E2E8F0] bg-[#F4F6F9] px-4 py-2.5 text-xs font-bold text-[#0F172A] hover:bg-[#E2E8F0]"
            >
              <RefreshCw className="h-4 w-4" />
              Tirar outra foto
            </button>
          </div>
        ) : verification?.status === 'rejected' ? (
          <div className="w-full rounded-3xl border border-red-200 bg-white p-6 text-center shadow-lg space-y-4">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-50 text-red-600">
              <XCircle className="h-9 w-9" />
            </div>
            <h3 className="font-display text-lg font-extrabold text-[#0F172A]">
              Verificação não confirmada
            </h3>
            <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-2xl p-3">
              {verification.rejection_reason ||
                'Foto desfocada ou com pouca luz. Tente novamente olhando direto para a câmera.'}
            </p>
            <button
              type="button"
              onClick={handleRetry}
              className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl bg-[#2563EB] text-sm font-extrabold text-white shadow-md hover:bg-[#1D4ED8]"
            >
              <Camera className="h-4 w-4" />
              Refazer Reconhecimento Facial
            </button>
          </div>
        ) : verification?.status === 'approved' ? (
          <div className="w-full rounded-3xl border border-emerald-200 bg-white p-6 text-center shadow-lg space-y-4">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
              <CheckCircle2 className="h-9 w-9" />
            </div>
            <h3 className="font-display text-lg font-extrabold text-[#0F172A]">
              Identidade Confirmada!
            </h3>
            <p className="text-sm text-[#475569]">Você já pode iniciar suas corridas e entregas.</p>
          </div>
        ) : (
          <div className="w-full rounded-3xl border border-[#E2E8F0] bg-white p-5 shadow-lg space-y-4">
            <div className="relative mx-auto aspect-square w-full max-w-[290px] overflow-hidden rounded-full border-4 border-[#2563EB] bg-[#0F172A] shadow-inner flex items-center justify-center">
              {capturedPhoto ? (
                <img
                  src={capturedPhoto}
                  alt="Prévia facial"
                  className="h-full w-full object-cover"
                />
              ) : (
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  className="h-full w-full object-cover scale-x-[-1]"
                />
              )}
              {!capturedPhoto && !cameraReady && !cameraError && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#0F172A]/80 text-white p-4 text-center">
                  <Loader2 className="h-7 w-7 animate-spin text-[#38BDF8]" />
                  <span className="text-xs font-semibold">Abrindo câmera frontal...</span>
                </div>
              )}
            </div>

            {cameraError && (
              <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-xs text-red-700 text-center space-y-2">
                <p>{cameraError}</p>
                <button
                  type="button"
                  onClick={() => void startCamera()}
                  className="rounded-xl bg-red-600 px-3 py-1.5 text-xs font-bold text-white"
                >
                  Tentar novamente
                </button>
              </div>
            )}

            {errorMsg && (
              <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700">
                {errorMsg}
              </div>
            )}

            <p className="text-center text-xs text-[#475569] leading-relaxed">
              Centralize seu rosto no círculo em um local bem iluminado, sem óculos escuros ou boné.
            </p>

            {capturedPhoto ? (
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={handleRetry}
                  className="flex min-h-[48px] items-center justify-center gap-2 rounded-2xl border border-[#E2E8F0] bg-[#F4F6F9] text-xs font-extrabold text-[#0F172A]"
                >
                  <RefreshCw className="h-4 w-4" />
                  Refazer
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={handleSubmit}
                  className="flex min-h-[48px] items-center justify-center gap-2 rounded-2xl bg-[#10B981] text-xs font-extrabold text-white shadow-md hover:bg-[#059669] disabled:opacity-60"
                >
                  {submitting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4" />
                  )}
                  {submitting ? 'Enviando...' : 'Enviar para Fila'}
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={!cameraReady}
                onClick={handleCapture}
                className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-[#2563EB] text-sm font-extrabold text-white shadow-lg hover:bg-[#1D4ED8] disabled:opacity-50"
              >
                <Camera className="h-5 w-5" />
                Capturar Foto ao Vivo
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
