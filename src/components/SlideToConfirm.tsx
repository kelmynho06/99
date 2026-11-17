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
      ? 'bg-emerald-950/90 border-emerald-500/45 shadow-inner'
      : 'bg-neutral-900 border-neutral-700/80 shadow-inner';
  const fillBg = variant === 'emerald' ? 'bg-emerald-500/30' : 'bg-[#FFD100]/25';
  const thumbBg =
    variant === 'emerald'
      ? 'bg-emerald-500 text-white shadow-md shadow-emerald-950/40'
      : 'bg-[#FFD100] text-neutral-950 shadow-md shadow-black/30';

  return (
    <div
      ref={trackRef}
      className={`relative h-[60px] w-full select-none overflow-hidden rounded-2xl border ${trackBg} ${
        disabled ? 'opacity-50' : ''
      }`}
    >
      <div
        className={`absolute inset-y-0 left-0 ${fillBg} transition-none`}
        style={{ width: `${Math.round(progress * 100)}%` }}
      />

      <div className="pointer-events-none absolute inset-0 flex items-center justify-center pl-14 pr-4">
        <span className="truncate text-sm font-extrabold text-white tracking-tight flex items-center gap-1.5">
          <span>{label}</span>
          <ChevronsRight
            className={`h-4 w-4 shrink-0 ${
              variant === 'emerald' ? 'text-emerald-400' : 'text-[#FFD100]'
            }`}
          />
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
              ? Math.round(progress * Math.max(0, trackRef.current.clientWidth - 60))
              : 0
          }px)`,
        }}
        className={`touch-none absolute top-1 left-1 flex h-[50px] w-[52px] cursor-grab active:cursor-grabbing items-center justify-center rounded-xl transition-transform ${thumbBg}`}
      >
        <ChevronRight className="h-6 w-6 stroke-[2.8]" />
      </div>
    </div>
  );
};
