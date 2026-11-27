import type { AssistantVoiceId, PlatformConfig, UserProfile } from '../types/mobility';
import { getUserPreferences } from './userPrefs';

export type SoundCueType =
  | 'offer'
  | 'delivery'
  | 'accepted'
  | 'arrived'
  | 'completed'
  | 'chat'
  | 'cancel';

export interface AssistantVoicePreset {
  id: AssistantVoiceId;
  label: string;
  description: string;
  geminiVoiceName: 'Kore' | 'Zephyr' | 'Aoede' | 'Leda';
  geminiStyleHint: string;
  rate: number;
  pitch: number;
}

export const ASSISTANT_VOICE_PRESETS: AssistantVoicePreset[] = [
  {
    id: 'melissa-maps',
    label: 'Melissa · Voz Oficial',
    description: 'Voz feminina natural padrão da Go Driver',
    geminiVoiceName: 'Kore',
    geminiStyleHint: 'Fale com clareza, simpatia e ritmo natural de assistente urbana:',
    rate: 1.07,
    pitch: 1.02,
  },
];

export function syncPlatformSounds(_config?: PlatformConfig | null): void {
  // Voz da Melissa unificada para padrão único feminino natural
}

export function getActiveVoicePreset(): AssistantVoicePreset {
  return ASSISTANT_VOICE_PRESETS[0];
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
let activeAudioElement: HTMLAudioElement | null = null;

let speechQueueToken = 0;

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

export async function waitForVoicesReady(timeoutMs = 1400): Promise<SpeechSynthesisVoice[]> {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return [];
  bindVoicesChangedListener();
  try {
    const existing = window.speechSynthesis.getVoices();
    if (existing.length > 0) return existing;
  } catch {
    return [];
  }

  return new Promise((resolve) => {
    let settled = false;
    let pollId: number | null = null;
    let timeoutId: number | null = null;

    const done = () => {
      if (settled) return;
      settled = true;
      if (pollId !== null) window.clearInterval(pollId);
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      try {
        window.speechSynthesis.removeEventListener('voiceschanged', onVoicesChanged);
      } catch {
        // Ignore
      }
      try {
        resolve(window.speechSynthesis.getVoices());
      } catch {
        resolve([]);
      }
    };

    const onVoicesChanged = () => {
      try {
        if (window.speechSynthesis.getVoices().length > 0) done();
      } catch {
        done();
      }
    };

    try {
      window.speechSynthesis.addEventListener('voiceschanged', onVoicesChanged);
    } catch {
      // Fallback to polling below
    }

    pollId = window.setInterval(() => {
      try {
        if (window.speechSynthesis.getVoices().length > 0) done();
      } catch {
        done();
      }
    }, 120);

    timeoutId = window.setTimeout(done, timeoutMs);
  });
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
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
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
  // Bipes e toques removidos: somente a assistente Melissa fala.
}

export function playRideAcceptedChime(): void {
  // Silenciado: somente a assistente Melissa anuncia o aceite.
}

export function playOfferAlertSound(): void {
  // Silenciado: sem toque de notificação.
}

function scoreMelissaVoice(voice: SpeechSynthesisVoice, activeLang: string): number {
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

  if (/(natural|neural|wavenet|studio|enhanced|aprimorada|premium)/i.test(name)) {
    score += 150;
  }
  if (!voice.localService || /(online|google|microsoft|apple)/i.test(name)) {
    score += 80;
  }

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
    'melissa',
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

  if (name.includes('thalita') || name.includes('francisca')) {
    score += 40;
  }

  return score;
}

export function listAvailableMelissaVoices(activeLang?: string): SpeechSynthesisVoice[] {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return [];
  bindVoicesChangedListener();
  const lang = (activeLang || getUserPreferences().language || 'pt-BR').toLowerCase();
  const prefix = lang.split('-')[0];
  const voices = window.speechSynthesis.getVoices();
  return [...voices]
    .filter((v) => v.lang.toLowerCase().startsWith(prefix) || v.lang.toLowerCase().startsWith('pt'))
    .sort((a, b) => scoreMelissaVoice(b, lang) - scoreMelissaVoice(a, lang));
}

function resolveMelissaVoice(activeLang: string): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
  bindVoicesChangedListener();
  const voices = window.speechSynthesis.getVoices();

  const langLower = activeLang.toLowerCase();
  if (!voices.length) return cachedVoiceByLang[langLower] || null;

  let bestVoice: SpeechSynthesisVoice | null = null;
  let bestScore = -Infinity;

  for (const voice of voices) {
    const s = scoreMelissaVoice(voice, activeLang);
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
  const preset = getActiveVoicePreset();
  const name = (voice?.name || '').toLowerCase();
  const isMicrosoftNatural =
    name.includes('microsoft') && (name.includes('natural') || name.includes('online'));

  if (isMicrosoftNatural) {
    return {
      rate: Math.max(0.85, Math.min(1.25, preset.rate - 0.02)),
      pitch: preset.pitch,
    };
  }
  return { rate: preset.rate, pitch: preset.pitch };
}

function clearSpeechWatchdog(): void {
  if (speechWatchdogTimer !== null) {
    window.clearTimeout(speechWatchdogTimer);
    speechWatchdogTimer = null;
  }
}

async function pumpSpeechQueue(onAllFinished?: () => void, afterCancel = false): Promise<void> {
  const prefs = getUserPreferences();
  if (!prefs.voice_enabled) {
    speechQueue.length = 0;
    isSpeakingFromQueue = false;
    clearSpeechWatchdog();
    onAllFinished?.();
    return;
  }

  if (isSpeakingFromQueue) return;
  if (speechQueue.length === 0) {
    onAllFinished?.();
    return;
  }
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    speechQueue.length = 0;
    onAllFinished?.();
    return;
  }

  const next = speechQueue.shift();
  if (!next) {
    onAllFinished?.();
    return;
  }

  const token = ++speechQueueToken;
  isSpeakingFromQueue = true;

  try {
    // Android WebView TTS bugfix: wait briefly after cancel() and ensure voices are loaded
    if (afterCancel) {
      await new Promise<void>((r) => window.setTimeout(r, 65));
    }
    if (token !== speechQueueToken) return;

    await waitForVoicesReady(650);
    if (token !== speechQueueToken) return;

    const utterance = new SpeechSynthesisUtterance(next.text);
    const activeLang = prefs.language || 'pt-BR';
    const voice = resolveMelissaVoice(activeLang);
    const { rate, pitch } = computeNaturalSpeechParams(voice);

    utterance.lang = voice?.lang || activeLang;
    utterance.rate = rate;
    utterance.pitch = pitch;
    utterance.volume = 1.0;

    if (voice) {
      utterance.voice = voice;
    }

    let advanced = false;
    const advance = () => {
      if (advanced || token !== speechQueueToken) return;
      advanced = true;
      clearSpeechWatchdog();
      isSpeakingFromQueue = false;
      void pumpSpeechQueue(onAllFinished, false);
    };

    utterance.onend = advance;
    utterance.onerror = advance;

    const estimatedMs = Math.min(20_000, Math.max(3600, next.text.length * 85));
    clearSpeechWatchdog();
    speechWatchdogTimer = window.setTimeout(advance, estimatedMs);

    try {
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
    } catch {
      // Ignore resume error
    }

    window.speechSynthesis.speak(utterance);
  } catch {
    clearSpeechWatchdog();
    isSpeakingFromQueue = false;
    onAllFinished?.();
  }
}

export function stopSpeech(): void {
  speechQueueToken += 1;
  speechQueue.length = 0;
  isSpeakingFromQueue = false;
  clearSpeechWatchdog();
  if (activeAudioElement) {
    try {
      activeAudioElement.pause();
      activeAudioElement.src = '';
    } catch {
      // Ignore
    }
    activeAudioElement = null;
  }
  try {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  } catch {
    // Ignore speech synthesis errors
  }
}

export function speakPtBr(text: string, interrupt = true, onDone?: () => void): void {
  const prefs = getUserPreferences();
  if (!prefs.voice_enabled) {
    onDone?.();
    return;
  }
  const clean = humanizeSpeechText(text);
  if (!clean) {
    onDone?.();
    return;
  }

  const now = Date.now();
  if (!interrupt && clean === lastSpokenText && now - lastSpokenAt < 3500) {
    onDone?.();
    return;
  }
  lastSpokenText = clean;
  lastSpokenAt = now;

  try {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      onDone?.();
      return;
    }

    const didInterrupt = interrupt;
    if (didInterrupt) {
      stopSpeech();
    } else if (speechQueue.some((item) => item.text === clean)) {
      onDone?.();
      return;
    }

    const clauses = splitHumanBreathClauses(clean);
    for (const clause of clauses) {
      if (speechQueue.length >= 6) {
        speechQueue.shift();
      }
      speechQueue.push({ text: clause });
    }
    void pumpSpeechQueue(onDone, didInterrupt);
  } catch {
    onDone?.();
  }
}

/**
 * Interactive Alexa-style natural speech for Melissa Assistant:
 * Attempts Gemini Natural TTS (/api/melissa/tts) when enabled, and falls back smoothly to Web Speech API.
 */
export async function speakWithMelissaNaturalVoice(
  text: string,
  options?: { interrupt?: boolean; forceGeminiTts?: boolean }
): Promise<void> {
  const prefs = getUserPreferences();
  if (!prefs.voice_enabled) return;
  const clean = humanizeSpeechText(text);
  if (!clean) return;

  if (options?.interrupt !== false) {
    stopSpeech();
  }

  const useGemini =
    options?.forceGeminiTts !== undefined
      ? options.forceGeminiTts
      : prefs.assistant_use_gemini_tts !== false;
  const preset = getActiveVoicePreset();

  if (useGemini && clean.length <= 420) {
    try {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 5500);
      const res = await fetch('/api/melissa/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: clean,
          voiceName: preset.geminiVoiceName,
          styleHint: preset.geminiStyleHint,
          language: prefs.language || 'pt-BR',
        }),
        signal: controller.signal,
      });
      window.clearTimeout(timeoutId);

      const contentType = (res.headers.get('content-type') || '').toLowerCase();
      if (res.ok && contentType.includes('application/json')) {
        const data = (await res.json()) as { ok?: boolean; audioBase64?: string; mimeType?: string };
        if (data.ok && data.audioBase64) {
          await new Promise<void>((resolve) => {
            const audio = new Audio(`data:${data.mimeType || 'audio/wav'};base64,${data.audioBase64}`);
            activeAudioElement = audio;
            const finish = () => {
              if (activeAudioElement === audio) activeAudioElement = null;
              resolve();
            };
            audio.onended = finish;
            audio.onerror = finish;
            audio.play().catch(() => {
              finish();
              speakPtBr(clean, true);
            });
          });
          return;
        }
      }
    } catch {
      // Fallback to local SpeechSynthesis below
    }
  }

  await new Promise<void>((resolve) => {
    speakPtBr(clean, options?.interrupt !== false, resolve);
  });
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
      return `Hi, ${enGreet}, ${displayName}! I'm Melissa from Go Driver. Your admin dashboard is ready whenever you need it.`;
    }
    if (user.role === 'driver') {
      return `Hi, ${enGreet}, ${displayName}! I'm Melissa from Go Driver. Ready to hit the road whenever you go online!`;
    }
    return `Hi, ${enGreet}, ${displayName}! I'm Melissa from Go Driver. Where are we heading today?`;
  }

  if (activeLang.startsWith('es')) {
    const esGreet =
      hour >= 5 && hour < 12
        ? 'buenos días'
        : hour >= 12 && hour < 18
        ? 'buenas tardes'
        : 'buenas noches';
    if (user.is_admin || user.role === 'admin') {
      return `¡Hola, ${esGreet}, ${displayName}! Soy Melissa, de Go Driver. El panel administrativo ya está listo.`;
    }
    if (user.role === 'driver') {
      return `¡Hola, ${esGreet}, ${displayName}! Soy Melissa, de Go Driver. Conéctate cuando quieras empezar a recibir viajes.`;
    }
    return `¡Hola, ${esGreet}, ${displayName}! Soy Melissa, de Go Driver. ¿A dónde vamos hoy?`;
  }

  const greeting = getTimeOfDayGreeting().toLowerCase();

  if (user.is_admin || user.role === 'admin') {
    return `Oi, ${greeting}, ${displayName}! Aqui é a Melissa, da Go Driver. O painel já está todo pronto pra você acompanhar corridas, verificações faciais, depósitos e saques.`;
  }

  if (user.role === 'driver') {
    const isDelivery = user.driver?.vehicle_type === 'delivery';
    const isOnline = Boolean(user.driver?.is_online);
    if (isDelivery) {
      return isOnline
        ? `Oi, ${greeting}, ${displayName}! Aqui é a Melissa, da Go Driver. Você já está online e pronto para receber novas entregas.`
        : `Oi, ${greeting}, ${displayName}! Aqui é a Melissa, da Go Driver. Quando quiser começar as entregas, é só tocar em conectar.`;
    }
    return isOnline
      ? `Oi, ${greeting}, ${displayName}! Aqui é a Melissa, da Go Driver. Você já está online e pronto para receber corridas.`
      : `Oi, ${greeting}, ${displayName}! Aqui é a Melissa, da Go Driver. Tudo pronto para rodar hoje — assim que quiser, é só tocar em conectar.`;
  }

  const debtNote =
    Number(user.pending_debt_amount || 0) > 0
      ? ` Só lembrando com carinho que há uma pendência anterior de ${Number(
          user.pending_debt_amount || 0
        )
          .toFixed(2)
          .replace('.', ',')} reais, que será somada na próxima corrida.`
      : '';

  return `Oi, ${greeting}, ${displayName}! Aqui é a Melissa, da Go Driver. Pra onde a gente vai hoje? É só escolher seu destino no mapa.${debtNote}`;
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
