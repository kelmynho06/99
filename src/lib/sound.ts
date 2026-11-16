import type { PlatformConfig } from '../types/mobility';
import { triggerLocalNotification } from './capacitorDevice';
import { getUserPreferences } from './userPrefs';

export type SoundCueType = 'offer' | 'accepted' | 'arrived';

const customSoundUrls: Record<SoundCueType, string | null> = {
  offer: null,
  accepted: null,
  arrived: null,
};

export function syncPlatformSounds(config?: PlatformConfig | null): void {
  if (!config) return;
  customSoundUrls.offer = config.sound_offer_url || null;
  customSoundUrls.accepted = config.sound_accepted_url || null;
  customSoundUrls.arrived = config.sound_arrived_url || null;
}

function playUrlAudio(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const audio = new Audio(url);
      audio.volume = 0.9;
      audio
        .play()
        .then(() => resolve(true))
        .catch(() => resolve(false));
    } catch {
      resolve(false);
    }
  });
}

function playSynthNotes(notes: Array<{ freq: number; start: number; dur: number; type?: OscillatorType }>) {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    notes.forEach((n) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = n.type || 'triangle';
      osc.frequency.setValueAtTime(n.freq, now + n.start);

      gain.gain.setValueAtTime(0.001, now + n.start);
      gain.gain.exponentialRampToValueAtTime(0.22, now + n.start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + n.start + n.dur);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + n.start);
      osc.stop(now + n.start + n.dur + 0.02);
    });
  } catch {
    // Ignore autoplay restriction if user hasn't interacted yet
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

  if (cue === 'accepted') {
    // Pleasant rhythmic acceptance chime ("tam tam tam, plim plim")
    playSynthNotes([
      { freq: 523.25, start: 0, dur: 0.13, type: 'triangle' },
      { freq: 659.25, start: 0.14, dur: 0.13, type: 'triangle' },
      { freq: 783.99, start: 0.28, dur: 0.16, type: 'triangle' },
      { freq: 1046.5, start: 0.46, dur: 0.18, type: 'sine' },
      { freq: 1318.51, start: 0.63, dur: 0.34, type: 'sine' },
    ]);
  } else if (cue === 'arrived') {
    playSynthNotes([
      { freq: 783.99, start: 0, dur: 0.18, type: 'triangle' },
      { freq: 1046.5, start: 0.18, dur: 0.22, type: 'triangle' },
      { freq: 1318.51, start: 0.38, dur: 0.3, type: 'triangle' },
    ]);
  } else {
    playSynthNotes([
      { freq: 880, start: 0, dur: 0.2, type: 'triangle' },
      { freq: 1174.66, start: 0.11, dur: 0.2, type: 'triangle' },
      { freq: 1318.51, start: 0.22, dur: 0.24, type: 'triangle' },
    ]);
  }
}

export function playRideAcceptedChime(): void {
  void playSoundCue('accepted');
}

export function playOfferAlertSound(): void {
  void playSoundCue('offer');
}

function playUrgentRingBurst() {
  const prefs = getUserPreferences();
  if (!prefs.sounds_enabled) return;

  const customUrl = customSoundUrls.offer;
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

  playSynthNotes([
    { freq: 987.77, start: 0, dur: 0.16, type: 'sawtooth' },
    { freq: 1318.51, start: 0.18, dur: 0.18, type: 'sawtooth' },
    { freq: 1567.98, start: 0.38, dur: 0.26, type: 'sawtooth' },
    { freq: 1318.51, start: 0.7, dur: 0.18, type: 'sawtooth' },
    { freq: 1567.98, start: 0.9, dur: 0.3, type: 'sawtooth' },
  ]);
}

export function startContinuousRideAlarm(title: string, body: string): () => void {
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

  playUrgentRingBurst();
  vibrateBurst();
  triggerLocalNotification({
    title,
    body,
    playSound: false,
  });

  const soundInterval = window.setInterval(() => {
    if (!stopped) playUrgentRingBurst();
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
    utterance.lang = 'pt-BR';
    utterance.rate = 1.02;
    utterance.pitch = 1.0;

    const voices = window.speechSynthesis.getVoices();
    const ptVoice =
      voices.find((v) => v.lang.toLowerCase().startsWith('pt-br')) ||
      voices.find((v) => v.lang.toLowerCase().startsWith('pt'));
    if (ptVoice) {
      utterance.voice = ptVoice;
    }
    window.speechSynthesis.speak(utterance);
  } catch {
    // Ignore blocked speech synthesis before gesture
  }
}
