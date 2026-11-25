import type { PlatformConfig, UserProfile } from '../types/mobility';
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
  // Toques musicais/bipes removidos: alertas utilizam exclusivamente a assistente de voz Evelyn.
}

let sharedAudioCtx: AudioContext | null = null;
let hasUserGesture = false;
let pendingGreetingAction: (() => void) | null = null;
let lastGreetedUserId: string | null = null;
let lastSpokenText = '';
let lastSpokenAt = 0;

interface SpeechQueueItem {
  text: string;
}

const speechQueue: SpeechQueueItem[] = [];
let isSpeakingFromQueue = false;
let speechWatchdogTimer: number | null = null;
let cachedVoiceByLang: Record<string, SpeechSynthesisVoice> = {};

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
  hasUserGesture = true;
  try {
    const ctx = getSharedAudioContext();
    if (ctx && ctx.state === 'suspended') {
      await ctx.resume();
    }
  } catch {
    // Ignore audio context resume restrictions
  }
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      window.speechSynthesis.getVoices();
    } catch {
      // Ignore
    }
  }
  if (pendingGreetingAction) {
    const run = pendingGreetingAction;
    pendingGreetingAction = null;
    run();
  }
}

export function primeSpeechEngine(): void {
  void unlockAudioContext();
}

export async function playSoundCue(_cue: SoundCueType): Promise<void> {
  // Bipes e toques de notificação removidos: somente a assistente Evelyn fala.
}

export function playRideAcceptedChime(): void {
  // Silenciado: somente a assistente Evelyn anuncia o aceite.
}

export function playOfferAlertSound(): void {
  // Silenciado: sem toque de notificação.
}

function resolveEvelynVoice(activeLang: string): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  const langLower = activeLang.toLowerCase();
  const targetPrefix = langLower.split('-')[0];
  if (!voices.length) return cachedVoiceByLang[langLower] || null;

  const femaleHints = [
    'francisca',
    'thalita',
    'camila',
    'leticia',
    'letícia',
    'raquel',
    'maria',
    'luciana',
    'vitoria',
    'vitória',
    'helena',
    'fernanda',
    'evelyn',
    'jenny',
    'aria',
    'samantha',
    'sofia',
    'elena',
    'monica',
    'paulina',
    'aurelie',
    'amelie',
    'katja',
    'female',
    'mulher',
  ];

  const naturalHints = ['natural', 'neural', 'online', 'google', 'microsoft'];

  const isFemale = (v: SpeechSynthesisVoice) =>
    femaleHints.some((hint) => v.name.toLowerCase().includes(hint));

  const isNatural = (v: SpeechSynthesisVoice) =>
    !v.localService || naturalHints.some((hint) => v.name.toLowerCase().includes(hint));

  const exactLangVoices = voices.filter((v) => v.lang.toLowerCase() === langLower);
  const prefixVoices = voices.filter((v) => v.lang.toLowerCase().startsWith(targetPrefix));
  const ptVoices = voices.filter((v) => v.lang.toLowerCase().startsWith('pt'));

  const pickBest = (pool: SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined =>
    pool.find((v) => isNatural(v) && isFemale(v)) ||
    pool.find(isFemale) ||
    pool.find(isNatural) ||
    pool[0];

  const matched =
    pickBest(exactLangVoices) ||
    pickBest(prefixVoices) ||
    pickBest(ptVoices) ||
    null;

  if (matched) {
    cachedVoiceByLang[langLower] = matched;
  }
  return matched;
}

function clearSpeechWatchdog(): void {
  if (speechWatchdogTimer !== null) {
    window.clearTimeout(speechWatchdogTimer);
    speechWatchdogTimer = null;
  }
}

function pumpSpeechQueue(): void {
  const prefs = getUserPreferences();
  if (!prefs.voice_enabled) {
    speechQueue.length = 0;
    isSpeakingFromQueue = false;
    clearSpeechWatchdog();
    return;
  }

  if (isSpeakingFromQueue || speechQueue.length === 0) return;
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    speechQueue.length = 0;
    return;
  }

  const next = speechQueue.shift();
  if (!next) return;

  try {
    isSpeakingFromQueue = true;
    const utterance = new SpeechSynthesisUtterance(next.text);
    const activeLang = prefs.language || 'pt-BR';
    utterance.lang = activeLang;
    // Velocidade um pouco mais ágil e fluida, com tom suave e humano para a Evelyn
    utterance.rate = 1.16;
    utterance.pitch = 1.07;
    utterance.volume = 1.0;

    const voice = resolveEvelynVoice(activeLang);
    if (voice) {
      utterance.voice = voice;
    }

    const advance = () => {
      clearSpeechWatchdog();
      isSpeakingFromQueue = false;
      pumpSpeechQueue();
    };

    utterance.onend = advance;
    utterance.onerror = advance;

    const estimatedMs = Math.min(20_000, Math.max(3800, next.text.length * 75));
    clearSpeechWatchdog();
    speechWatchdogTimer = window.setTimeout(advance, estimatedMs);

    window.speechSynthesis.speak(utterance);
  } catch {
    clearSpeechWatchdog();
    isSpeakingFromQueue = false;
  }
}

export function stopSpeech(): void {
  speechQueue.length = 0;
  isSpeakingFromQueue = false;
  clearSpeechWatchdog();
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

  const now = Date.now();
  if (clean === lastSpokenText && now - lastSpokenAt < 3500) {
    return;
  }
  lastSpokenText = clean;
  lastSpokenAt = now;

  try {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

    if (interrupt) {
      speechQueue.length = 0;
      isSpeakingFromQueue = false;
      clearSpeechWatchdog();
      window.speechSynthesis.cancel();
    } else if (speechQueue.some((item) => item.text === clean)) {
      return;
    }

    if (speechQueue.length >= 4) {
      speechQueue.shift();
    }
    speechQueue.push({ text: clean });
    pumpSpeechQueue();
  } catch {
    // Ignore blocked speech synthesis before gesture
  }
}

export function getTimeOfDayGreeting(date: Date = new Date()): 'Bom dia' | 'Boa tarde' | 'Boa noite' {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return 'Bom dia';
  if (hour >= 12 && hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

export function buildLoginGreetingSpeech(user: UserProfile): string {
  const activeLang = (getUserPreferences().language || 'pt-BR').toLowerCase();
  const hour = new Date().getHours();
  const displayName = user.full_name?.trim() || 'amigo';

  if (activeLang.startsWith('en')) {
    const enGreet = hour >= 5 && hour < 12 ? 'good morning' : hour >= 12 && hour < 18 ? 'good afternoon' : 'good evening';
    if (user.is_admin || user.role === 'admin') {
      return `Hello, ${enGreet}, ${displayName}! I'm Evelyn from Go Driver. Your admin dashboard is ready.`;
    }
    if (user.role === 'driver') {
      return `Hello, ${enGreet}, ${displayName}! I'm Evelyn from Go Driver. Ready to hit the road whenever you go online!`;
    }
    return `Hello, ${enGreet}, ${displayName}! I'm Evelyn from Go Driver. Where are we going today?`;
  }

  if (activeLang.startsWith('es')) {
    const esGreet = hour >= 5 && hour < 12 ? 'buenos días' : hour >= 12 && hour < 18 ? 'buenas tardes' : 'buenas noches';
    if (user.is_admin || user.role === 'admin') {
      return `¡Hola, ${esGreet}, ${displayName}! Soy Evelyn, de Go Driver. El panel administrativo está listo.`;
    }
    if (user.role === 'driver') {
      return `¡Hola, ${esGreet}, ${displayName}! Soy Evelyn, de Go Driver. Conéctate cuando quieras recibir solicitudes.`;
    }
    return `¡Hola, ${esGreet}, ${displayName}! Soy Evelyn, de Go Driver. ¿A dónde vamos hoy?`;
  }

  const greeting = getTimeOfDayGreeting();

  if (user.is_admin || user.role === 'admin') {
    return `Olá, ${greeting.toLowerCase()}, ${displayName}! Eu sou a Evelyn, da Go Driver. O painel administrativo está pronto para acompanhar corridas, depósitos e saques.`;
  }

  if (user.role === 'driver') {
    const isDelivery = user.driver?.vehicle_type === 'delivery';
    const isOnline = Boolean(user.driver?.is_online);
    if (isDelivery) {
      return isOnline
        ? `Olá, ${greeting.toLowerCase()}, ${displayName}! Eu sou a Evelyn, da Go Driver. Você já está online para receber novas entregas.`
        : `Olá, ${greeting.toLowerCase()}, ${displayName}! Eu sou a Evelyn, da Go Driver. Fique online quando quiser receber entregas.`;
    }
    return isOnline
      ? `Olá, ${greeting.toLowerCase()}, ${displayName}! Eu sou a Evelyn, da Go Driver. Você já está online e pronto para receber corridas.`
      : `Olá, ${greeting.toLowerCase()}, ${displayName}! Eu sou a Evelyn, da Go Driver. Tudo pronto para rodar hoje, fique online quando quiser.`;
  }

  const debtNote =
    Number(user.pending_debt_amount || 0) > 0
      ? ` Lembro que há uma pendência anterior de ${Number(user.pending_debt_amount || 0)
          .toFixed(2)
          .replace('.', ',')} reais que será somada na próxima corrida.`
      : '';

  return `Olá, ${greeting.toLowerCase()}, ${displayName}! Eu sou a Evelyn, da Go Driver. Para onde vamos hoje? Escolha seu destino no mapa.${debtNote}`;
}

export function resetSessionGreeting(): void {
  lastGreetedUserId = null;
  pendingGreetingAction = null;
}

export function greetLoggedInUser(user: UserProfile, fromDirectGesture = false): void {
  const prefs = getUserPreferences();
  if (!prefs.voice_enabled) return;
  if (lastGreetedUserId === user.id) return;

  const runGreeting = () => {
    if (lastGreetedUserId === user.id) return;
    lastGreetedUserId = user.id;
    const message = buildLoginGreetingSpeech(user);
    speakPtBr(message, false);
  };

  if (fromDirectGesture || hasUserGesture) {
    hasUserGesture = true;
    window.setTimeout(runGreeting, 180);
  } else {
    pendingGreetingAction = runGreeting;
  }
}

export function startContinuousRideAlarm(
  title: string,
  _body: string,
  isDelivery = false,
  spokenMessage?: string
): () => void {
  let stopped = false;
  void unlockAudioContext();

  const triggerVibration = () => {
    try {
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate([240, 120, 240]);
      }
    } catch {
      // Ignore vibration errors
    }
  };

  triggerVibration();

  const voicePrompt =
    spokenMessage ||
    (isDelivery
      ? `Oi! ${title}. Chegou uma nova entrega para você na Go Driver.`
      : `Oi! ${title}. Chegou uma nova corrida para você na Go Driver.`);
  speakPtBr(voicePrompt, true);

  const voiceTimer = window.setInterval(() => {
    if (stopped) return;
    triggerVibration();
    speakPtBr(voicePrompt, false);
  }, 8500);

  return () => {
    stopped = true;
    window.clearInterval(voiceTimer);
    stopSpeech();
    try {
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate(0);
      }
    } catch {
      // Ignore
    }
  };
}
