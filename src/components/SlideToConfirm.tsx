import React, { useRef, useState } from 'react';
import { ChevronRight, ChevronsRight } from 'lucide-react';

interface SlideToConfirmProps {
  label: string;
  onConfirm: () => void;
  disabled?: boolean;
  variant?: 'yellow' | 'emerald';
}

export const SlideToConfirm: React.FC<SlideToConfirmProps> = ({
  label,
  onConfirm,
  disabled = false,
  variant = 'yellow',
}) => {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const startXRef = useRef(0);
  const [progress, setProgress] = useState(0);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    draggingRef.current = true;
    startXRef.current = e.clientX;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current || !trackRef.current || disabled) return;
    const trackWidth = trackRef.current.clientWidth;
    const handleWidth = 56;
    const maxTravel = Math.max(1, trackWidth - handleWidth - 8);
    const delta = Math.max(0, e.clientX - startXRef.current);
    const next = Math.min(1, delta / maxTravel);
    setProgress(next);
  };

  const handlePointerUp = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    if (progress >= 0.78 && !disabled) {
      setProgress(1);
      try {
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
          navigator.vibrate(45);
        }
      } catch {
        // Ignore
      }
      onConfirm();
      window.setTimeout(() => setProgress(0), 400);
    } else {
      setProgress(0);
    }
  };

  const trackBg =
    variant === 'emerald'
      ? 'bg-gradient-to-r from-[#047857] to-[#0D9488] border-[#34D399]/70 shadow-lg shadow-emerald-700/20'
      : 'bg-gradient-to-r from-[#065F46] via-[#047857] to-[#0891B2] border-[#2DD4BF]/65 shadow-lg shadow-teal-700/20';
  const fillBg = 'bg-white/22';
  const thumbBg = 'bg-white text-[#047857] shadow-md';

  return (
    <div
      ref={trackRef}
      className={`relative h-[62px] w-full select-none overflow-hidden rounded-full border ${trackBg} ${
        disabled ? 'opacity-50' : ''
      }`}
    >
      <div
        className={`absolute inset-y-0 left-0 rounded-full ${fillBg} transition-none`}
        style={{ width: `${Math.round(progress * 100)}%` }}
      />

      <div className="pointer-events-none absolute inset-0 flex items-center justify-center pl-16 pr-5">
        <span className="truncate text-sm font-extrabold tracking-tight flex items-center gap-1.5 text-white">
          <span>{label}</span>
          <ChevronsRight className="h-4 w-4 shrink-0 text-[#A7F3D0]" />
        </span>
      </div>

      <div
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !disabled) {
            e.preventDefault();
            onConfirm();
          }
        }}
        style={{
          transform: `translateX(${
            trackRef.current
              ? Math.round(progress * Math.max(0, trackRef.current.clientWidth - 62))
              : 0
          }px)`,
        }}
        className={`touch-none absolute top-1 left-1 flex h-[52px] w-[52px] cursor-grab active:cursor-grabbing items-center justify-center rounded-full transition-transform ${thumbBg}`}
      >
        <ChevronRight className="h-6 w-6 stroke-[2.8]" />
      </div>
    </div>
  );
};
