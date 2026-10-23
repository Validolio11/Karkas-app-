import React, { useId } from 'react';

interface SoftHatchSvgProps {
  x?: number;
  y?: number;
  width: number;
  height: number;
  color: string;
  opacity?: number;
  /** Horizontal viewBox units corresponding to one rendered CSS pixel. */
  unitsPerPixelX?: number;
  children: React.ReactNode;
}

/** Static texture, clipped to the actual data area; data strokes stay outside this group. */
export function SoftHatchSvg({ x = 0, y = 0, width, height, color, opacity = .25, unitsPerPixelX = 1, children }: SoftHatchSvgProps) {
  const id = 'soft-hatch-' + useId().replace(/:/g, '');
  if (width <= 0 || height <= 0) return null;
  const scaleX = Number.isFinite(unitsPerPixelX) && unitsPerPixelX > 0 ? unitsPerPixelX : 1;
  const edge = Math.min(108 * scaleX, width * .45);
  const edgeStart = x + width - edge;
  const bounds = { x, y, width, height };

  return <g aria-hidden="true" pointerEvents="none" opacity={opacity}>
    <defs>
      <pattern id={id + '-pattern'} width="13" height="40" patternUnits="userSpaceOnUse" patternTransform={`scale(${scaleX} 1) rotate(10)`}>
        <line x1="1.5" y1="-10" x2="1.5" y2="50" stroke={color} strokeWidth="3" />
      </pattern>
      <clipPath id={id + '-clip'} clipPathUnits="userSpaceOnUse">{children}</clipPath>
      <linearGradient id={id + '-sharp'} gradientUnits="userSpaceOnUse" x1={edgeStart} x2={x + width} y1={y} y2={y}>
        <stop offset="0" stopColor="white" />
        <stop offset=".75" stopColor="white" stopOpacity="0" />
        <stop offset="1" stopColor="white" stopOpacity="0" />
      </linearGradient>
      <linearGradient id={id + '-soft'} gradientUnits="userSpaceOnUse" x1={edgeStart} x2={x + width} y1={y} y2={y}>
        <stop offset="0" stopColor="white" stopOpacity="0" />
        <stop offset=".42" stopColor="white" />
        <stop offset="1" stopColor="white" stopOpacity="0" />
      </linearGradient>
      <mask id={id + '-sharp-mask'} maskUnits="userSpaceOnUse" {...bounds}>
        <rect {...bounds} fill={`url(#${id}-sharp)`} />
      </mask>
      <mask id={id + '-soft-mask'} maskUnits="userSpaceOnUse" {...bounds}>
        <rect {...bounds} fill={`url(#${id}-soft)`} />
      </mask>
      <filter id={id + '-blur'} filterUnits="userSpaceOnUse" x={x - 8 * scaleX} y={y - 8} width={width + 16 * scaleX} height={height + 16} colorInterpolationFilters="sRGB">
        <feGaussianBlur stdDeviation={`${2.4 * scaleX} 2.4`} />
      </filter>
    </defs>
    <g clipPath={`url(#${id}-clip)`}>
      <rect {...bounds} fill={`url(#${id}-pattern)`} mask={`url(#${id}-sharp-mask)`} />
      <rect {...bounds} fill={`url(#${id}-pattern)`} filter={`url(#${id}-blur)`} mask={`url(#${id}-soft-mask)`} />
    </g>
  </g>;
}
