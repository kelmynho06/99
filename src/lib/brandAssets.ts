import type React from 'react';
import goDriverBrandLogo from '../assets/images/go_driver_logo_1795615132360.jpg';
import veloCarPopImg from '../assets/images/velo_car_pop_1794857333460.jpg';
import veloDeliveryCarImg from '../assets/images/velo_delivery_car_1794857334048.jpg';
import veloDeliveryMotoImg from '../assets/images/velo_delivery_moto_1794857334549.jpg';
import veloMotoUrbanImg from '../assets/images/velo_moto_urban_1794857333529.jpg';
import type { PlatformConfig, RideCategory } from '../types/mobility';

export const GODRIVER_INLINE_LOGO_SVG =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" fill="none">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="120" y2="120" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#1D4ED8"/>
          <stop offset="55%" stop-color="#2563EB"/>
          <stop offset="100%" stop-color="#0EA5E9"/>
        </linearGradient>
      </defs>
      <rect width="120" height="120" rx="28" fill="url(#g)"/>
      <path d="M25 69c0-8 5-14 13-16l12-3 12-12c4-4 9-6 15-6h13c4 0 8 3 9 7l5 14 4 2c4 1 6 5 6 9v6c0 3-2 5-5 5h-5a11 11 0 0 1-22 0H48a11 11 0 0 1-22 0h-1c-3 0-5-2-5-5v-1z" fill="#FFFFFF"/>
      <circle cx="37" cy="76" r="6" fill="#0F172A"/>
      <circle cx="93" cy="76" r="6" fill="#0F172A"/>
      <text x="60" y="34" text-anchor="middle" font-family="Arial,sans-serif" font-weight="800" font-size="16" fill="#FFFFFF">GoDriver</text>
    </svg>`
  );

export const DEFAULT_BRAND_LOGO = goDriverBrandLogo || GODRIVER_INLINE_LOGO_SVG;

export const DEFAULT_VEHICLE_IMAGES: Record<RideCategory, string> = {
  moto: veloMotoUrbanImg,
  pop: veloCarPopImg,
  negocia: veloCarPopImg,
  delivery_moto: veloDeliveryMotoImg,
  delivery_car: veloDeliveryCarImg,
};

/**
 * Normaliza URLs externas de imagem (incluindo links de compartilhamento do Google Drive)
 * para um endpoint direto renderizável dentro de tags <img>, PWA e Capacitor.
 */
export function normalizeImageUrl(rawUrl?: string | null): string | null {
  const clean = typeof rawUrl === 'string' ? rawUrl.trim() : '';
  if (!clean) return null;

  const lower = clean.toLowerCase();
  if (
    lower.includes('mobilidade66_logo') ||
    lower.includes('boreal_brand_logo') ||
    lower.includes('velo_brand_icon')
  ) {
    return null;
  }

  // Converte links do Google Drive (/file/d/ID, open?id=ID, uc?id=ID, thumbnail?id=ID)
  if (lower.includes('drive.google.com') || lower.includes('docs.google.com')) {
    const fileMatch = clean.match(/\/d\/([a-zA-Z0-9_-]{10,})/);
    const queryMatch = clean.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
    const driveId = fileMatch?.[1] || queryMatch?.[1];
    if (driveId) {
      return `https://lh3.googleusercontent.com/d/${driveId}`;
    }
  }

  if (lower.startsWith('http://') && !lower.includes('localhost') && !lower.includes('127.0.0.1')) {
    return `https://${clean.slice(7)}`;
  }

  return clean;
}

export function resolveBrandLogo(config?: PlatformConfig | null): string {
  const normalized = normalizeImageUrl(config?.app_logo_url);
  return normalized || DEFAULT_BRAND_LOGO;
}

export function resolveCategoryVehicleImage(
  category: RideCategory,
  config?: PlatformConfig | null
): string {
  if (category === 'moto') {
    return normalizeImageUrl(config?.vehicle_img_moto) || DEFAULT_VEHICLE_IMAGES.moto;
  }
  if (category === 'pop' || category === 'negocia') {
    return normalizeImageUrl(config?.vehicle_img_pop) || DEFAULT_VEHICLE_IMAGES.pop;
  }
  if (category === 'delivery_moto') {
    return (
      normalizeImageUrl(config?.vehicle_img_delivery_moto) ||
      DEFAULT_VEHICLE_IMAGES.delivery_moto
    );
  }
  return (
    normalizeImageUrl(config?.vehicle_img_delivery_car) ||
    DEFAULT_VEHICLE_IMAGES.delivery_car
  );
}

export function handleBrandImageError(
  event: React.SyntheticEvent<HTMLImageElement>,
  fallbackSrc: string = DEFAULT_BRAND_LOGO
): void {
  const img = event.currentTarget;
  const step = img.dataset.fbStep || '';
  if (!step && fallbackSrc && img.src !== fallbackSrc) {
    img.dataset.fbStep = 'primary';
    img.src = fallbackSrc;
    return;
  }
  if (step !== 'svg' && img.src !== GODRIVER_INLINE_LOGO_SVG) {
    img.dataset.fbStep = 'svg';
    img.src = GODRIVER_INLINE_LOGO_SVG;
  }
}
