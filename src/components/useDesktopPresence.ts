import { useCallback, useEffect, useRef } from 'react';
import type { PSTask } from '../types';
import { buildDesktopPresence, type DesktopPresence } from '../utils/desktopPresence';

export function useDesktopPresence(tasks: PSTask[], lang: 'uk' | 'en', enabled: boolean): void {
  const lastSent = useRef<string | undefined>(undefined);
  const latest = useRef({ tasks, lang, enabled });
  latest.current = { tasks, lang, enabled };
  const hasRunning = tasks.some(task => !task.done && !task.scheduledPending && task.timerRunning);

  const send = useCallback((force = false): DesktopPresence | undefined => {
    try {
      const system = window.karkasDesktop?.system;
      if (!system?.setPresence) return;
      const current = latest.current;
      const presence: DesktopPresence = current.enabled
        ? buildDesktopPresence(current.tasks, Date.now(), current.lang) : { lang: current.lang };
      const json = JSON.stringify(presence);
      if (force || json !== lastSent.current) {
        system.setPresence(presence);
        lastSent.current = json;
      }
      return presence;
    } catch { /* Native presence must never interrupt task work. */ }
  }, []);

  useEffect(() => {
    const presence = send();
    if (!enabled || presence?.active?.state !== 'paused') return;
    // Expire recent pauses even when the renderer has no running timer to tick it.
    const timer = window.setInterval(() => {
      if (send()?.active?.state !== 'paused') window.clearInterval(timer);
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [tasks, lang, enabled, send]);

  useEffect(() => {
    if (!enabled || !hasRunning) return;
    // Keep this interval stable while task snapshots change during the session.
    const timer = window.setInterval(() => send(true), 15_000);
    return () => window.clearInterval(timer);
  }, [enabled, hasRunning, send]);

  useEffect(() => () => {
    try {
      window.karkasDesktop?.system?.setPresence?.({ lang: latest.current.lang });
    } catch { /* The window may already be closing. */ }
    lastSent.current = undefined;
  }, []);
}

export interface DesktopCommandHandlers {
  toggleTimer: (taskId: string) => void;
  completeTask: (taskId: string) => void;
  startTask: (taskId: string) => void;
}

export function subscribeDesktopCommands(handlers: DesktopCommandHandlers): () => void {
  try {
    const desktopWindow = window.karkasDesktop?.window;
    if (!desktopWindow?.onCommand) return () => {};
    return desktopWindow.onCommand(command => {
      if (!command || typeof command !== 'object' || typeof command.taskId !== 'string') return;
      try {
        if (command.type === 'toggle-timer') handlers.toggleTimer(command.taskId);
        else if (command.type === 'complete-task') handlers.completeTask(command.taskId);
        else if (command.type === 'start-task') handlers.startTask(command.taskId);
      } catch { /* A native quick action must not break the subscription. */ }
    });
  } catch {
    return () => {};
  }
}
