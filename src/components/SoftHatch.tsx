import { useId, type CSSProperties } from 'react';
import './SoftHatch.css';

export interface SoftHatchProps {
  color: string;
  opacity?: number;
  /** Percentage of this component's container, independent of the data's own fill width. */
  endPoint?: number;
  edgeWidth?: number;
  /** Optional decorative tail beyond the endpoint; progress fills should keep the default zero. */
  tailWidth?: number;
  motion?: boolean;
  reveal?: boolean;
  className?: string;
  style?: CSSProperties;
}

const finite = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback;

/** Shared straight vector hatching; only its edge softens, never its containing content. */
export function SoftHatch({ color, opacity = .25, endPoint = 100, edgeWidth = 108, tailWidth = 0,
  motion = true, reveal = false, className, style }: SoftHatchProps) {
  const patternId = `soft-hatch-${useId().replace(/:/g, '')}`;
  const end = Math.max(0, Math.min(100, finite(endPoint, 100)));
  const hatchStyle = {
    ...style, color, opacity: Math.max(0, Math.min(1, finite(opacity, .25))),
    '--soft-hatch-end': `${end}%`,
    '--soft-hatch-edge-width': `${Math.max(0, finite(edgeWidth, 108))}px`,
    '--soft-hatch-tail': `${Math.max(0, finite(tailWidth, 0))}px`,
  } as CSSProperties;
  return <div aria-hidden="true" className={`soft-hatch${className ? ` ${className}` : ''}`} style={hatchStyle}
    data-motion={motion ? 'on' : 'off'} data-reveal={reveal && motion ? 'on' : 'off'} data-empty={end === 0 || undefined}>
    <div className="soft-hatch__layer soft-hatch__layer--sharp">
      <svg className="soft-hatch__pattern" width="100%" height="100%" focusable="false" shapeRendering="geometricPrecision">
        <defs><pattern id={patternId} width="13" height="40" patternUnits="userSpaceOnUse" patternTransform="rotate(10)">
          <line x1="1.5" y1="-10" x2="1.5" y2="50" stroke="currentColor" strokeWidth="3" />
        </pattern></defs>
        <rect width="100%" height="100%" fill={`url(#${patternId})`} />
      </svg>
    </div>
    <div className="soft-hatch__layer soft-hatch__layer--blur">
      <svg className="soft-hatch__pattern" width="100%" height="100%" focusable="false" shapeRendering="geometricPrecision">
        <rect width="100%" height="100%" fill={`url(#${patternId})`} />
      </svg>
    </div>
  </div>;
}
