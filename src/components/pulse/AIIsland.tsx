import type { Language } from '../../utils/i18n';
import { KarkasLogo } from './KarkasLogo';
import { PULSE_SHELL_STRINGS } from './pulseShellStrings';
import './pulseShell.css';

interface AIIslandProps {
  lang: Language;
  onOpen: () => void;
  isOpen?: boolean;
}

export function AIIsland({ lang, onOpen, isOpen = false }: AIIslandProps) {
  const t = PULSE_SHELL_STRINGS[lang];
  return (
    <button id="bottom-summon-ai-btn" type="button" className="pulse-ai-island app-no-drag"
      aria-label={t.ai} aria-keyshortcuts="Control+k" aria-haspopup="dialog" aria-expanded={isOpen}
      data-tip={t.aiTip} data-tip-up="true" onClick={onOpen}>
      <span className="pulse-ai-logo"><KarkasLogo compact /></span>
      <span>Karkas AI</span>
    </button>
  );
}
