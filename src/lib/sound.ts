import type { PlatformConfig } from '../types/mobility';
import { getUserPreferences } from './userPrefs';

export type SoundCueType =
  | 'offer'
  | 'delivery'
  | 'accepted'
  | 'arrived'
  | 'completed'
  | 'chat'
  | 'cancel';

export function syncPlatformSounds(_config?: PlatformConfig | null): void {
  // Toques musicais/bipes removidos por solicitação: alertas utilizam apenas Assistente de Voz.
}

let sharedAudioCtx: AudioContext | null = null;

function getSharedAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;
  if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
    sharedAudioCtx = new AudioCtx();
  }
  return sharedAudioCtx;
}

export async function unlockAudioContext(): Promise<void> {
  try {
    const ctx = getSharedAudioContext();
    if (ctx && ctx.state === 'suspended') {
      await ctx.resume();
    }
  } catch {
    // Ignore audio context resume restrictions
  }
}

export async function playSoundCue(_cue: SoundCueType): Promise<void> {
  // Bipes e toques de notificação removidos: somente a assistente de voz fala.
}

export function playRideAcceptedChime(): void {
  // Silenciado: somente a assistente de voz anuncia o aceite.
}

export function playOfferAlertSound(): void {
  // Silenciado: sem toque "tam tam tam".
}

export function startContinuousRideAlarm(
  title: string,
  _body: string,
  isDelivery = false,
  spokenMessage?: string
): () => void {
  let stopped = false;
  void unlockAudioContext();

  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(70);
    }
  } catch {
    // Ignore vibration errors
  }

  const voicePrompt =
    spokenMessage ||
    (isDelivery
      ? `${title}. Nova entrega disponível para você.`
      : `${title}. Nova corrida disponível para você.`);
  speakPtBr(voicePrompt, true);

  let repeated = 0;
  const voiceTimer = window.setInterval(() => {
    if (stopped) return;
    repeated += 1;
    if (repeated > 1) {
      window.clearInterval(voiceTimer);
      return;
    }
    try {
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate(60);
      }
    } catch {
      // Ignore vibration errors
    }
    speakPtBr(voicePrompt, false);
  }, 8500);

  return () => {
    stopped = true;
    window.clearInterval(voiceTimer);
    try {
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate(0);
      }
    } catch {
      // Ignore
    }
  };
}

export function stopSpeech(): void {
  try {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  } catch {
    // Ignore speech synthesis errors
  }
}

let cachedPtBrVoice: SpeechSynthesisVoice | null = null;

export function speakPtBr(text: string, interrupt = true): void {
  const prefs = getUserPreferences();
  if (!prefs.voice_enabled) return;
  const clean = text.trim();
  if (!clean) return;

  try {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    if (interrupt) {
      window.speechSynthesis.cancel();
    } else if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
      return;
    }
    const utterance = new SpeechSynthesisUtterance(clean);
    const activeLang = prefs.language || 'pt-BR';
    utterance.lang = activeLang;
    utterance.rate = 1.03;
    utterance.pitch = 1.02;
    utterance.volume = 1.0;

    const voices = window.speechSynthesis.getVoices();
    const targetPrefix = activeLang.toLowerCase().split('-')[0];
    const matchedVoice =
      voices.find((v) => v.lang.toLowerCase() === activeLang.toLowerCase() && !v.localService) ||
      voices.find((v) => v.lang.toLowerCase() === activeLang.toLowerCase()) ||
      voices.find((v) => v.lang.toLowerCase().startsWith(targetPrefix)) ||
      voices.find((v) => v.lang.toLowerCase().startsWith('pt'));
    if (matchedVoice) {
      cachedPtBrVoice = matchedVoice;
    }
    if (cachedPtBrVoice) {
      utterance.voice = cachedPtBrVoice;
    }
    window.speechSynthesis.speak(utterance);
  } catch {
    // Ignore blocked speech synthesis before gesture
  }
}
