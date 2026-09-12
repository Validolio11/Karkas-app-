import React from 'react';

// Kept for workspace compatibility with settings saved by older releases.
export type AIIconId = 't1' | 't2' | 't3' | 't4' | 't5' | 't6' | 't7' | 't8' | 't9' | 't10';

export interface AIIconProps {
  id?: AIIconId;
  className?: string;
  style?: React.CSSProperties;
}

export const STORAGE_AI_ICON_KEY = 'karkas_ai_icon_variant';
export const getSavedAIIconId = (): AIIconId => 't1';

/** One canonical AI mark across every Karkas surface. */
export const AIIcon: React.FC<AIIconProps> = ({ className = 'w-4 h-4', style }) => (
  <img
    src="/icons-ai.png?v=karkas-ai-icon-1"
    alt=""
    aria-hidden="true"
    draggable={false}
    className={`inline-block shrink-0 object-contain ${className}`}
    style={style}
  />
);
