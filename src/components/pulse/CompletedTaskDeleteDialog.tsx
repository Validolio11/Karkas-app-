import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useDialogKeyboard } from '../useDialogKeyboard';
import './taskCompletion.css';

interface Props {
  title: string;
  lang: 'uk' | 'en';
  onClose: () => void;
  onDelete: (accidental: boolean) => void;
}

export function CompletedTaskDeleteDialog({ title, lang, onClose, onDelete }: Props) {
  const uk = lang === 'uk';
  useDialogKeyboard(true, onClose, 'completed-task-delete-dialog');
  return createPortal(<div className="pulse-completed-delete-overlay app-no-drag" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div id="completed-task-delete-dialog" className="pulse-completed-delete" role="dialog" aria-modal="true" aria-labelledby="completed-task-delete-title" aria-describedby="completed-task-delete-name">
      <header><h2 id="completed-task-delete-title">{uk ? 'Видалити виконане завдання?' : 'Delete completed task?'}</h2><button type="button" onClick={onClose} aria-label={uk ? 'Закрити' : 'Close'}><X size={20} aria-hidden="true" /></button></header>
      <p id="completed-task-delete-name">{title}</p>
      <button type="button" className="pulse-completed-delete-choice" onClick={() => onDelete(false)}><strong>{uk ? 'Прибрати з історії' : 'Remove from history'}</strong><span>{uk ? 'Виконання залишиться в загальній статистиці.' : 'Completion stays in your total statistics.'}</span></button>
      <button type="button" className="pulse-completed-delete-choice" onClick={() => onDelete(true)}><strong>{uk ? 'Додано помилково' : 'Added by mistake'}</strong><span>{uk ? 'Видалити й не враховувати у статистиці.' : 'Delete and exclude from statistics.'}</span></button>
      <button type="button" className="pulse-completed-delete-cancel" onClick={onClose}>{uk ? 'Скасувати' : 'Cancel'}</button>
    </div>
  </div>, document.body);
}
