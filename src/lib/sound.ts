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
  // Toques musicais/bipes removidos: alertas utilizam exclusivamente a assistente de voz Luana.
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
let voicesChangedBound = false;

function bindVoicesChangedListener(): void {
  if (voicesChangedBound || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  voicesChangedBound = true;
  try {
    window.speechSynthesis.addEventListener('voiceschanged', () => {
      cachedVoiceByLang = {};
    });
  } catch {
    // Ignore browsers that only expose onvoiceschanged property
  }
}

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
  bindVoicesChangedListener();
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
  // Bipes e toques de notificação removidos: somente a assistente Luana fala.
}

export function playRideAcceptedChime(): void {
  // Silenciado: somente a assistente Luana anuncia o aceite.
}

export function playOfferAlertSound(): void {
  // Silenciado: sem toque de notificação.
}

function scoreLuanaVoice(voice: SpeechSynthesisVoice, activeLang: string): number {
  const name = voice.name.toLowerCase();
  const lang = voice.lang.toLowerCase();
  const targetLang = activeLang.toLowerCase();
  const targetPrefix = targetLang.split('-')[0];

  const maleOrRoboticTokens = [
    'male',
    'daniel',
    'ricardo',
    'felipe',
    'antonio',
    'antônio',
    'donato',
    'fabio',
    'fábio',
    'humberto',
    'julio',
    'júlio',
    'nicolau',
    'valerio',
    'valério',
    'tiago',
    'joaquim',
    'reed',
    'rocko',
    'grandpa',
    'albert',
    'fred',
    'ralph',
    'jorge',
    'carlos',
    'diego',
    'espeak',
  ];

  if (maleOrRoboticTokens.some((tok) => name.includes(tok))) {
    return -500;
  }

  let score = 0;

  if (lang === targetLang) score += 200;
  else if (lang.startsWith(targetPrefix)) score += 130;
  else if (lang.startsWith('pt')) score += 40;
  else return -200;

  // Prefer natural/neural/enhanced human voices first
  if (/(natural|neural|wavenet|studio|enhanced|aprimorada|premium)/i.test(name)) {
    score += 150;
  }
  if (!voice.localService || /(online|google|microsoft|apple)/i.test(name)) {
    score += 80;
  }

  // Strongly prefer warm female voices (especially PT-BR Thalita, Francisca, Luciana, Camila, Google PT-BR)
  const femalePriority = [
    'thalita',
    'francisca',
    'luciana',
    'camila',
    'leticia',
    'letícia',
    'raquel',
    'vitoria',
    'vitória',
    'maria',
    'helena',
    'fernanda',
    'luana',
    'google português do brasil',
    'jenny',
    'aria',
    'ava',
    'emma',
    'sonia',
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

  if (femalePriority.some((hint) => name.includes(hint))) {
    score += 110;
  }

  // Extra preference for modern conversational PT-BR neural voices
  if (name.includes('thalita') || name.includes('francisca')) {
    score += 40;
  }

  return score;
}

function resolveLuanaVoice(activeLang: string): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
  bindVoicesChangedListener();
  const voices = window.speechSynthesis.getVoices();
  const langLower = activeLang.toLowerCase();
  if (!voices.length) return cachedVoiceByLang[langLower] || null;

  let bestVoice: SpeechSynthesisVoice | null = null;
  let bestScore = -Infinity;

  for (const voice of voices) {
    const s = scoreLuanaVoice(voice, activeLang);
    if (s > bestScore) {
      bestScore = s;
      bestVoice = voice;
    }
  }

  if (bestVoice && bestScore > 0) {
    cachedVoiceByLang[langLower] = bestVoice;
    return bestVoice;
  }

  return voices.find((v) => v.lang.toLowerCase().startsWith('pt')) || voices[0] || null;
}

function humanizeSpeechText(raw: string): string {
  return raw
    .replace(/\b(?:Évelyn|Evelyn)\b/g, 'Luana')
    .replace(/R\$\s*(\d+)[,.](\d{2})/g, (_m, reais: string, cents: string) =>
      cents === '00' ? `${reais} reais` : `${reais} reais e ${Number(cents)} centavos`
    )
    .replace(/\s*[·|]\s*/g, ', ')
    .replace(/\b(\d+(?:[.,]\d+)?)\s*km\b/gi, '$1 quilômetros')
    .replace(/\b(\d+)\s*min\b/gi, '$1 minutos')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitHumanBreathClauses(text: string): string[] {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (sentences.length <= 1) return [text];

  // Group very short fragments with the next clause so prosody stays fluid without stalling
  const grouped: string[] = [];
  for (const s of sentences) {
    const prev = grouped[grouped.length - 1];
    if (prev && prev.length < 22 && prev.length + s.length < 95) {
      grouped[grouped.length - 1] = `${prev} ${s}`;
    } else {
      grouped.push(s);
    }
  }
  return grouped;
}

function computeNaturalSpeechParams(voice: SpeechSynthesisVoice | null): {
  rate: number;
  pitch: number;
} {
  const name = (voice?.name || '').toLowerCase();
  const isMicrosoftNatural =
    name.includes('microsoft') && (name.includes('natural') || name.includes('online'));

  // Microsoft Neural/Natural voices sound clearest & warmest around 1.06 rate and 1.01 pitch;
  // Google / Android / Apple voices sound lively, warm, and natural at 1.09 rate and 1.03 pitch.
  if (isMicrosoftNatural) {
    return { rate: 1.06, pitch: 1.01 };
  }
  return { rate: 1.09, pitch: 1.03 };
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
    const voice = resolveLuanaVoice(activeLang);
    const { rate, pitch } = computeNaturalSpeechParams(voice);

    utterance.lang = voice?.lang || activeLang;
    utterance.rate = rate;
    utterance.pitch = pitch;
    utterance.volume = 1.0;

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

    const estimatedMs = Math.min(18_000, Math.max(3200, next.text.length * 78));
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
  const clean = humanizeSpeechText(text);
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

    const clauses = splitHumanBreathClauses(clean);
    for (const clause of clauses) {
      if (speechQueue.length >= 6) {
        speechQueue.shift();
      }
      speechQueue.push({ text: clause });
    }
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
  const displayName = user.full_name?.trim().split(' ')[0] || user.full_name?.trim() || 'amigo';

  if (activeLang.startsWith('en')) {
    const enGreet =
      hour >= 5 && hour < 12
        ? 'good morning'
        : hour >= 12 && hour < 18
        ? 'good afternoon'
        : 'good evening';
    if (user.is_admin || user.role === 'admin') {
      return `Hi, ${enGreet}, ${displayName}! I'm Luana from Go Driver. Your admin dashboard is ready whenever you need it.`;
    }
    if (user.role === 'driver') {
      return `Hi, ${enGreet}, ${displayName}! I'm Luana from Go Driver. Ready to hit the road whenever you go online!`;
    }
    return `Hi, ${enGreet}, ${displayName}! I'm Luana from Go Driver. Where are we heading today?`;
  }

  if (activeLang.startsWith('es')) {
    const esGreet =
      hour >= 5 && hour < 12
        ? 'buenos días'
        : hour >= 12 && hour < 18
        ? 'buenas tardes'
        : 'buenas noches';
    if (user.is_admin || user.role === 'admin') {
      return `¡Hola, ${esGreet}, ${displayName}! Soy Luana, de Go Driver. El panel administrativo ya está listo.`;
    }
    if (user.role === 'driver') {
      return `¡Hola, ${esGreet}, ${displayName}! Soy Luana, de Go Driver. Conéctate cuando quieras empezar a recibir viajes.`;
    }
    return `¡Hola, ${esGreet}, ${displayName}! Soy Luana, de Go Driver. ¿A dónde vamos hoy?`;
  }

  const greeting = getTimeOfDayGreeting().toLowerCase();

  if (user.is_admin || user.role === 'admin') {
    return `Oi, ${greeting}, ${displayName}! Aqui é a Luana, da Go Driver. O painel já está todo pronto pra você acompanhar corridas, depósitos e saques.`;
  }

  if (user.role === 'driver') {
    const isDelivery = user.driver?.vehicle_type === 'delivery';
    const isOnline = Boolean(user.driver?.is_online);
    if (isDelivery) {
      return isOnline
        ? `Oi, ${greeting}, ${displayName}! Aqui é a Luana, da Go Driver. Você já está online e pronto para receber novas entregas.`
        : `Oi, ${greeting}, ${displayName}! Aqui é a Luana, da Go Driver. Quando quiser começar as entregas, é só ficar online.`;
    }
    return isOnline
      ? `Oi, ${greeting}, ${displayName}! Aqui é a Luana, da Go Driver. Você já está online e pronto para receber corridas.`
      : `Oi, ${greeting}, ${displayName}! Aqui é a Luana, da Go Driver. Tudo pronto para rodar hoje — assim que quiser, é só ficar online.`;
  }

  const debtNote =
    Number(user.pending_debt_amount || 0) > 0
      ? ` Só lembrando com carinho que há uma pendência anterior de ${Number(
          user.pending_debt_amount || 0
        )
          .toFixed(2)
          .replace('.', ',')} reais, que será somada na próxima corrida.`
      : '';

  return `Oi, ${greeting}, ${displayName}! Aqui é a Luana, da Go Driver. Pra onde a gente vai hoje? É só escolher seu destino no mapa.${debtNote}`;
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
