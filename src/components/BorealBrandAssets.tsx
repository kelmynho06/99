import React from 'react';
import type { RideCategory } from '../types/mobility';

interface GoDriverLogoMarkProps {
  className?: string;
  size?: number;
}

/**
 * Símbolo vetorial oficial da Go Driver Mobilidade:
 * Emblema geométrico em G + seta dinâmica de movimento em Azul Elétrico (#2563EB / #0EA5E9).
 */
export const GoDriverLogoMark: React.FC<GoDriverLogoMarkProps> = ({
  className = 'h-10 w-10',
  size,
}) => (
  <svg
    viewBox="0 0 128 128"
    width={size}
    height={size}
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
  >
    <defs>
      <linearGradient id="goMarkBg" x1="0" y1="0" x2="128" y2="128" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#FFFFFF" />
        <stop offset="100%" stopColor="#F4F6F9" />
      </linearGradient>
      <linearGradient id="goMarkStroke" x1="26" y1="100" x2="104" y2="24" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#1D4ED8" />
        <stop offset="55%" stopColor="#2563EB" />
        <stop offset="100%" stopColor="#0EA5E9" />
      </linearGradient>
    </defs>
    <rect width="128" height="128" rx="30" fill="url(#goMarkBg)" />
    <rect x="2" y="2" width="124" height="124" rx="28" stroke="#E2E8F0" strokeWidth="2.5" />
    <path
      d="M84 48C78.5 40 69.5 35 59.5 35C43 35 30 48 30 65C30 82 43 95 59.5 95C74.5 95 86 85 88.5 70.5H65"
      stroke="url(#goMarkStroke)"
      strokeWidth="12"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M52 75L92 35M92 35H70M92 35V57"
      stroke="url(#goMarkStroke)"
      strokeWidth="11"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const BorealLogoMark = GoDriverLogoMark;

interface GoDriverVehicleSvgProps {
  category: RideCategory;
  className?: string;
}

/**
 * Ícones autorais de veículos e entregas Go Driver Mobilidade em tema claro limpo.
 */
export const GoDriverVehicleSvg: React.FC<GoDriverVehicleSvgProps> = ({
  category,
  className = 'h-12 w-14',
}) => {
  if (category === 'moto' || category === 'delivery_moto') {
    const isDelivery = category === 'delivery_moto';
    return (
      <svg
        viewBox="0 0 88 64"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
        aria-hidden="true"
      >
        <ellipse cx="44" cy="54" rx="30" ry="4.5" fill="#2563EB" fillOpacity="0.14" />
        <circle cx="22" cy="43" r="10.5" stroke="#0F172A" strokeWidth="4" fill="#FFFFFF" />
        <circle cx="22" cy="43" r="4" fill="#0EA5E9" />
        <circle cx="67" cy="43" r="10.5" stroke="#0F172A" strokeWidth="4" fill="#FFFFFF" />
        <circle cx="67" cy="43" r="4" fill="#2563EB" />

        {isDelivery && (
          <g>
            <rect
              x="9"
              y="18"
              width="21"
              height="16"
              rx="4"
              fill="#2563EB"
              stroke="#0F172A"
              strokeWidth="2"
            />
            <path d="M13 24H26" stroke="#EFF6FF" strokeWidth="2.5" strokeLinecap="round" />
            <circle cx="19.5" cy="28.5" r="1.8" fill="#10B981" />
          </g>
        )}

        <path
          d="M22 43L33 30H49L58 22H65L59 34L67 43"
          stroke="#0F172A"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M31 29C35 26 44 26 51 28L56 34C48 39 36 40 28 37L31 29Z"
          fill="#2563EB"
          fillOpacity="0.18"
          stroke="#2563EB"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        <path d="M29 27.5C33 25.5 41 25.5 46 27.5" stroke="#0F172A" strokeWidth="4" strokeLinecap="round" />
        <path d="M54 19L61 21" stroke="#0F172A" strokeWidth="3" strokeLinecap="round" />
        <ellipse cx="64.5" cy="25.5" rx="3.2" ry="2.2" fill="#0EA5E9" stroke="#2563EB" strokeWidth="1.5" />
      </svg>
    );
  }

  const isNegocia = category === 'negocia';
  const isDeliveryCar = category === 'delivery_car';

  return (
    <svg
      viewBox="0 0 88 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <ellipse cx="44" cy="53" rx="33" ry="4.5" fill="#2563EB" fillOpacity="0.14" />
      <path
        d="M11 36C11 31.8 14.1 28.4 18.2 27.7L26 26.2L34.5 18.2C36.9 16 40 14.8 43.3 14.8H56.5C60.4 14.8 64 16.7 66.2 19.9L72 28L77.5 29.4C80.2 30.1 82 32.5 82 35.2V40.5C82 42.4 80.4 44 78.5 44H14.5C12.6 44 11 42.4 11 40.5V36Z"
        fill="#FFFFFF"
        stroke="#0F172A"
        strokeWidth="2.6"
        strokeLinejoin="round"
      />
      <path
        d="M36 18.8L29.5 26H47.5V18.8H36ZM51 18.8V26H66.5L62.2 20.6C60.9 19.4 59.2 18.8 57.4 18.8H51Z"
        fill="#DBEAFE"
        stroke="#0F172A"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M26 34.5H68" stroke="#2563EB" strokeWidth="2.8" strokeLinecap="round" />
      <rect x="76" y="32" width="5" height="3.2" rx="1.6" fill="#0EA5E9" />

      <circle cx="25" cy="44" r="7.5" fill="#0F172A" stroke="#FFFFFF" strokeWidth="2" />
      <circle cx="25" cy="44" r="3" fill="#0EA5E9" />
      <circle cx="65" cy="44" r="7.5" fill="#0F172A" stroke="#FFFFFF" strokeWidth="2" />
      <circle cx="65" cy="44" r="3" fill="#2563EB" />

      {isDeliveryCar && (
        <g>
          <rect x="6" y="25" width="21" height="19" rx="4.5" fill="#2563EB" stroke="#FFFFFF" strokeWidth="2" />
          <path d="M11 32H22" stroke="#EFF6FF" strokeWidth="2.4" strokeLinecap="round" />
          <path d="M16.5 26.5V41" stroke="#10B981" strokeWidth="1.8" strokeLinecap="round" />
        </g>
      )}

      {isNegocia && (
        <g>
          <circle cx="71" cy="17" r="9.5" fill="#10B981" stroke="#FFFFFF" strokeWidth="2" />
          <path
            d="M67 17H75M72.5 14.5L75 17L72.5 19.5"
            stroke="#FFFFFF"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      )}
    </svg>
  );
};

export const BorealVehicleSvg = GoDriverVehicleSvg;
