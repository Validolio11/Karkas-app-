import { newTabItemSchema, newTaskItemSchema, taskMutationProperties } from './aiActions';
import type { AIFunctionCall } from './geminiGeneration';

/**
 * Gemini function calling for the task_command chat route. The model writes its
 * reply as streamed prose and proposes each operation as one tool call. Calls are
 * never executed and no function response is sent back: they are assembled into
 * the existing proposal shape and validated exactly like the JSON output, and the
 * person still applies them with the Apply button.
 *
 * The declarations are static and deterministically ordered, so they stay part of
 * the implicitly cached request prefix. Parameter schemas are the same objects the
 * JSON response schema uses, so both paths accept the same fields and constraints.
 */
export const TASK_COMMAND_FUNCTION_DECLARATIONS = [
  {
    name: 'propose_create_task',
    description: 'Propose ONE genuinely new top-level task; one call per task. Never for a subtask of an existing task (use propose_update_task with stepList). phase: one of AVAILABLE TAB IDS or the id of a tab proposed in this reply. priority: 1 high, 2 normal, 3 low. steps: 0-5, 0 unless subtasks are requested; stepList: sequential sub-steps. note: optional short practical note.',
    parameters: newTaskItemSchema,
  },
  {
    name: 'propose_update_task',
    description: 'Propose changes to ONE existing task by its exact workspace id; one call per task. Include only requested fields. Subtask changes send the complete resulting stepList, preserving unchanged items with their ids and done states. null plannedDate/deadlineDate clears that date.',
    parameters: taskMutationProperties.taskUpdates.items,
  },
  {
    name: 'propose_delete_task',
    description: 'Propose archiving ONE entire existing task by its exact workspace id. Never for a subtask or for removing a date. deletionReason only when the person explicitly states it.',
    parameters: taskMutationProperties.taskDeletions.items,
  },
  {
    name: 'propose_create_tab',
    description: 'Propose ONE new category tab, only when explicitly requested. id: lowercase ASCII slug; name: short.',
    parameters: newTabItemSchema,
  },
];

/** Mode AUTO: the model may answer in text only, e.g. with a clarifying question. */
export const TASK_COMMAND_TOOLS_CONFIG = {
  tools: [{ functionDeclarations: TASK_COMMAND_FUNCTION_DECLARATIONS }],
  toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
};

/** KARKAS_AI_TOOLS=off (or false/0/no/disabled) forces the JSON-schema path. */
export function aiToolsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return !/^(?:off|false|0|no|disabled)$/i.test((env.KARKAS_AI_TOOLS ?? '').trim());
}

const TOOL_TARGETS: Record<string, 'tasks' | 'taskUpdates' | 'taskDeletions' | 'tabs'> = {
  propose_create_task: 'tasks',
  propose_update_task: 'taskUpdates',
  propose_delete_task: 'taskDeletions',
  propose_create_tab: 'tabs',
};

export interface ToolProposal {
  tasks: Record<string, unknown>[];
  tabs: Record<string, unknown>[];
  taskUpdates: Record<string, unknown>[];
  taskDeletions: Record<string, unknown>[];
}

/**
 * Convert calls into the proposal arrays the JSON path returns, in call order.
 * An unknown function or non-object arguments make the whole answer invalid,
 * exactly like malformed JSON; field validation happens in the shared pipeline.
 */
export function proposalFromFunctionCalls(calls: readonly AIFunctionCall[]): ToolProposal {
  const proposal: ToolProposal = { tasks: [], tabs: [], taskUpdates: [], taskDeletions: [] };
  for (const call of calls) {
    const target = Object.prototype.hasOwnProperty.call(TOOL_TARGETS, call.name) ? TOOL_TARGETS[call.name] : undefined;
    if (!target) throw new Error('Unknown AI tool');
    if (!call.args || typeof call.args !== 'object' || Array.isArray(call.args)) throw new Error('Invalid AI tool arguments');
    // A copy: later validation normalizes fields in place.
    proposal[target].push(JSON.parse(JSON.stringify(call.args)));
  }
  return proposal;
}

const count = (value: unknown) => Array.isArray(value) ? value.length : 0;

/**
 * A reply for a model answer that contained only tool calls. Describes the final,
 * validated proposal; never claims anything was applied.
 */
export function proposalSummaryReply(proposal: Record<string, any>, isUk: boolean): string {
  const created = count(proposal.tasks), updated = count(proposal.taskUpdates), archived = count(proposal.taskDeletions), tabs = count(proposal.tabs);
  if (!created && !updated && !archived && !tabs) {
    return isUk
      ? 'Не вдалося підготувати зміни в межах цього запиту. Уточніть, яке саме завдання й що потрібно змінити.'
      : 'No changes could be prepared within this request. Please specify which task and what to change.';
  }
  const titles = (Array.isArray(proposal.tasks) ? proposal.tasks : [])
    .map((task: any) => typeof task?.title === 'string' ? task.title.trim() : '').filter(Boolean).slice(0, 3);
  const quoted = titles.length ? (isUk ? `: ${titles.map((title: string) => `«${title}»`).join(', ')}` : `: ${titles.map((title: string) => `"${title}"`).join(', ')}`) : '';
  const parts = isUk
    ? [created && `нові завдання (${created})${quoted}`, updated && `зміни в завданнях (${updated})`, archived && `архівування завдань (${archived})`, tabs && `нові вкладки (${tabs})`]
    : [created && `new tasks (${created})${quoted}`, updated && `task changes (${updated})`, archived && `tasks to archive (${archived})`, tabs && `new tabs (${tabs})`];
  const list = parts.filter(Boolean).join('; ');
  return isUk
    ? `Пропозиція готова: ${list}. Перегляньте її й натисніть «Застосувати зміни», щоб її виконати.`
    : `Proposal ready: ${list}. Review it and press Apply changes to carry it out.`;
}
