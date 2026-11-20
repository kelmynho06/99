import React from 'react';
import type { RideCategory } from '../types/mobility';

interface BorealLogoMarkProps {
  className?: string;
  size?: number;
}

/**
 * Símbolo vetorial original da Boreal Mobilidade:
 * Fita contínua inspirada na aurora boreal formando um "B" aerodinâmico + estrela polar de rota.
 */
export const BorealLogoMark: React.FC<BorealLogoMarkProps> = ({
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
      <linearGradient id="borealMarkBg" x1="0" y1="0" x2="128" y2="128" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#082823" />
        <stop offset="55%" stopColor="#0F2421" />
        <stop offset="100%" stopColor="#065F46" />
      </linearGradient>
      <linearGradient id="borealRibbon" x1="28" y1="100" x2="100" y2="26" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#047857" />
        <stop offset="48%" stopColor="#2DD4BF" />
        <stop offset="100%" stopColor="#6EE7B7" />
      </linearGradient>
      <linearGradient id="borealInnerTrail" x1="36" y1="68" x2="86" y2="42" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#A7F3D0" />
        <stop offset="100%" stopColor="#06B6D4" />
      </linearGradient>
    </defs>
    <rect width="128" height="128" rx="30" fill="url(#borealMarkBg)" />
    <circle cx="64" cy="64" r="41" stroke="#6EE7B7" strokeOpacity="0.18" strokeWidth="1.5" />
    <path
      d="M40 94V38C40 34.4 42.9 31.5 46.5 31.5H66C78.8 31.5 88 38.6 88 49C88 55.5 84.1 60.8 77.5 63.2C86.2 65.5 91.5 72.3 91.5 80.5C91.5 91.5 81.9 98.5 67.5 98.5H44.5C42 98.5 40 96.5 40 94Z"
      stroke="url(#borealRibbon)"
      strokeWidth="8.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M41.5 65C52.5 65 61 61.5 69 56.5C75 52.8 78.5 48.8 78.5 44.5"
      stroke="url(#borealInnerTrail)"
      strokeWidth="6.5"
      strokeLinecap="round"
    />
    <path
      d="M53.5 83.5H67.5C74 83.5 78.5 80.2 78.5 75.7C78.5 71.4 74.5 68.5 67.8 68.5H52"
      stroke="#ECFDF5"
      strokeOpacity="0.92"
      strokeWidth="5"
      strokeLinecap="round"
    />
    <circle cx="90" cy="34" r="5" fill="#6EE7B7" />
    <circle cx="90" cy="34" r="2.2" fill="#FFFFFF" />
  </svg>
);

interface BorealVehicleSvgProps {
  category: RideCategory;
  className?: string;
}

/**
 * Ícones autorais de veículos e entregas Boreal Mobilidade com traço limpo e paleta Aurora Boreal.
 */
export const BorealVehicleSvg: React.FC<BorealVehicleSvgProps> = ({
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
        {/* Soft aurora ground shadow */}
        <ellipse cx="44" cy="54" rx="30" ry="4.5" fill="#2DD4BF" fillOpacity="0.18" />
        {/* Rear & Front wheels */}
        <circle cx="22" cy="43" r="10.5" stroke="#0F2421" strokeWidth="4" fill="#FFFFFF" />
        <circle cx="22" cy="43" r="4" fill="#2DD4BF" />
        <circle cx="67" cy="43" r="10.5" stroke="#0F2421" strokeWidth="4" fill="#FFFFFF" />
        <circle cx="67" cy="43" r="4" fill="#047857" />

        {/* Delivery Parcel Box on rear rack */}
        {isDelivery && (
          <g>
            <rect
              x="9"
              y="18"
              width="21"
              height="16"
              rx="4"
              fill="#047857"
              stroke="#0F2421"
              strokeWidth="2"
            />
            <path d="M13 24H26" stroke="#6EE7B7" strokeWidth="2.5" strokeLinecap="round" />
            <circle cx="19.5" cy="28.5" r="1.8" fill="#2DD4BF" />
          </g>
        )}

        {/* Frame & aerodynamic body */}
        <path
          d="M22 43L33 30H49L58 22H65L59 34L67 43"
          stroke="#0F2421"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M31 29C35 26 44 26 51 28L56 34C48 39 36 40 28 37L31 29Z"
          fill="#06B6D4"
          fillOpacity="0.22"
          stroke="#047857"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        {/* Seat */}
        <path d="M29 27.5C33 25.5 41 25.5 46 27.5" stroke="#0F2421" strokeWidth="4" strokeLinecap="round" />
        {/* Handlebar & headlight */}
        <path d="M54 19L61 21" stroke="#0F2421" strokeWidth="3" strokeLinecap="round" />
        <ellipse cx="64.5" cy="25.5" rx="3.2" ry="2.2" fill="#6EE7B7" stroke="#047857" strokeWidth="1.5" />
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
      {/* Ground glow */}
      <ellipse cx="44" cy="53" rx="33" ry="4.5" fill="#2DD4BF" fillOpacity="0.18" />
      {/* Car body */}
      <path
        d="M11 36C11 31.8 14.1 28.4 18.2 27.7L26 26.2L34.5 18.2C36.9 16 40 14.8 43.3 14.8H56.5C60.4 14.8 64 16.7 66.2 19.9L72 28L77.5 29.4C80.2 30.1 82 32.5 82 35.2V40.5C82 42.4 80.4 44 78.5 44H14.5C12.6 44 11 42.4 11 40.5V36Z"
        fill="#FFFFFF"
        stroke="#0F2421"
        strokeWidth="2.6"
        strokeLinejoin="round"
      />
      {/* Cabin windows with aurora cyan tint */}
      <path
        d="M36 18.8L29.5 26H47.5V18.8H36ZM51 18.8V26H66.5L62.2 20.6C60.9 19.4 59.2 18.8 57.4 18.8H51Z"
        fill="#CCFBF1"
        stroke="#0F2421"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      {/* Aurora accent side stripe */}
      <path d="M26 34.5H68" stroke="#2DD4BF" strokeWidth="2.8" strokeLinecap="round" />
      {/* Headlight */}
      <rect x="76" y="32" width="5" height="3.2" rx="1.6" fill="#6EE7B7" />

      {/* Wheels */}
      <circle cx="25" cy="44" r="7.5" fill="#0F2421" stroke="#FFFFFF" strokeWidth="2" />
      <circle cx="25" cy="44" r="3" fill="#6EE7B7" />
      <circle cx="65" cy="44" r="7.5" fill="#0F2421" stroke="#FFFFFF" strokeWidth="2" />
      <circle cx="65" cy="44" r="3" fill="#2DD4BF" />

      {/* Delivery parcel badge for delivery_car */}
      {isDeliveryCar && (
        <g>
          <rect x="6" y="25" width="21" height="19" rx="4.5" fill="#047857" stroke="#FFFFFF" strokeWidth="2" />
          <path d="M11 32H22" stroke="#6EE7B7" strokeWidth="2.4" strokeLinecap="round" />
          <path d="M16.5 26.5V41" stroke="#2DD4BF" strokeWidth="1.8" strokeLinecap="round" />
        </g>
      )}

      {/* Fair-deal aurora badge for negocia */}
      {isNegocia && (
        <g>
          <circle cx="71" cy="17" r="9.5" fill="#047857" stroke="#FFFFFF" strokeWidth="2" />
          <path
            d="M67 17H75M72.5 14.5L75 17L72.5 19.5"
            stroke="#6EE7B7"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      )}
    </svg>
  );
};
