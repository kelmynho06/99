export type ThemePresetId =
  | 'electric_blue'
  | 'sky_daylight'
  | 'emerald_urban'
  | 'mint_aurora'
  | 'amber_express'
  | 'coral_sunset'
  | 'violet_pulse'
  | 'indigo_pro'
  | 'graphite_clean'
  | 'midnight_neon'
  | 'obsidian_gold'
  | 'ocean_deep'
  | 'christmas_festive'
  | 'black_friday';

export interface ThemePreset {
  id: ThemePresetId;
  name: string;
  category: 'Claros' | 'Urbanos' | 'Escuros' | 'Sazonais';
  isDarkSurface: boolean;
  primary: string;
  primaryHover: string;
  secondary: string;
  skyAccent: string;
  tint: string;
  canvas: string;
  surface: string;
  surfaceMuted: string;
  border: string;
  ink: string;
  inkMuted: string;
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: 'electric_blue',
    name: 'Azul Elétrico (Padrão)',
    category: 'Claros',
    isDarkSurface: false,
    primary: '#2563EB',
    primaryHover: '#1D4ED8',
    secondary: '#0F172A',
    skyAccent: '#0EA5E9',
    tint: '#EFF6FF',
    canvas: '#F4F6F9',
    surface: '#FFFFFF',
    surfaceMuted: '#F1F5F9',
    border: '#E2E8F0',
    ink: '#0F172A',
    inkMuted: '#475569',
  },
  {
    id: 'sky_daylight',
    name: 'Céu Limpo & Turquesa',
    category: 'Claros',
    isDarkSurface: false,
    primary: '#0284C7',
    primaryHover: '#0369A1',
    secondary: '#0C4A6E',
    skyAccent: '#06B6D4',
    tint: '#E0F2FE',
    canvas: '#F0F9FF',
    surface: '#FFFFFF',
    surfaceMuted: '#E0F2FE',
    border: '#BAE6FD',
    ink: '#0F172A',
    inkMuted: '#334155',
  },
  {
    id: 'emerald_urban',
    name: 'Verde Esmeralda Claro',
    category: 'Claros',
    isDarkSurface: false,
    primary: '#059669',
    primaryHover: '#047857',
    secondary: '#064E3B',
    skyAccent: '#10B981',
    tint: '#ECFDF5',
    canvas: '#F4FBF8',
    surface: '#FFFFFF',
    surfaceMuted: '#ECFDF5',
    border: '#D1FAE5',
    ink: '#0F172A',
    inkMuted: '#334155',
  },
  {
    id: 'mint_aurora',
    name: 'Menta & Ciano Suave',
    category: 'Claros',
    isDarkSurface: false,
    primary: '#0D9488',
    primaryHover: '#0F766E',
    secondary: '#134E4A',
    skyAccent: '#14B8A6',
    tint: '#F0FDFA',
    canvas: '#F5FBFA',
    surface: '#FFFFFF',
    surfaceMuted: '#CCFBF1',
    border: '#99F6E4',
    ink: '#0F172A',
    inkMuted: '#334155',
  },
  {
    id: 'amber_express',
    name: 'Âmbar Urbano Express',
    category: 'Urbanos',
    isDarkSurface: false,
    primary: '#D97706',
    primaryHover: '#B45309',
    secondary: '#1E293B',
    skyAccent: '#F59E0B',
    tint: '#FEF3C7',
    canvas: '#FAF8F5',
    surface: '#FFFFFF',
    surfaceMuted: '#F3F4F6',
    border: '#E5E7EB',
    ink: '#0F172A',
    inkMuted: '#475569',
  },
  {
    id: 'coral_sunset',
    name: 'Coral & Laranja Vivo',
    category: 'Urbanos',
    isDarkSurface: false,
    primary: '#EA580C',
    primaryHover: '#C2410C',
    secondary: '#1C1917',
    skyAccent: '#F97316',
    tint: '#FFEDD5',
    canvas: '#FFFBF7',
    surface: '#FFFFFF',
    surfaceMuted: '#FFF7ED',
    border: '#FED7AA',
    ink: '#0F172A',
    inkMuted: '#475569',
  },
  {
    id: 'violet_pulse',
    name: 'Violeta Executivo',
    category: 'Urbanos',
    isDarkSurface: false,
    primary: '#7C3AED',
    primaryHover: '#6D28D9',
    secondary: '#1E1B4B',
    skyAccent: '#8B5CF6',
    tint: '#F5F3FF',
    canvas: '#F8F7FC',
    surface: '#FFFFFF',
    surfaceMuted: '#EDE9FE',
    border: '#DDD6FE',
    ink: '#0F172A',
    inkMuted: '#475569',
  },
  {
    id: 'indigo_pro',
    name: 'Índigo Corporativo',
    category: 'Urbanos',
    isDarkSurface: false,
    primary: '#4F46E5',
    primaryHover: '#4338CA',
    secondary: '#1E1B4B',
    skyAccent: '#6366F1',
    tint: '#EEF2FF',
    canvas: '#F5F7FC',
    surface: '#FFFFFF',
    surfaceMuted: '#E0E7FF',
    border: '#C7D2FE',
    ink: '#0F172A',
    inkMuted: '#475569',
  },
  {
    id: 'graphite_clean',
    name: 'Grafite Minimalista',
    category: 'Urbanos',
    isDarkSurface: false,
    primary: '#1E293B',
    primaryHover: '#0F172A',
    secondary: '#334155',
    skyAccent: '#475569',
    tint: '#F1F5F9',
    canvas: '#F8FAFC',
    surface: '#FFFFFF',
    surfaceMuted: '#F1F5F9',
    border: '#CBD5E1',
    ink: '#0F172A',
    inkMuted: '#475569',
  },
  {
    id: 'midnight_neon',
    name: 'Noturno Ciano Neon',
    category: 'Escuros',
    isDarkSurface: true,
    primary: '#0EA5E9',
    primaryHover: '#0284C7',
    secondary: '#020617',
    skyAccent: '#38BDF8',
    tint: '#0C4A6E',
    canvas: '#020617',
    surface: '#0F172A',
    surfaceMuted: '#1E293B',
    border: '#334155',
    ink: '#F8FAFC',
    inkMuted: '#CBD5E1',
  },
  {
    id: 'obsidian_gold',
    name: 'Obsidiana & Ouro VIP',
    category: 'Escuros',
    isDarkSurface: true,
    primary: '#D97706',
    primaryHover: '#B45309',
    secondary: '#111827',
    skyAccent: '#F59E0B',
    tint: '#451A03',
    canvas: '#090D16',
    surface: '#111827',
    surfaceMuted: '#1F2937',
    border: '#374151',
    ink: '#F8FAFC',
    inkMuted: '#D1D5DB',
  },
  {
    id: 'ocean_deep',
    name: 'Oceano Profundo',
    category: 'Escuros',
    isDarkSurface: true,
    primary: '#14B8A6',
    primaryHover: '#0D9488',
    secondary: '#042F2E',
    skyAccent: '#2DD4BF',
    tint: '#134E4A',
    canvas: '#04121D',
    surface: '#0B1D2E',
    surfaceMuted: '#132A40',
    border: '#1E3A5F',
    ink: '#F8FAFC',
    inkMuted: '#CBD5E1',
  },
  {
    id: 'christmas_festive',
    name: 'Edição Festiva',
    category: 'Sazonais',
    isDarkSurface: false,
    primary: '#DC2626',
    primaryHover: '#B91C1C',
    secondary: '#14532D',
    skyAccent: '#16A34A',
    tint: '#FEF2F2',
    canvas: '#FFF8F8',
    surface: '#FFFFFF',
    surfaceMuted: '#FEE2E2',
    border: '#FECACA',
    ink: '#0F172A',
    inkMuted: '#475569',
  },
  {
    id: 'black_friday',
    name: 'Turbo Night Deals',
    category: 'Sazonais',
    isDarkSurface: true,
    primary: '#E11D48',
    primaryHover: '#BE123C',
    secondary: '#09090B',
    skyAccent: '#FB7185',
    tint: '#4C0519',
    canvas: '#09090B',
    surface: '#18181B',
    surfaceMuted: '#27272A',
    border: '#3F3F46',
    ink: '#FAFAFA',
    inkMuted: '#D4D4D8',
  },
];

export function resolveThemePreset(presetId?: string | null): ThemePreset {
  const found = THEME_PRESETS.find((p) => p.id === presetId);
  return found || THEME_PRESETS[0];
}

function shiftHexLightness(hex: string, ratio: number): string {
  const clean = hex.replace('#', '');
  if (!/^[0-9A-Fa-f]{6}$/.test(clean)) return hex;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  const adjust = (c: number) =>
    ratio >= 0
      ? Math.min(255, Math.round(c + (255 - c) * ratio))
      : Math.max(0, Math.round(c * (1 + ratio)));
  return `#${[adjust(r), adjust(g), adjust(b)]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')}`;
}

export function applyGlobalThemePreset(
  presetId?: string | null,
  customPrimary?: string | null,
  customSecondary?: string | null
): ThemePreset {
  const preset = resolveThemePreset(presetId);
  const hasCustomPrimary = Boolean(
    customPrimary && /^#[0-9A-Fa-f]{6}$/.test(customPrimary.trim())
  );
  const primary = hasCustomPrimary ? customPrimary!.trim() : preset.primary;
  const secondary =
    customSecondary && /^#[0-9A-Fa-f]{6}$/.test(customSecondary.trim())
      ? customSecondary.trim()
      : preset.secondary;

  const isSameAsPresetPrimary = primary.toLowerCase() === preset.primary.toLowerCase();
  const primaryHover = isSameAsPresetPrimary
    ? preset.primaryHover
    : shiftHexLightness(primary, -0.14);
  const glowColor = isSameAsPresetPrimary
    ? preset.skyAccent
    : shiftHexLightness(primary, 0.22);
  const tintColor = isSameAsPresetPrimary
    ? preset.tint
    : shiftHexLightness(primary, 0.88);

  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    // Standardized palette variables (only colors change; animations/transitions stay intact)
    root.style.setProperty('--color-primary', primary);
    root.style.setProperty('--color-primary-hover', primaryHover);
    root.style.setProperty('--color-secondary', secondary);
    root.style.setProperty('--color-glow', glowColor);
    root.style.setProperty('--color-tint', tintColor);
    root.style.setProperty('--bg-canvas', preset.canvas);
    root.style.setProperty('--bg-surface', preset.surface);
    root.style.setProperty('--bg-surface-muted', preset.surfaceMuted);
    root.style.setProperty('--color-border', preset.border);
    root.style.setProperty('--color-ink', preset.ink);
    root.style.setProperty('--color-ink-muted', preset.inkMuted);

    // Legacy aliases kept in sync
    root.style.setProperty('--brand-primary', primary);
    root.style.setProperty('--brand-secondary', secondary);
    root.style.setProperty('--godriver-blue', primary);
    root.style.setProperty('--godriver-blue-hover', primaryHover);
    root.style.setProperty('--godriver-sky', glowColor);
    root.style.setProperty('--godriver-blue-tint', tintColor);
    root.style.setProperty('--godriver-canvas', preset.canvas);
    root.style.setProperty('--godriver-surface', preset.surface);
    root.style.setProperty('--godriver-surface-muted', preset.surfaceMuted);
    root.style.setProperty('--godriver-border', preset.border);
    root.style.setProperty('--godriver-ink', preset.ink);
    root.style.setProperty('--godriver-ink-muted', preset.inkMuted);
    root.dataset.themePreset = preset.id;
    root.dataset.themeDarkSurface = preset.isDarkSurface ? 'true' : 'false';
  }
  return { ...preset, primary, secondary, primaryHover, skyAccent: glowColor, tint: tintColor };
}
