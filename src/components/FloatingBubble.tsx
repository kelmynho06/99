import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { resolveBrandLogo } from '../lib/brandAssets';
import type { PlatformConfig, UserProfile } from '../types/mobility';

interface FloatingBubbleProps {
  currentUser: UserProfile;
  platformConfig: PlatformConfig;
  hasActiveRide?: boolean;
  onDismiss: () => void;
}

const BUBBLE_POS_KEY = 'mobilidade66_bubble_pos_v1';
const BUBBLE_SIZE = 56;
const EDGE_MARGIN = 12;

interface BubblePos {
  x: number;
  y: number;
}

function getInitialPos(): BubblePos {
  if (typeof window === 'undefined') return { x: 16, y: 260 };
  try {
    const saved = localStorage.getItem(BUBBLE_POS_KEY);
    if (saved) {
      const p = JSON.parse(saved) as Partial<BubblePos>;
      if (typeof p.x === 'number' && typeof p.y === 'number') {
        return {
          x: Math.max(EDGE_MARGIN, Math.min(window.innerWidth - BUBBLE_SIZE - EDGE_MARGIN, p.x)),
          y: Math.max(76, Math.min(window.innerHeight - BUBBLE_SIZE - 84, p.y)),
        };
      }
    }
  } catch {
    // Ignore storage issues
  }
  return {
    x: Math.max(EDGE_MARGIN, window.innerWidth - BUBBLE_SIZE - EDGE_MARGIN),
    y: Math.round(window.innerHeight * 0.42),
  };
}

export const FloatingBubble: React.FC<FloatingBubbleProps> = ({
  currentUser,
  platformConfig,
  hasActiveRide = false,
  onDismiss,
}) => {
  const [pos, setPos] = useState<BubblePos>(getInitialPos);
  const [isDragging, setIsDragging] = useState(false);
  const [isOverDismissZone, setIsOverDismissZone] = useState(false);

  const dragStartRef = useRef<{
    pointerX: number;
    pointerY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);

  useEffect(() => {
    const onResize = () => {
      setPos((prev) => ({
        x:
          prev.x < window.innerWidth / 2
            ? EDGE_MARGIN
            : Math.max(EDGE_MARGIN, window.innerWidth - BUBBLE_SIZE - EDGE_MARGIN),
        y: Math.max(76, Math.min(window.innerHeight - BUBBLE_SIZE - 84, prev.y)),
      }));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const checkNearDismissTarget = (bx: number, by: number): boolean => {
    if (typeof window === 'undefined') return false;
    const bubbleCenterX = bx + BUBBLE_SIZE / 2;
    const bubbleCenterY = by + BUBBLE_SIZE / 2;
    const dismissCenterX = window.innerWidth / 2;
    const dismissCenterY = window.innerHeight - 62;
    const dist = Math.hypot(bubbleCenterX - dismissCenterX, bubbleCenterY - dismissCenterY);
    return dist <= 68;
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStartRef.current = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      originX: pos.x,
      originY: pos.y,
      moved: false,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = dragStartRef.current;
    if (!start) return;
    const dx = e.clientX - start.pointerX;
    const dy = e.clientY - start.pointerY;
    if (!start.moved && Math.hypot(dx, dy) > 6) {
      start.moved = true;
      setIsDragging(true);
    }
    if (!start.moved) return;

    const maxX = Math.max(EDGE_MARGIN, window.innerWidth - BUBBLE_SIZE - EDGE_MARGIN);
    const maxY = Math.max(60, window.innerHeight - BUBBLE_SIZE - 16);
    const nextX = Math.max(EDGE_MARGIN, Math.min(maxX, start.originX + dx));
    const nextY = Math.max(60, Math.min(maxY, start.originY + dy));
    setPos({ x: nextX, y: nextY });
    setIsOverDismissZone(checkNearDismissTarget(nextX, nextY));
  };

  const handlePointerUp = () => {
    const start = dragStartRef.current;
    dragStartRef.current = null;
    if (!start) return;

    if (!start.moved) {
      setIsDragging(false);
      setIsOverDismissZone(false);
      window.dispatchEvent(new CustomEvent('mobilidade66:bubble-tap'));
      return;
    }

    setIsDragging(false);
    if (checkNearDismissTarget(pos.x, pos.y)) {
      setIsOverDismissZone(false);
      onDismiss();
      return;
    }
    setIsOverDismissZone(false);

    // Snap horizontally to nearest screen edge
    const snapLeft = pos.x + BUBBLE_SIZE / 2 < window.innerWidth / 2;
    const snappedX = snapLeft
      ? EDGE_MARGIN
      : Math.max(EDGE_MARGIN, window.innerWidth - BUBBLE_SIZE - EDGE_MARGIN);
    const clampedY = Math.max(76, Math.min(window.innerHeight - BUBBLE_SIZE - 84, pos.y));
    const finalPos = { x: snappedX, y: clampedY };
    setPos(finalPos);
    try {
      localStorage.setItem(BUBBLE_POS_KEY, JSON.stringify(finalPos));
    } catch {
      // Ignore
    }
  };

  const isDriverOnline = currentUser.role === 'driver' && Boolean(currentUser.driver?.is_online);

  return (
    <>
      {/* Draggable Circular Floating Bubble */}
      <div
        role="button"
        tabIndex={0}
        aria-label={`Atalho flutuante ${platformConfig.site_name || '66 Mobilidade'}`}
        title="Arraste para mover ou solte no X para fechar"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{
          left: `${pos.x}px`,
          top: `${pos.y}px`,
          width: `${BUBBLE_SIZE}px`,
          height: `${BUBBLE_SIZE}px`,
        }}
        className={`fixed z-[1120] touch-none select-none rounded-full bg-[#1C1F24] border-2 ${
          isOverDismissZone
            ? 'border-red-500 scale-90 opacity-80'
            : 'border-[#FFD100] shadow-2xl active:scale-95'
        } flex items-center justify-center cursor-grab active:cursor-grabbing ${
          isDragging ? 'transition-none' : 'transition-[left,top,transform] duration-200 ease-out'
        }`}
      >
        <img
          src={resolveBrandLogo(platformConfig)}
          alt={platformConfig.site_name || '66 Mobilidade'}
          draggable={false}
          className="h-10 w-10 rounded-full object-cover pointer-events-none"
        />

        {/* Status Indicator Dot */}
        {(hasActiveRide || isDriverOnline) && (
          <span
            className={`absolute -top-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-[#1C1F24] ${
              hasActiveRide ? 'bg-[#FFD100] animate-ping' : 'bg-emerald-500'
            }`}
          />
        )}
        {hasActiveRide && (
          <span className="absolute -top-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-[#1C1F24] bg-[#FFD100]" />
        )}
      </div>

      {/* Centered Bottom X Dismiss Drop-Zone (Revealed While Dragging) */}
      {isDragging && (
        <div className="pointer-events-none fixed bottom-8 left-1/2 -translate-x-1/2 z-[1115] flex flex-col items-center gap-1.5">
          <div
            className={`flex h-14 w-14 items-center justify-center rounded-full border-2 shadow-2xl transition-all ${
              isOverDismissZone
                ? 'scale-125 bg-red-600 border-white text-white'
                : 'bg-neutral-950/90 border-white/40 text-white'
            }`}
          >
            <X className="h-6 w-6 stroke-[2.5]" />
          </div>
          <span className="rounded-full bg-neutral-950/85 px-2.5 py-0.5 text-[10px] font-bold text-white shadow">
            {isOverDismissZone ? 'Solte para fechar' : 'Arraste para fechar'}
          </span>
        </div>
      )}
    </>
  );
};
