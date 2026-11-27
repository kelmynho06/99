import type { MapLayerMode, ThemeMode, UserPreferences } from '../types/mobility';

const PREFS_KEY = 'velo99_user_prefs_v1';
const LANG_EXPLICIT_KEY = 'velo99_lang_explicit_v1';
const COOKIE_KEY = 'velo99_cookie_consent_v1';
const PERMS_SEEN_KEY = 'velo99_perms_prompt_seen_v1';
const PREFS_EVENT = 'velo99:prefs-changed';

export function markExplicitLanguageChoice(): void {
  try {
    sessionStorage.setItem(LANG_EXPLICIT_KEY, '1');
  } catch {
    // Ignore storage restriction
  }
}

export function consumeExplicitLanguageChoice(): boolean {
  try {
    const has = sessionStorage.getItem(LANG_EXPLICIT_KEY) === '1';
    sessionStorage.removeItem(LANG_EXPLICIT_KEY);
    return has;
  } catch {
    return false;
  }
}

export const DEFAULT_USER_PREFS: UserPreferences = {
  voice_enabled: true,
  sounds_enabled: true,
  notifications_enabled: true,
  language: 'pt-BR',
  theme_mode: 'light',
  map_layer: 'urban',
  hud_compass_enabled: true,
  floating_bubble_enabled: true,
  assistant_voice_id: 'melissa-maps',
  assistant_voice_name: '',
  assistant_use_gemini_tts: true,
  driver_goal_day: 200,
  driver_goal_week: 1000,
  driver_goal_month: 4000,
};

export function getUserPreferences(): UserPreferences {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_USER_PREFS;
    const parsed = JSON.parse(raw) as Partial<UserPreferences>;
    return {
      voice_enabled: parsed.voice_enabled ?? true,
      sounds_enabled: parsed.sounds_enabled ?? true,
      notifications_enabled: parsed.notifications_enabled ?? true,
      language: parsed.language || 'pt-BR',
      theme_mode:
        parsed.theme_mode === 'dark' || parsed.theme_mode === 'light' || parsed.theme_mode === 'auto'
          ? parsed.theme_mode
          : 'light',
      map_layer: 'urban' as MapLayerMode,
      hud_compass_enabled: parsed.hud_compass_enabled ?? true,
      floating_bubble_enabled: parsed.floating_bubble_enabled ?? true,
      assistant_voice_id: parsed.assistant_voice_id || 'melissa-maps',
      assistant_voice_name: parsed.assistant_voice_name || '',
      assistant_use_gemini_tts: parsed.assistant_use_gemini_tts ?? true,
      driver_goal_day: Number(parsed.driver_goal_day) > 0 ? Number(parsed.driver_goal_day) : 200,
      driver_goal_week: Number(parsed.driver_goal_week) > 0 ? Number(parsed.driver_goal_week) : 1000,
      driver_goal_month: Number(parsed.driver_goal_month) > 0 ? Number(parsed.driver_goal_month) : 4000,
    };
  } catch {
    return DEFAULT_USER_PREFS;
  }
}

export function isDarkThemeActive(mode?: ThemeMode): boolean {
  const effective = mode ?? getUserPreferences().theme_mode;
  if (effective === 'dark') return true;
  if (effective === 'light') return false;
  const hour = new Date().getHours();
  return hour >= 18 || hour < 6;
}

export function applyThemeToDocument(mode?: ThemeMode, lang?: string): boolean {
  const prefs = getUserPreferences();
  const dark = isDarkThemeActive(mode ?? prefs.theme_mode);
  if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('dark', dark);
    const activeLang = lang ?? prefs.language ?? 'pt-BR';
    document.documentElement.lang = activeLang;
    document.documentElement.dir = activeLang === 'ar' ? 'rtl' : 'ltr';
  }
  return dark;
}

export function saveUserPreferences(patch: Partial<UserPreferences>): UserPreferences {
  const next = { ...getUserPreferences(), ...patch };
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(next));
    applyThemeToDocument(next.theme_mode, next.language);
    window.dispatchEvent(new CustomEvent(PREFS_EVENT, { detail: next }));
  } catch {
    // Ignore storage quota restrictions
  }
  return next;
}

export function subscribeUserPreferences(cb: (prefs: UserPreferences) => void): () => void {
  const handler = () => cb(getUserPreferences());
  window.addEventListener(PREFS_EVENT, handler);
  window.addEventListener('storage', handler);
  return () => {
    window.removeEventListener(PREFS_EVENT, handler);
    window.removeEventListener('storage', handler);
  };
}

export type CookieConsentChoice = 'all' | 'essential' | null;

export function getCookieConsent(): CookieConsentChoice {
  try {
    const v = localStorage.getItem(COOKIE_KEY);
    if (v === 'all' || v === 'essential') return v;
    return null;
  } catch {
    return null;
  }
}

export function setCookieConsent(choice: 'all' | 'essential'): void {
  try {
    localStorage.setItem(COOKIE_KEY, choice);
  } catch {
    // Ignore
  }
}

export function hasSeenPermissionsPrompt(): boolean {
  try {
    return localStorage.getItem(PERMS_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function markPermissionsPromptSeen(): void {
  try {
    localStorage.setItem(PERMS_SEEN_KEY, '1');
  } catch {
    // Ignore
  }
}
