import React from 'react';

interface StreetSquareIconProps {
  className?: string;
  size?: number | string;
}

/**
 * Custom Streetwear Brutalist Square Icon
 * Designed specifically for urban techwear / cyberpunk street aesthetic.
 * Features a sharp corner-cut stencil square with an inner 4-quadrant core and neon center point.
 */
export const StreetSquareIcon: React.FC<StreetSquareIconProps> = ({
  className = 'w-3.5 h-3.5 text-emerald-400',
}) => {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`shrink-0 ${className}`}
    >
      {/* Outer Streetwear Stencil Square with notched/cut corners */}
      <path
        d="M5 2H15L18 5V15L15 18H5L2 15V5L5 2Z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      {/* Central Solid Square Block with micro-cross slit */}
      <rect
        x="6.5"
        y="6.5"
        width="7"
        height="7"
        fill="currentColor"
        rx="0.5"
      />
      {/* 4 Corner Optical Anchor Dots */}
      <rect x="5.5" y="5.5" width="1.2" height="1.2" fill="black" />
      <rect x="13.3" y="5.5" width="1.2" height="1.2" fill="black" />
      <rect x="5.5" y="13.3" width="1.2" height="1.2" fill="black" />
      <rect x="13.3" y="13.3" width="1.2" height="1.2" fill="black" />
      {/* Micro Tactical Crosshair in center of inner square */}
      <rect x="9.25" y="7.5" width="1.5" height="5" fill="black" />
      <rect x="7.5" y="9.25" width="5" height="1.5" fill="black" />
    </svg>
  );
};

export default StreetSquareIcon;
