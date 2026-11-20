import React, { useCallback, useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import {
  Camera,
  CheckCircle2,
  KeyRound,
  QrCode,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react';
import { formatBRL } from '../lib/geo';
import { lookup66PayDriver, process66PayRideTransfer } from '../lib/mobilityApi';
import type { Pay66DriverMatch, Pay66ReceiptResult, Ride } from '../types/mobility';
import { AvatarImage } from './AvatarImage';

interface Qr66PayScannerModalProps {
  ride: Ride;
  onPaid: (receipt: Pay66ReceiptResult) => void;
  onClose: () => void;
}

export const Qr66PayScannerModal: React.FC<Qr66PayScannerModalProps> = ({
  ride,
  onPaid,
  onClose,
}) => {
  const [mode, setMode] = useState<'scan' | 'manual'>('scan');
  const [manualKey, setManualKey] = useState<string>('');
  const [matchedDriver, setMatchedDriver] = useState<Pay66DriverMatch | null>(() =>
    ride.driver
      ? {
          id: ride.driver.id,
          full_name: ride.driver.full_name,
          pay66_key:
            ride.driver.pay66_key ||
            `66-${ride.driver.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`,
          avatar_url: ride.driver.avatar_url,
          phone: ride.driver.phone,
          vehicle_model: ride.driver.driver?.vehicle_model || null,
          vehicle_plate: ride.driver.driver?.vehicle_plate || null,
        }
      : null
  );
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const scannedLockRef = useRef(false);

  const amount = Number((ride.final_fare ?? ride.estimated_fare ?? 0).toFixed(2));

  const stopCamera = useCallback(() => {
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      try {
        streamRef.current.getTracks().forEach((track) => track.stop());
      } catch {
        // Ignore camera stop errors
      }
      streamRef.current = null;
    }
    setCameraReady(false);
  }, []);

  const resolveDriverFromInput = useCallback(
    async (rawInput: string) => {
      const clean = rawInput.trim();
      if (!clean) return;
      setErrorMsg(null);
      setLookingUp(true);
      try {
        const found = await lookup66PayDriver(clean);
        if (!found) {
          setErrorMsg('Chave ou QR Code BorealPay não encontrado. Confira com o motorista.');
          return;
        }
        if (ride.driver_id && found.id !== ride.driver_id) {
          setErrorMsg(
            `Este QR pertence a ${found.full_name}, mas sua corrida foi realizada por ${
              ride.driver?.full_name || 'outro motorista'
            }.`
          );
          return;
        }
        setMatchedDriver(found);
        setManualKey(found.pay66_key);
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Falha ao consultar chave BorealPay.');
      } finally {
        setLookingUp(false);
      }
    },
    [ride.driver_id, ride.driver?.full_name]
  );

  useEffect(() => {
    if (mode !== 'scan') {
      stopCamera();
      return;
    }

    let cancelled = false;
    scannedLockRef.current = false;
    setCameraError(null);

    const startCamera = async () => {
      try {
        if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
          setCameraError(
            'Câmera não disponível neste navegador. Use a aba "Digitar Chave BorealPay" abaixo.'
          );
          return;
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setCameraReady(true);

        const BarcodeDetectorCtor = (
          window as unknown as {
            BarcodeDetector?: new (opts?: { formats?: string[] }) => {
              detect: (source: HTMLVideoElement | HTMLCanvasElement) => Promise<Array<{ rawValue?: string }>>;
            };
          }
        ).BarcodeDetector;
        const nativeDetector = BarcodeDetectorCtor
          ? (() => {
              try {
                return new BarcodeDetectorCtor({ formats: ['qr_code'] });
              } catch {
                return null;
              }
            })()
          : null;

        let lastScanAt = 0;

        const scanFrame = async () => {
          if (cancelled || scannedLockRef.current) return;
          const video = videoRef.current;
          const now = Date.now();

          if (video && video.readyState >= 2 && video.videoWidth > 0 && now - lastScanAt >= 220) {
            lastScanAt = now;
            try {
              let detectedValue: string | null = null;

              const canvas = canvasRef.current;
              if (canvas) {
                const targetW = Math.min(480, video.videoWidth);
                const scale = targetW / video.videoWidth;
                const targetH = Math.max(1, Math.round(video.videoHeight * scale));
                if (canvas.width !== targetW || canvas.height !== targetH) {
                  canvas.width = targetW;
                  canvas.height = targetH;
                }
                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                if (ctx) {
                  ctx.drawImage(video, 0, 0, targetW, targetH);
                  const imgData = ctx.getImageData(0, 0, targetW, targetH);
                  const code = jsQR(imgData.data, targetW, targetH, {
                    inversionAttempts: 'dontInvert',
                  });
                  if (code?.data) {
                    detectedValue = code.data;
                  }
                }
              }

              if (!detectedValue && nativeDetector) {
                const found = await nativeDetector.detect(video).catch(() => []);
                if (found.length > 0 && found[0]?.rawValue) {
                  detectedValue = found[0].rawValue;
                }
              }

              if (detectedValue && !scannedLockRef.current) {
                scannedLockRef.current = true;
                stopCamera();
                await resolveDriverFromInput(detectedValue);
                setMode('manual');
                return;
              }
            } catch {
              // Ignore single-frame scan glitch
            }
          }

          if (!cancelled) {
            rafRef.current = window.requestAnimationFrame(() => {
              void scanFrame();
            });
          }
        };

        rafRef.current = window.requestAnimationFrame(() => {
          void scanFrame();
        });
      } catch {
        if (!cancelled) {
          setCameraError(
            'Não foi possível acessar a câmera. Permita o uso ou digite a Chave BorealPay do motorista.'
          );
        }
      }
    };

    void startCamera();

    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [mode, resolveDriverFromInput, stopCamera]);

  const handleConfirmPayment = async () => {
    setErrorMsg(null);
    setConfirming(true);
    try {
      const keyToSend = manualKey.trim() || matchedDriver?.pay66_key || matchedDriver?.id;
      const receipt = await process66PayRideTransfer(ride.id, keyToSend);
      onPaid(receipt);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao processar pagamento BorealPay.');
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1220] flex items-end sm:items-center justify-center bg-[#0F2421]/70 p-0 sm:p-4 backdrop-blur-xs">
      <div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-white dark:bg-[#0D1A18] text-[#0F2421] dark:text-white border border-[#DCEEE8] dark:border-emerald-950 p-5 shadow-2xl space-y-4 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-[#EDF6F3] dark:border-emerald-950 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#047857] to-[#0D9488] text-white shadow-xs">
              <QrCode className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-display text-base font-extrabold">Pagar Corrida com BorealPay</h3>
              <p className="text-[11px] text-[#5F7D78] dark:text-neutral-400">
                Leia o QR Code ou digite a Chave BorealPay do motorista
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              stopCamera();
              onClose();
            }}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-[#F1F8F6] dark:bg-white/10 text-[#334E4A] dark:text-white"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Switch Tabs */}
        <div className="grid grid-cols-2 gap-1.5 rounded-2xl bg-[#F1F8F6] dark:bg-white/10 p-1">
          <button
            type="button"
            onClick={() => setMode('scan')}
            className={`min-h-[42px] flex items-center justify-center gap-1.5 rounded-xl text-xs font-extrabold transition ${
              mode === 'scan'
                ? 'bg-[#047857] text-white shadow-xs'
                : 'text-[#334E4A] dark:text-neutral-300'
            }`}
          >
            <Camera className="h-4 w-4" />
            Ler QR Code
          </button>
          <button
            type="button"
            onClick={() => setMode('manual')}
            className={`min-h-[42px] flex items-center justify-center gap-1.5 rounded-xl text-xs font-extrabold transition ${
              mode === 'manual'
                ? 'bg-[#047857] text-white shadow-xs'
                : 'text-[#334E4A] dark:text-neutral-300'
            }`}
          >
            <KeyRound className="h-4 w-4" />
            Chave BorealPay
          </button>
        </div>

        {mode === 'scan' && (
          <div className="space-y-3">
            <div className="relative aspect-square w-full max-w-[280px] mx-auto overflow-hidden rounded-3xl bg-[#0F2421] border-2 border-[#2DD4BF] flex items-center justify-center">
              <video
                ref={videoRef}
                playsInline
                muted
                className="h-full w-full object-cover"
              />
              <canvas ref={canvasRef} className="hidden" />
              {!cameraError && (
                <div className="pointer-events-none absolute inset-6 rounded-2xl border-2 border-[#6EE7B7] shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
              )}
              {!cameraReady && !cameraError && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#0F2421]/90 text-xs text-neutral-200 p-4 text-center">
                  <Camera className="h-7 w-7 text-[#6EE7B7] animate-pulse" />
                  <span>Abrindo câmera do aparelho...</span>
                </div>
              )}
              {cameraError && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#0F2421]/95 p-5 text-center">
                  <QrCode className="h-9 w-9 text-[#6EE7B7]" />
                  <p className="text-xs text-neutral-200 leading-relaxed">{cameraError}</p>
                  <button
                    type="button"
                    onClick={() => setMode('manual')}
                    className="min-h-[40px] rounded-xl bg-[#047857] px-4 text-xs font-extrabold text-white"
                  >
                    Digitar Chave BorealPay
                  </button>
                </div>
              )}
            </div>
            <p className="text-center text-[11px] text-[#5F7D78] dark:text-neutral-400">
              Aponte a câmera para o QR Code BorealPay exibido no celular do motorista.
            </p>
          </div>
        )}

        {mode === 'manual' && (
          <div className="space-y-2.5">
            <label className="block text-xs font-bold text-[#334E4A] dark:text-neutral-300">
              Chave BorealPay do Motorista (código, e-mail ou telefone)
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={manualKey}
                onChange={(e) => setManualKey(e.target.value)}
                placeholder={matchedDriver?.pay66_key || 'Ex: 66-A1B2C3D4'}
                className="min-h-[46px] flex-1 rounded-xl border border-[#DCEEE8] dark:border-white/15 bg-[#F7FBFA] dark:bg-white/5 px-3 font-mono-num text-sm font-bold outline-none focus:border-[#047857] dark:focus:border-[#2DD4BF]"
              />
              <button
                type="button"
                disabled={lookingUp || !manualKey.trim()}
                onClick={() => resolveDriverFromInput(manualKey)}
                className="min-h-[46px] flex items-center gap-1 rounded-xl bg-[#047857] px-4 text-xs font-extrabold text-white disabled:opacity-50"
              >
                <Search className="h-4 w-4" />
                {lookingUp ? '...' : 'Validar'}
              </button>
            </div>
          </div>
        )}

        {errorMsg && (
          <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/50 px-3 py-2 text-xs font-bold text-red-700 dark:text-red-300">
            {errorMsg}
          </div>
        )}

        {/* Driver Recipient Card + Fare */}
        <div className="rounded-2xl border border-[#A7F3D0] dark:border-emerald-800/70 bg-[#ECFDF5]/70 dark:bg-emerald-950/30 p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <AvatarImage
                src={matchedDriver?.avatar_url}
                name={matchedDriver?.full_name || 'Motorista'}
                className="h-11 w-11 rounded-full object-cover border-2 border-[#047857] shrink-0"
                fallbackClassName="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#047857] text-white font-extrabold"
              />
              <div className="min-w-0">
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-[#047857] dark:text-[#6EE7B7]">
                  Motorista Destinatário
                </p>
                <p className="font-display text-sm font-extrabold truncate">
                  {matchedDriver?.full_name || ride.driver?.full_name || 'Motorista da Corrida'}
                </p>
                <p className="text-[11px] font-mono-num text-[#334E4A] dark:text-neutral-300 truncate">
                  Chave: {matchedDriver?.pay66_key || 'BorealPay verificada'}
                  {matchedDriver?.vehicle_plate ? ` · ${matchedDriver.vehicle_plate}` : ''}
                </p>
              </div>
            </div>
            <div className="text-right shrink-0">
              <p className="text-[10px] font-bold text-[#5F7D78] dark:text-neutral-400">Valor</p>
              <p className="font-mono-num text-xl font-extrabold text-[#047857] dark:text-[#6EE7B7]">
                {formatBRL(amount)}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-xl bg-white/90 dark:bg-black/30 px-3 py-2 text-[11px] text-[#334E4A] dark:text-neutral-300">
            <ShieldCheck className="h-4 w-4 text-[#047857] dark:text-[#6EE7B7] shrink-0" />
            <span>
              Transferência interna instantânea <strong>BorealPay</strong> — valor garantido direto para a carteira do motorista.
            </span>
          </div>
        </div>

        <button
          type="button"
          disabled={confirming}
          onClick={handleConfirmPayment}
          className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-[#047857] text-sm font-extrabold text-white shadow-md hover:bg-[#065F46] active:scale-[0.98] disabled:opacity-60 transition"
        >
          <CheckCircle2 className="h-5 w-5" />
          {confirming ? 'Processando transferência BorealPay...' : `Confirmar Pagamento BorealPay (${formatBRL(amount)})`}
        </button>
      </div>
    </div>
  );
};
