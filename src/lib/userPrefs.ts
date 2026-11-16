import type { UserPreferences } from '../types/mobility';

const PREFS_KEY = 'velo99_user_prefs_v1';
const COOKIE_KEY = 'velo99_cookie_consent_v1';
const PERMS_SEEN_KEY = 'velo99_perms_prompt_seen_v1';
const PREFS_EVENT = 'velo99:prefs-changed';

export const DEFAULT_USER_PREFS: UserPreferences = {
  voice_enabled: true,
  sounds_enabled: true,
  notifications_enabled: true,
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
    };
  } catch {
    return DEFAULT_USER_PREFS;
  }
}

export function saveUserPreferences(patch: Partial<UserPreferences>): UserPreferences {
  const next = { ...getUserPreferences(), ...patch };
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(next));
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
