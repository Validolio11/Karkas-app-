import { Type } from '@google/genai';
import { newTabItemSchema, newTaskItemSchema, taskMutationProperties } from './aiActions';
import type { AIFunctionCall } from './geminiGeneration';
import { droppedOperationsReply } from './temporalResponseGuard';

/**
 * Gemini function calling for the task_command route and for ordinary conversation
 * (general, workspace_analysis), where calls are allowed only for an explicit request
 * or a yes to an offered change, within the route's scope. The model writes its
 * reply as streamed prose and proposes each operation as one tool call. Calls are
 * never executed and no function response is sent back: they are assembled into
 * the existing proposal shape and validated exactly like the JSON output, and the
 * person still applies them with the Apply button.
 *
 * The declarations are static and deterministically ordered, so they stay part of
 * the implicitly cached request prefix. Parameter schemas are the same objects the
 * JSON response schema uses, so both paths accept the same fields and constraints.
 */
/** Field rules shared by the single and batch create tools. */
const NEW_TASK_FIELDS = 'phase: one of AVAILABLE TAB IDS or the id of a tab proposed in this reply. priority: 1 high, 2 normal, 3 low; urgency the person states (urgent, ASAP, терміново, якнайшвидше) means 1, "low priority"/"низький пріоритет"/"не терміново" means 3; never only in note. steps: 0-5, 0 unless subtasks are requested; stepList: sequential sub-steps. Dates the person states go into structured fields, never only into note or title: deadlineDate for "by/until/deadline/дедлайн/до", plannedDate for "on/на", as YYYY-MM-DD resolved from CURRENT CLIENT CLOCK (a weekday or "20 жовтня" means its next occurrence); ask when a date is ambiguous. note: optional short practical note, without the date or priority.';

/** The batch create tool: an array of the same new-task items the JSON proposal uses. */
export const newTasksBatchSchema = {
  type: Type.OBJECT,
  properties: { tasks: { type: Type.ARRAY, items: newTaskItemSchema, description: 'Every new task the person listed, in their order.' } },
  required: ['tasks'],
};

export const TASK_COMMAND_FUNCTION_DECLARATIONS = [
  {
    name: 'propose_create_task',
    description: `Propose ONE genuinely new top-level task. When the person lists two or more new tasks, use propose_create_tasks with ALL of them instead. Never for a subtask of an existing task (use propose_update_task with stepList). ${NEW_TASK_FIELDS}`,
    parameters: newTaskItemSchema,
  },
  {
    name: 'propose_create_tasks',
    description: `Propose SEVERAL genuinely new top-level tasks in one call: every task the person listed (numbered, bulleted or comma-separated), in their order, none omitted or merged. Each item follows the propose_create_task rules. ${NEW_TASK_FIELDS}`,
    parameters: newTasksBatchSchema,
  },
  {
    name: 'propose_update_task',
    description: 'Propose changes to ONE existing task by its exact workspace id, or to a pending draft using its exact request-local id from PENDING REVISION TARGETS; one call per task. Include only requested fields. priority: 1 high, 2 normal, 3 low. Subtask changes send the complete resulting stepList, preserving unchanged items with their ids and done states. Order: done steps first, then new starter/preparatory steps, then existing not-done later steps; other new steps go last. Timer: timerMode/countdownDurationSeconds configure it, timerAction:start only when the person asked or agreed. Already worked time or a forgotten timer uses recordedWorkSeconds as the replacement TOTAL seconds on the existing task; never countdown configuration and never an added delta. Do not combine that correction with timer fields or schedule. A requested clock window also includes schedule.startAt. null plannedDate/deadlineDate clears that date.',
    // Past work corrections use the same explicit, bounded total field as the JSON path.
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

const BATCH_CREATE_TOOL = 'propose_create_tasks';
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
  const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
  for (const call of calls) {
    if (call.name === BATCH_CREATE_TOOL) {
      // The batch form of propose_create_task: every item joins "tasks" in order.
      const items = isObject(call.args) ? call.args.tasks : undefined;
      if (!Array.isArray(items) || !items.every(isObject)) throw new Error('Invalid AI tool arguments');
      for (const item of items) proposal.tasks.push(JSON.parse(JSON.stringify(item)));
      continue;
    }
    const target = Object.prototype.hasOwnProperty.call(TOOL_TARGETS, call.name) ? TOOL_TARGETS[call.name] : undefined;
    if (!target) throw new Error('Unknown AI tool');
    if (!isObject(call.args)) throw new Error('Invalid AI tool arguments');
    // A copy: later validation normalizes fields in place.
    proposal[target].push(JSON.parse(JSON.stringify(call.args)));
  }
  return proposal;
}

const count = (value: unknown) => Array.isArray(value) ? value.length : 0;

/**
 * A reply for a model answer that contained only tool calls. Describes the final,
 * validated proposal; never claims anything was applied. Ukrainian text uses the
 * person's form of address ('ty' | 'vy', see discoveryAddressFor).
 */
export function proposalSummaryReply(proposal: Record<string, any>, isUk: boolean, address: 'ty' | 'vy' = 'vy'): string {
  const created = count(proposal.tasks), updated = count(proposal.taskUpdates), archived = count(proposal.taskDeletions), tabs = count(proposal.tabs);
  const ty = address === 'ty';
  if (!created && !updated && !archived && !tabs) {
    // The model proposed a change the scope removed: the missing piece is which task.
    if (proposal.operationsDropped === true) return droppedOperationsReply(isUk, address);
    return isUk
      ? `Не вдалося підготувати зміни в межах цього запиту. ${ty ? 'Уточни' : 'Уточніть'}, яке саме завдання й що потрібно змінити.`
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
    ? `Пропозиція готова: ${list}. ${ty ? 'Переглянь її й натисни' : 'Перегляньте її й натисніть'} «Застосувати зміни», щоб її виконати.`
    : `Proposal ready: ${list}. Review it and press Apply changes to carry it out.`;
}
