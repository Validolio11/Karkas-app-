import type { Language } from '../../utils/i18n';

const copy = {
  uk: {
    newFirst: 'Нова', newSecond: 'навичка', setupFirst: 'Допиши', setupSecond: 'метрику', back: 'Назад до Росту',
    fits: 'Метрика підходить', checks: ['Результат, а не час', 'Замір за 10 хв', 'Ціль реальна'],
    title: 'Назва навички', titlePlaceholder: 'Що хочу вміти краще?', metricFirst: 'Як я зрозумію,', metricSecond: 'що став кращим?',
    metric: 'Метрика', metricPlaceholder: 'Вимірюваний результат', unit: 'Одиниця виміру', unitPlaceholder: '% / слів/хв', direction: 'Напрям метрики',
    up: 'Більше — краще', down: 'Менше — краще', measurement: 'Контрольний замір', how: 'Як проводжу контрольний замір', howPlaceholder: 'Однакова умова для кожного заміру',
    weekly: 'Щотижня', weekday: 'День контрольного заміру', time: 'Час заміру', minutes: 'Тривалість заміру, хв', min: 'хв',
    weekdays: ['неділя', 'понеділок', 'вівторок', 'середа', 'четвер', 'пʼятниця', 'субота'],
    start: 'Старт', today: 'сьогодні', startValue: 'Стартове значення', goal: 'Ціль', goalValue: 'Цільове значення', deadline: 'Термін',
    subskills: 'Підскладові', subskill: 'Назва підскладової', add: '+ Додати', remove: 'Видалити підскладову', cancel: 'Скасувати', create: 'Створити навичку', saveSetup: 'Зберегти навичку',
    saveFailed: 'Не вдалося зберегти. Перевір значення та спробуй ще раз.', invalidGoal: 'Ціль має відповідати обраному напряму метрики.',
    close: 'Закрити', finish: 'Завершення практики', less: 'Менше', more: 'Більше', result: 'Результат', of: 'з', attempts: 'Кількість спроб',
    difficulty: 'Складність', easy: 'Легко', edge: 'На межі', hard: 'Занадто',
    easyTip: 'На автоматі — підтримуємо навичку', edgeTip: 'Помилки й виправлення — зона росту', hardTip: 'Наступного разу спростимо',
    lesson: 'Що змінюю наступного разу?', skip: 'Пропустити', save: 'Зберегти', above: 'вище', below: 'нижче', successes: 'Успішних', pickDate: 'Обери дату', inWeeks: (weeks: number) => weeks ? 'через ' + weeks + (weeks % 10 === 1 && weeks % 100 !== 11 ? ' тиждень' : [2, 3, 4].includes(weeks % 10) && ![12, 13, 14].includes(weeks % 100) ? ' тижні' : ' тижнів') : 'цього тижня', same: 'як рівень',
  },
  en: {
    newFirst: 'New', newSecond: 'skill', setupFirst: 'Complete', setupSecond: 'the metric', back: 'Back to Growth',
    fits: 'A useful metric', checks: ['An outcome, rather than time', 'Measured in 10 min', 'A realistic goal'],
    title: 'Skill name', titlePlaceholder: 'What do I want to improve?', metricFirst: 'How will I know', metricSecond: 'I am getting better?',
    metric: 'Metric', metricPlaceholder: 'A measurable outcome', unit: 'Metric unit', unitPlaceholder: '% / words/min', direction: 'Metric direction',
    up: 'More is better', down: 'Less is better', measurement: 'Control measurement', how: 'How I take the control measurement', howPlaceholder: 'The same conditions every time',
    weekly: 'Every week', weekday: 'Measurement weekday', time: 'Measurement time', minutes: 'Measurement duration, min', min: 'min',
    weekdays: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    start: 'Start', today: 'today', startValue: 'Starting value', goal: 'Goal', goalValue: 'Goal value', deadline: 'Deadline',
    subskills: 'Subskills', subskill: 'Subskill name', add: '+ Add', remove: 'Remove subskill', cancel: 'Cancel', create: 'Create skill', saveSetup: 'Save skill',
    saveFailed: 'Could not save. Check the values and try again.', invalidGoal: 'The goal must match the selected metric direction.',
    close: 'Close', finish: 'Finish practice', less: 'Decrease', more: 'Increase', result: 'Result', of: 'of', attempts: 'Number of attempts',
    difficulty: 'Difficulty', easy: 'Easy', edge: 'At the edge', hard: 'Too hard',
    easyTip: 'Automatic — maintaining the skill', edgeTip: 'Mistakes and corrections — the growth zone', hardTip: 'Make the next attempt simpler',
    lesson: 'What will I change next time?', skip: 'Skip', save: 'Save', above: 'above', below: 'below', successes: 'Successes', pickDate: 'Pick a date', inWeeks: (weeks: number) => weeks ? 'in ' + weeks + (weeks === 1 ? ' week' : ' weeks') : 'this week', same: 'at current level',
  },
};
export const growthFormsCopy = (lang: Language) => copy[lang];
