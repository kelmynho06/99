import type { PlatformConfig } from '../types/mobility';
import { triggerLocalNotification } from './capacitorDevice';
import { getUserPreferences } from './userPrefs';

export type SoundCueType =
  | 'offer'
  | 'delivery'
  | 'accepted'
  | 'arrived'
  | 'completed'
  | 'chat'
  | 'cancel';

const customSoundUrls: Record<SoundCueType, string | null> = {
  offer: null,
  delivery: null,
  accepted: null,
  arrived: null,
  completed: null,
  chat: null,
  cancel: null,
};

export function syncPlatformSounds(config?: PlatformConfig | null): void {
  if (!config) return;
  customSoundUrls.offer = config.sound_offer_url || null;
  customSoundUrls.delivery = config.sound_delivery_url || null;
  customSoundUrls.accepted = config.sound_accepted_url || null;
  customSoundUrls.arrived = config.sound_arrived_url || null;
  customSoundUrls.completed = config.sound_completed_url || null;
  customSoundUrls.chat = config.sound_chat_url || null;
  customSoundUrls.cancel = config.sound_cancel_url || null;
}

function playUrlAudio(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const audio = new Audio(url);
      audio.volume = 0.92;
      audio
        .play()
        .then(() => resolve(true))
        .catch(() => resolve(false));
    } catch {
      resolve(false);
    }
  });
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

async function playSynthNotes(
  notes: Array<{ freq: number; start: number; dur: number; type?: OscillatorType; gainPeak?: number }>
) {
  try {
    const ctx = getSharedAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    const now = ctx.currentTime;

    notes.forEach((n) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = n.type || 'triangle';
      osc.frequency.setValueAtTime(n.freq, now + n.start);

      const peak = n.gainPeak ?? 0.24;
      gain.gain.setValueAtTime(0.001, now + n.start);
      gain.gain.exponentialRampToValueAtTime(peak, now + n.start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + n.start + n.dur);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + n.start);
      osc.stop(now + n.start + n.dur + 0.025);
    });
  } catch {
    // Ignore autoplay restriction before user interaction
  }
}

export async function playSoundCue(cue: SoundCueType): Promise<void> {
  const prefs = getUserPreferences();
  if (!prefs.sounds_enabled) return;

  const customUrl = customSoundUrls[cue];
  if (customUrl) {
    const ok = await playUrlAudio(customUrl);
    if (ok) return;
  }

  switch (cue) {
    case 'accepted':
      void playSynthNotes([
        { freq: 523.25, start: 0, dur: 0.12, type: 'triangle', gainPeak: 0.34 },
        { freq: 659.25, start: 0.13, dur: 0.12, type: 'triangle', gainPeak: 0.34 },
        { freq: 783.99, start: 0.26, dur: 0.12, type: 'triangle', gainPeak: 0.34 },
        { freq: 1046.5, start: 0.39, dur: 0.16, type: 'triangle', gainPeak: 0.36 },
        { freq: 1318.51, start: 0.57, dur: 0.14, type: 'sine', gainPeak: 0.36 },
        { freq: 1567.98, start: 0.72, dur: 0.38, type: 'sine', gainPeak: 0.38 },
      ]);
      break;
    case 'arrived':
      playSynthNotes([
        { freq: 783.99, start: 0, dur: 0.18, type: 'triangle' },
        { freq: 1046.5, start: 0.18, dur: 0.22, type: 'triangle' },
        { freq: 1318.51, start: 0.38, dur: 0.3, type: 'triangle' },
      ]);
      break;
    case 'completed':
      playSynthNotes([
        { freq: 659.25, start: 0, dur: 0.12, type: 'sine' },
        { freq: 783.99, start: 0.12, dur: 0.12, type: 'sine' },
        { freq: 1046.5, start: 0.24, dur: 0.16, type: 'sine' },
        { freq: 1567.98, start: 0.4, dur: 0.35, type: 'sine' },
      ]);
      break;
    case 'chat':
      playSynthNotes([
        { freq: 880, start: 0, dur: 0.09, type: 'sine' },
        { freq: 1318.51, start: 0.09, dur: 0.14, type: 'sine' },
      ]);
      break;
    case 'cancel':
      playSynthNotes([
        { freq: 440, start: 0, dur: 0.15, type: 'sawtooth' },
        { freq: 349.23, start: 0.17, dur: 0.24, type: 'sawtooth' },
      ]);
      break;
    case 'delivery':
      playSynthNotes([
        { freq: 987.77, start: 0, dur: 0.14, type: 'square' },
        { freq: 1174.66, start: 0.16, dur: 0.14, type: 'square' },
        { freq: 1567.98, start: 0.32, dur: 0.26, type: 'triangle' },
      ]);
      break;
    case 'offer':
    default:
      playSynthNotes([
        { freq: 880, start: 0, dur: 0.2, type: 'triangle' },
        { freq: 1174.66, start: 0.11, dur: 0.2, type: 'triangle' },
        { freq: 1318.51, start: 0.22, dur: 0.24, type: 'triangle' },
      ]);
      break;
  }
}

export function playRideAcceptedChime(): void {
  void playSoundCue('accepted');
}

export function playOfferAlertSound(): void {
  void playSoundCue('offer');
}

function playUrgentRingBurst(isDelivery = false) {
  const prefs = getUserPreferences();
  if (!prefs.sounds_enabled) return;

  const customUrl = isDelivery
    ? customSoundUrls.delivery || customSoundUrls.offer
    : customSoundUrls.offer;
  if (customUrl) {
    void playUrlAudio(customUrl).then((ok) => {
      if (!ok) {
        playSynthNotes([
          { freq: 987.77, start: 0, dur: 0.16, type: 'sawtooth' },
          { freq: 1318.51, start: 0.18, dur: 0.18, type: 'sawtooth' },
          { freq: 1567.98, start: 0.38, dur: 0.26, type: 'sawtooth' },
        ]);
      }
    });
    return;
  }

  playSynthNotes(
    isDelivery
      ? [
          { freq: 1046.5, start: 0, dur: 0.14, type: 'triangle' },
          { freq: 1318.51, start: 0.15, dur: 0.14, type: 'triangle' },
          { freq: 1567.98, start: 0.31, dur: 0.24, type: 'triangle' },
          { freq: 1046.5, start: 0.62, dur: 0.14, type: 'triangle' },
          { freq: 1567.98, start: 0.78, dur: 0.28, type: 'triangle' },
        ]
      : [
          { freq: 987.77, start: 0, dur: 0.16, type: 'sawtooth' },
          { freq: 1318.51, start: 0.18, dur: 0.18, type: 'sawtooth' },
          { freq: 1567.98, start: 0.38, dur: 0.26, type: 'sawtooth' },
          { freq: 1318.51, start: 0.7, dur: 0.18, type: 'sawtooth' },
          { freq: 1567.98, start: 0.9, dur: 0.3, type: 'sawtooth' },
        ]
  );
}

export function startContinuousRideAlarm(
  title: string,
  body: string,
  isDelivery = false
): () => void {
  let stopped = false;

  const vibrateBurst = () => {
    if (stopped) return;
    try {
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate([450, 180, 450, 180, 700, 350]);
      }
    } catch {
      // Ignore vibration errors
    }
  };

  playUrgentRingBurst(isDelivery);
  vibrateBurst();
  triggerLocalNotification({
    title,
    body,
    playSound: false,
  });

  const soundInterval = window.setInterval(() => {
    if (!stopped) playUrgentRingBurst(isDelivery);
  }, 2400);

  const vibInterval = window.setInterval(() => {
    if (!stopped) vibrateBurst();
  }, 2600);

  return () => {
    stopped = true;
    window.clearInterval(soundInterval);
    window.clearInterval(vibInterval);
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

export function speakPtBr(text: string, interrupt = true): void {
  const prefs = getUserPreferences();
  if (!prefs.voice_enabled) return;
  const clean = text.trim();
  if (!clean) return;

  try {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    if (interrupt) {
      window.speechSynthesis.cancel();
    }
    const utterance = new SpeechSynthesisUtterance(clean);
    const activeLang = prefs.language || 'pt-BR';
    utterance.lang = activeLang;
    utterance.rate = 1.02;
    utterance.pitch = 1.0;

    const voices = window.speechSynthesis.getVoices();
    const targetPrefix = activeLang.toLowerCase().split('-')[0];
    const matchedVoice =
      voices.find((v) => v.lang.toLowerCase() === activeLang.toLowerCase()) ||
      voices.find((v) => v.lang.toLowerCase().startsWith(targetPrefix)) ||
      voices.find((v) => v.lang.toLowerCase().startsWith('pt'));
    if (matchedVoice) {
      utterance.voice = matchedVoice;
    }
    window.speechSynthesis.speak(utterance);
  } catch {
    // Ignore blocked speech synthesis before gesture
  }
}
