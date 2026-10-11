import type { AIMode } from './aiAssistantState';

export type AIIntent = 'auto' | 'plan' | 'analysis' | 'steps';
export const AI_COMMANDS = [
  { intent: 'plan', command: '@plan', uk: 'План', en: 'Plan' },
  { intent: 'analysis', command: '@analysis', uk: 'Аналіз', en: 'Analysis' },
  { intent: 'steps', command: '@steps', uk: 'Підзавдання', en: 'Subtasks' },
] as const;

export function modeIntent(mode: AIMode): AIIntent {
  return mode === 'generate' ? 'plan' : mode === 'analyze' ? 'analysis' : mode === 'breakdown' ? 'steps' : 'auto';
}
export function intentMode(intent: AIIntent): AIMode {
  return intent === 'plan' ? 'generate' : intent === 'analysis' ? 'analyze' : intent === 'steps' ? 'breakdown' : 'chat';
}
/** Only a leading, standalone command selects a one-message action. */
export function parseAICommand(text: string, selected: AIIntent = 'auto'): { text: string; intent: AIIntent } {
  let remaining = text.trim();
  let intent = selected;
  let match: RegExpMatchArray | null;
  // Selecting another command replaces the chip, just like choosing another menu item.
  while ((match = remaining.match(/^@(plan|analysis|steps)(?=\s|$)/i))) {
    intent = match[1].toLowerCase() as AIIntent;
    remaining = remaining.slice(match[0].length).trim();
  }
  return { text: remaining, intent };
}
export function migrateAIComposer(prompt: string, mode: AIMode): { prompt: string; mode: AIMode } {
  const parsed = parseAICommand(prompt, modeIntent(mode));
  return { prompt: parsed.text, mode: intentMode(parsed.intent) };
}
