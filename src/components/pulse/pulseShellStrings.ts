// The same Ukrainian / English language selection used by utils/i18n.
export const PULSE_SHELL_STRINGS = {
  uk: {
    sections: 'Розділи', today: 'Завдання', growth: 'Навички', notes: 'Блокнот',
    tabTips: { today: 'Завдання, план і таймер', growth: 'Навички та ваш прогрес', notes: 'Нотатки й ідеї' },
    search: 'Пошук', searchTip: 'Пошук · Ctrl F', settings: 'Налаштування',
    add: 'Додати', addTip: 'Нова задача · Ctrl N', account: 'Акаунт', guest: 'Гість',
    ai: 'Відкрити Karkas AI', aiTip: 'Відкрити Karkas AI · Ctrl K',
    window: 'Вікно', minimize: 'Згорнути', maximize: 'Розгорнути', restore: 'Відновити', close: 'Закрити',
    sync: { idle: 'на цьому пристрої', pending: 'очікування синхронізації', syncing: 'синхронізація', synced: 'синхронізовано', offline: 'немає мережі', error: 'помилка синхронізації' },
  },
  en: {
    sections: 'Sections', today: 'Tasks', growth: 'Skills', notes: 'Notepad',
    tabTips: { today: 'Tasks, planning and timer', growth: 'Skills and your progress', notes: 'Notes and ideas' },
    search: 'Search', searchTip: 'Search · Ctrl F', settings: 'Settings',
    add: 'Add', addTip: 'New task · Ctrl N', account: 'Account', guest: 'Guest',
    ai: 'Open Karkas AI', aiTip: 'Open Karkas AI · Ctrl K',
    window: 'Window', minimize: 'Minimize', maximize: 'Maximize', restore: 'Restore', close: 'Close',
    sync: { idle: 'on this device', pending: 'sync pending', syncing: 'syncing', synced: 'synced', offline: 'offline', error: 'sync error' },
  },
} as const;
