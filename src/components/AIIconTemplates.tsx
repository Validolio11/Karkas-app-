import React from 'react';

export type AIIconId =
  | 't1' // Quantum Cube
  | 't2' // Tactical Reticle
  | 't3' // Synapse Grid
  | 't4' // Hexa-Core
  | 't5' // Quantum Diamond
  | 't6' // Radar Pulse
  | 't7' // Geometric Flare
  | 't8' // Nexus Monolith
  | 't9' // Frequency Wave
  | 't10'; // Karkas Matrix

export interface AIIconProps {
  id?: AIIconId;
  className?: string;
  style?: React.CSSProperties;
}

// 1. T1_NeuralCube: Isometric wireframe cube with a centered micro-processing core
export const T1_NeuralCube: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor">
    {/* Top diamond */}
    <polygon points="12,2 20.5,6.5 12,11 3.5,6.5" strokeWidth="1.75" strokeLinejoin="round" />
    {/* Left face */}
    <polygon points="3.5,6.5 12,11 12,21.5 3.5,17" strokeWidth="1.75" strokeLinejoin="round" />
    {/* Right face */}
    <polygon points="12,11 20.5,6.5 20.5,17 12,21.5" strokeWidth="1.75" strokeLinejoin="round" />
    {/* Center core pulse */}
    <rect x="10.5" y="9.5" width="3" height="3" fill="currentColor" />
  </svg>
);

// 2. T2_TacticalReticle: Segmented cyber targeting reticle with central crosshair
export const T2_TacticalReticle: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor">
    {/* Corner targeting brackets */}
    <path d="M3 8V3H8" strokeWidth="2" strokeLinecap="square" />
    <path d="M16 3H21V8" strokeWidth="2" strokeLinecap="square" />
    <path d="M3 16V21H8" strokeWidth="2" strokeLinecap="square" />
    <path d="M16 21H21V16" strokeWidth="2" strokeLinecap="square" />
    {/* Crosshairs */}
    <line x1="12" y1="6" x2="12" y2="9.5" strokeWidth="1.75" strokeLinecap="square" />
    <line x1="12" y1="14.5" x2="12" y2="18" strokeWidth="1.75" strokeLinecap="square" />
    <line x1="6" y1="12" x2="9.5" y2="12" strokeWidth="1.75" strokeLinecap="square" />
    <line x1="14.5" y1="12" x2="18" y2="12" strokeWidth="1.75" strokeLinecap="square" />
    <circle cx="12" cy="12" r="1.5" fill="currentColor" />
  </svg>
);

// 3. T3_SynapseGrid: Intersecting vector circuit & neural nodes graph
export const T3_SynapseGrid: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor">
    {/* Connecting lines */}
    <line x1="12" y1="3" x2="4" y2="11" strokeWidth="1.5" />
    <line x1="12" y1="3" x2="20" y2="11" strokeWidth="1.5" />
    <line x1="4" y1="11" x2="12" y2="12" strokeWidth="1.5" />
    <line x1="20" y1="11" x2="12" y2="12" strokeWidth="1.5" />
    <line x1="12" y1="3" x2="12" y2="12" strokeWidth="1.5" />
    <line x1="12" y1="12" x2="6" y2="20" strokeWidth="1.5" />
    <line x1="12" y1="12" x2="18" y2="20" strokeWidth="1.5" />
    <line x1="6" y1="20" x2="18" y2="20" strokeWidth="1.5" />
    {/* Nodes */}
    <rect x="10.5" y="1.5" width="3" height="3" fill="currentColor" />
    <rect x="2.5" y="9.5" width="3" height="3" fill="currentColor" />
    <rect x="18.5" y="9.5" width="3" height="3" fill="currentColor" />
    <rect x="4.5" y="18.5" width="3" height="3" fill="currentColor" />
    <rect x="16.5" y="18.5" width="3" height="3" fill="currentColor" />
    <rect x="10.5" y="10.5" width="3" height="3" fill="currentColor" />
  </svg>
);

// 4. T4_HexaCore: Cybernetic hexagon with core processor circuits
export const T4_HexaCore: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor">
    {/* Outer Hexagon */}
    <polygon points="12,2 21,7.2 21,16.8 12,22 3,16.8 3,7.2" strokeWidth="1.75" strokeLinejoin="round" />
    {/* Inner Square Core */}
    <rect x="9" y="9" width="6" height="6" strokeWidth="1.5" />
    {/* Circuit buses */}
    <line x1="12" y1="2" x2="12" y2="9" strokeWidth="1.5" />
    <line x1="12" y1="15" x2="12" y2="22" strokeWidth="1.5" />
    <line x1="3" y1="12" x2="9" y2="12" strokeWidth="1.5" />
    <line x1="15" y1="12" x2="21" y2="12" strokeWidth="1.5" />
    <circle cx="12" cy="12" r="1.25" fill="currentColor" />
  </svg>
);

// 5. T5_QuantumDiamond: Dual interlaced geometric diamonds with telemetry lines
export const T5_QuantumDiamond: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor">
    {/* Outer Diamond */}
    <polygon points="12,2 22,12 12,22 2,12" strokeWidth="1.75" strokeLinejoin="round" />
    {/* Inner Diamond */}
    <polygon points="12,6.5 17.5,12 12,17.5 6.5,12" strokeWidth="1.25" strokeDasharray="2 2" strokeLinejoin="round" />
    {/* Horizontal beam */}
    <line x1="1" y1="12" x2="23" y2="12" strokeWidth="1.5" strokeLinecap="square" />
    {/* Center node */}
    <rect x="10.5" y="10.5" width="3" height="3" fill="currentColor" transform="rotate(45 12 12)" />
  </svg>
);

// 6. T6_RadarPulse: Concentric radar telemetry sweep with coordinate markers
export const T6_RadarPulse: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor">
    {/* Segmented Outer Arc */}
    <path d="M12 2A10 10 0 0 1 22 12" strokeWidth="1.75" strokeLinecap="square" />
    <path d="M22 12A10 10 0 0 1 12 22" strokeWidth="1.75" strokeLinecap="square" />
    <path d="M12 22A10 10 0 0 1 2 12" strokeWidth="1.75" strokeLinecap="square" />
    <path d="M2 12A10 10 0 0 1 12 2" strokeWidth="1.25" strokeDasharray="2 2" />
    {/* Inner Radar Range */}
    <path d="M12 6A6 6 0 0 1 18 12" strokeWidth="1.5" strokeLinecap="square" />
    {/* Sweep Line */}
    <line x1="12" y1="12" x2="19.5" y2="4.5" strokeWidth="1.75" strokeLinecap="square" />
    <circle cx="12" cy="12" r="2" fill="currentColor" />
  </svg>
);

// 7. T7_GeometricFlare: Pure mathematical 8-point orthogonal starflare
export const T7_GeometricFlare: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor">
    {/* 4-point Diamond Star */}
    <path d="M12 2 L14.5 9.5 L22 12 L14.5 14.5 L12 22 L9.5 14.5 L2 12 L9.5 9.5 Z" strokeWidth="1.75" strokeLinejoin="miter" />
    {/* Diagonal Rays */}
    <line x1="4.5" y1="4.5" x2="7" y2="7" strokeWidth="1.75" strokeLinecap="square" />
    <line x1="19.5" y1="4.5" x2="17" y2="7" strokeWidth="1.75" strokeLinecap="square" />
    <line x1="4.5" y1="19.5" x2="7" y2="17" strokeWidth="1.75" strokeLinecap="square" />
    <line x1="19.5" y1="19.5" x2="17" y2="17" strokeWidth="1.75" strokeLinecap="square" />
    {/* Center Nexus */}
    <circle cx="12" cy="12" r="1.5" fill="currentColor" />
  </svg>
);

// 8. T8_NexusMonolith: Architectural cyber brackets surrounding a singularity node
export const T8_NexusMonolith: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor">
    {/* Left Monolith Bracket */}
    <path d="M7 3H3V21H7" strokeWidth="2" strokeLinecap="square" strokeLinejoin="miter" />
    {/* Right Monolith Bracket */}
    <path d="M17 3H21V21H17" strokeWidth="2" strokeLinecap="square" strokeLinejoin="miter" />
    {/* Central Floating Diamond */}
    <polygon points="12,5.5 16.5,12 12,18.5 7.5,12" strokeWidth="1.75" strokeLinejoin="miter" />
    {/* Core dot */}
    <rect x="11" y="11" width="2" height="2" fill="currentColor" />
  </svg>
);

// 9. T9_FrequencyWave: Digital spectrum frequency pulses forming analytical brainwave
export const T9_FrequencyWave: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor">
    {/* Upper and Lower Rails */}
    <line x1="2" y1="4" x2="22" y2="4" strokeWidth="1.5" strokeDasharray="3 2" />
    <line x1="2" y1="20" x2="22" y2="20" strokeWidth="1.5" strokeDasharray="3 2" />
    {/* Spectrum Pulses */}
    <line x1="4" y1="10" x2="4" y2="14" strokeWidth="2" strokeLinecap="square" />
    <line x1="8" y1="7" x2="8" y2="17" strokeWidth="2" strokeLinecap="square" />
    <line x1="12" y1="5" x2="12" y2="19" strokeWidth="2.5" strokeLinecap="square" />
    <line x1="16" y1="7" x2="16" y2="17" strokeWidth="2" strokeLinecap="square" />
    <line x1="20" y1="10" x2="20" y2="14" strokeWidth="2" strokeLinecap="square" />
  </svg>
);

// 10. T10_KarkasMatrix: Tactical microchip matrix with interlocking square conduits
export const T10_KarkasMatrix: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor">
    {/* Outer Frame */}
    <rect x="3.5" y="3.5" width="17" height="17" strokeWidth="1.75" />
    {/* Inner Sub-matrix */}
    <rect x="7" y="7" width="10" height="10" strokeWidth="1.25" strokeDasharray="2 2" />
    {/* Center Core */}
    <rect x="10" y="10" width="4" height="4" fill="currentColor" />
    {/* Cardinal IO Conduits */}
    <line x1="12" y1="1" x2="12" y2="3.5" strokeWidth="2" strokeLinecap="square" />
    <line x1="12" y1="20.5" x2="12" y2="23" strokeWidth="2" strokeLinecap="square" />
    <line x1="1" y1="12" x2="3.5" y2="12" strokeWidth="2" strokeLinecap="square" />
    <line x1="20.5" y1="12" x2="23" y2="12" strokeWidth="2" strokeLinecap="square" />
  </svg>
);

export interface AIIconTemplateMeta {
  id: AIIconId;
  index: string;
  nameUk: string;
  nameEn: string;
  descUk: string;
  descEn: string;
  component: React.FC<{ className?: string }>;
}

export const AI_ICON_TEMPLATES: AIIconTemplateMeta[] = [
  {
    id: 't1',
    index: '01',
    nameUk: 'Квантовий Куб',
    nameEn: 'Quantum Cube',
    descUk: 'Ізометричний каркас із ядром логіки',
    descEn: 'Isometric wireframe with logic core',
    component: T1_NeuralCube,
  },
  {
    id: 't2',
    index: '02',
    nameUk: 'Тактичний Приціл',
    nameEn: 'Tactical Reticle',
    descUk: 'Кібер-приціл фокусування та орієнтирів',
    descEn: 'Targeting reticle for priority locking',
    component: T2_TacticalReticle,
  },
  {
    id: 't3',
    index: '03',
    nameUk: 'Нейронний Граф',
    nameEn: 'Synapse Graph',
    descUk: 'Мережа зв’язків та векторної інтелектуальності',
    descEn: 'Distributed network of vector nodes',
    component: T3_SynapseGrid,
  },
  {
    id: 't4',
    index: '04',
    nameUk: 'Гекса-Процесор',
    nameEn: 'Hexa-Core CPU',
    descUk: 'Гексагональний чіп обчислення рішень',
    descEn: 'Hexagonal decision computing processor',
    component: T4_HexaCore,
  },
  {
    id: 't5',
    index: '05',
    nameUk: 'Векторний Кристал',
    nameEn: 'Vector Diamond',
    descUk: 'Подвійна призма концентрації потоку',
    descEn: 'Dual-phase focus prism with telemetry',
    component: T5_QuantumDiamond,
  },
  {
    id: 't6',
    index: '06',
    nameUk: 'Кібер-Радар',
    nameEn: 'Radar Telemetry',
    descUk: 'Секторальне сканування горизонту задач',
    descEn: 'Sector scan for workflow tracking',
    component: T6_RadarPulse,
  },
  {
    id: 't7',
    index: '07',
    nameUk: 'Ортогональна Зірка',
    nameEn: 'Orthogonal Flare',
    descUk: 'Математичний квантовий імпульс',
    descEn: 'Strict mathematical quantum spark',
    component: T7_GeometricFlare,
  },
  {
    id: 't8',
    index: '08',
    nameUk: 'Сингулярний Моноліт',
    nameEn: 'Nexus Singularity',
    descUk: 'Бруталістські скоби довкола центру мислення',
    descEn: 'Brutalist monolith framing singularity',
    component: T8_NexusMonolith,
  },
  {
    id: 't9',
    index: '09',
    nameUk: 'Когнітивна Хвиля',
    nameEn: 'Cognitive Spectrum',
    descUk: 'Частотний спектр темпу та продуктивності',
    descEn: 'Digital pulse frequency for cadence',
    component: T9_FrequencyWave,
  },
  {
    id: 't10',
    index: '10',
    nameUk: 'Каркас Матриця',
    nameEn: 'Karkas Matrix',
    descUk: 'Фірмова архітектурна матриця шин та портів',
    descEn: 'Signature tactical chip IO matrix',
    component: T10_KarkasMatrix,
  },
];

export const STORAGE_AI_ICON_KEY = 'karkas_ai_icon_variant';

export const getSavedAIIconId = (): AIIconId => {
  try {
    const saved = localStorage.getItem(STORAGE_AI_ICON_KEY);
    if (saved && AI_ICON_TEMPLATES.some((t) => t.id === saved)) {
      return saved as AIIconId;
    }
  } catch {
    // ignore
  }
  return 't1';
};

// Global Unified AIIcon Component
export const AIIcon: React.FC<AIIconProps> = ({ id, className = 'w-4 h-4', style }) => {
  const activeId = id || getSavedAIIconId();
  const template = AI_ICON_TEMPLATES.find((t) => t.id === activeId) || AI_ICON_TEMPLATES[0];
  const Component = template.component;
  return (
    <span className="inline-flex items-center justify-center shrink-0" style={style}>
      <Component className={className} />
    </span>
  );
};
