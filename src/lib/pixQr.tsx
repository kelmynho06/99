import React, { useMemo } from 'react';

export function generateDeterministicQrMatrix(seedStr: string, size = 21): boolean[][] {
  const grid: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));
  const drawFinder = (r0: number, c0: number) => {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const isBorder = r === 0 || r === 6 || c === 0 || c === 6;
        const isInner = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        grid[r0 + r][c0 + c] = isBorder || isInner;
      }
    }
  };
  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  let hash = 2166136261;
  for (let i = 0; i < seedStr.length; i++) {
    hash ^= seedStr.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const inTopLeft = r < 8 && c < 8;
      const inTopRight = r < 8 && c >= size - 8;
      const inBottomLeft = r >= size - 8 && c < 8;
      if (inTopLeft || inTopRight || inBottomLeft) continue;
      hash ^= (r * 31 + c * 17) & 0xff;
      hash = Math.imul(hash, 16777619);
      grid[r][c] = (hash >>> 0) % 2 === 0;
    }
  }
  return grid;
}

interface PixQrSvgProps {
  payload: string;
  size?: number;
}

export const PixQrSvg: React.FC<PixQrSvgProps> = ({ payload, size = 156 }) => {
  const matrix = useMemo(() => generateDeterministicQrMatrix(payload || 'PIX'), [payload]);

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 21 21"
      shapeRendering="crispEdges"
      role="img"
      aria-label="QR Code Pix da Plataforma"
    >
      <rect width="21" height="21" fill="#ffffff" />
      {matrix.map((row, r) =>
        row.map((cell, c) =>
          cell ? <rect key={`${r}-${c}`} x={c} y={r} width="1" height="1" fill="#111827" /> : null
        )
      )}
    </svg>
  );
};
