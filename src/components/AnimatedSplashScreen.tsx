import React from 'react';
import { motion } from 'motion/react';
import { handleBrandImageError, resolveBrandLogo } from '../lib/brandAssets';
import { useTranslation } from '../lib/i18n';
import type { PlatformConfig } from '../types/mobility';

interface AnimatedSplashScreenProps {
  platformConfig?: PlatformConfig | null;
}

export const AnimatedSplashScreen: React.FC<AnimatedSplashScreenProps> = ({ platformConfig }) => {
  const { t } = useTranslation();
  const brandName = platformConfig?.site_name?.trim() || 'Go Driver Mobilidade';
  const brandLogoUrl = resolveBrandLogo(platformConfig);

  return (
    <motion.div
      key="splash-godriver"
      initial={{ opacity: 1 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.02 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-between aurora-surface-flow px-6 py-12 text-[#0F172A] overflow-hidden select-none"
    >
      {/* Clean sky-blue light ribbons backdrop */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-90"
        style={{
          background:
            'radial-gradient(circle at 22% 24%, color-mix(in srgb, var(--brand-primary, #2563EB) 14%, transparent) 0%, rgba(255, 255, 255, 0) 52%), radial-gradient(circle at 80% 30%, color-mix(in srgb, var(--godriver-sky, #0EA5E9) 14%, transparent) 0%, rgba(255, 255, 255, 0) 48%)',
        }}
      />

      <div className="relative z-10 h-6" />

      {/* Center unified Go Driver logo + accelerating urban car */}
      <div className="relative z-10 flex flex-col items-center text-center">
        <div className="relative flex items-center justify-center">
          <motion.div
            animate={{ scale: [1, 1.24, 1], opacity: [0.45, 0.1, 0.45] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
            className="absolute h-32 w-32 rounded-[2.25rem] border-2"
            style={{ borderColor: 'color-mix(in srgb, var(--brand-primary, #2563EB) 38%, transparent)' }}
          />
          <motion.div
            animate={{ scale: [0.95, 1.12, 0.95], opacity: [0.22, 0.44, 0.22] }}
            transition={{ duration: 2.0, repeat: Infinity, ease: 'easeInOut' }}
            className="absolute h-28 w-28 rounded-[2rem] bg-[#38BDF8]/25 blur-xl"
          />

          <motion.div
            initial={{ scale: 1, opacity: 1, y: 0 }}
            animate={{ scale: [0.98, 1.02, 1], opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            className="relative flex h-24 w-24 items-center justify-center overflow-hidden rounded-[1.75rem] border-2 bg-white shadow-[0_18px_42px_rgba(37,99,235,0.18)]"
            style={{ borderColor: 'color-mix(in srgb, var(--brand-primary, #2563EB) 30%, transparent)' }}
          >
            <img
              src={brandLogoUrl}
              alt={brandName}
              referrerPolicy="no-referrer"
              onError={(e) => handleBrandImageError(e)}
              className="h-full w-full object-cover"
            />
          </motion.div>
        </div>

        <h1 className="mt-6 font-display text-3xl font-extrabold tracking-tight text-[#0F172A]">
          {brandName}
        </h1>

        <p
          className="mt-1.5 text-xs font-bold uppercase tracking-[0.22em]"
          style={{ color: 'var(--brand-primary, #2563EB)' }}
        >
          {t.brand_tagline}
        </p>

        {/* Speed track + accelerating Electric Blue SVG car */}
        <div className="relative mt-10 h-14 w-64 overflow-hidden">
          <div className="absolute bottom-2 left-0 right-0 h-0.5 bg-[#0F172A]/10 rounded-full" />
          <motion.div
            animate={{ x: [220, -140] }}
            transition={{ duration: 0.85, repeat: Infinity, ease: 'linear' }}
            className="absolute bottom-4 left-0 h-0.5 w-16 rounded-full bg-[#0EA5E9]/70"
          />
          <motion.div
            animate={{ x: [260, -120] }}
            transition={{ duration: 0.65, delay: 0.25, repeat: Infinity, ease: 'linear' }}
            className="absolute bottom-7 left-0 h-0.5 w-10 rounded-full bg-[#2563EB]/40"
          />

          <motion.div
            initial={{ x: -90, opacity: 0 }}
            animate={{ x: [-60, 78, 86], opacity: [0, 1, 1] }}
            transition={{ duration: 1.25, ease: [0.16, 1, 0.3, 1] }}
            className="absolute bottom-2.5 left-0"
          >
            <svg width="86" height="36" viewBox="0 0 86 36" fill="none" aria-hidden>
              <path
                d="M8 23C8 19.5 10.5 16.5 14 15.8L22 14.5L31 7.2C33.2 5.4 36 4.5 38.8 4.5H54.5C58 4.5 61.3 6.1 63.5 8.8L70 16.2L77.5 17.6C80.5 18.2 82.5 20.8 82.5 23.8V26.5C82.5 27.9 81.4 29 80 29H74.5C74.5 32.3 71.8 35 68.5 35C65.2 35 62.5 32.3 62.5 29H27.5C27.5 32.3 24.8 35 21.5 35C18.2 35 15.5 32.3 15.5 29H10.5C9.1 29 8 27.9 8 26.5V23Z"
                fill="#2563EB"
              />
              <path
                d="M32.5 8.5L26 14.5H45V8.5H32.5ZM48.5 8.5V14.5H63.5L59 9.5C57.9 8.9 56.5 8.5 55 8.5H48.5Z"
                fill="#DBEAFE"
              />
              <path d="M18 22.5H68" stroke="#38BDF8" strokeWidth="2.2" strokeLinecap="round" />
              <circle cx="21.5" cy="29" r="4.2" fill="#0F172A" stroke="#60A5FA" strokeWidth="2" />
              <circle cx="68.5" cy="29" r="4.2" fill="#0F172A" stroke="#38BDF8" strokeWidth="2" />
              <rect x="77" y="20" width="5" height="3" rx="1.5" fill="#38BDF8" />
            </svg>
          </motion.div>
        </div>
      </div>

      {/* Bottom smooth loader */}
      <div className="relative z-10 flex flex-col items-center gap-2.5">
        <div className="h-1.5 w-36 overflow-hidden rounded-full bg-[#E2E8F0]">
          <motion.div
            initial={{ x: '-100%' }}
            animate={{ x: '100%' }}
            transition={{ duration: 1.15, repeat: Infinity, ease: 'easeInOut' }}
            className="h-full w-1/2 rounded-full bg-gradient-to-r from-[#1D4ED8] via-[#2563EB] to-[#0EA5E9]"
          />
        </div>
        <span className="text-[11px] font-semibold text-[#475569]">
          {t.splash_preparing}
        </span>
      </div>
    </motion.div>
  );
};
