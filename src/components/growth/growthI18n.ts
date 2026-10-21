/** Small counts read as words in the weekly headline: «Дві зросли, одна стоїть». */
const UK_COUNT: Record<number, string> = { 2: 'Дві', 3: 'Три', 4: 'Чотири', 5: 'Пʼять' };
const UK_COUNT_LOWER: Record<number, string> = { 2: 'дві', 3: 'три', 4: 'чотири', 5: 'пʼять' };
import type { Language } from '../../utils/i18n';

export const GROWTH_STRINGS = {
  uk: {
    title: ['Чи стаю', 'я кращим?'], skills: 'Навички', week: 'Тиждень', view: 'Вигляд росту', addSkill: '+ Навичка',
    empty: ['Яку навичку', 'прокачуємо?'], examples: ['Холодні дзвінки', 'Англійська', 'React', '+ Своя'],
    weakest: 'Найслабша ланка', success: 'успіху', train: 'Тренувати', nextMeasurement: 'Наступний замір', enter: 'Внести',
    today: 'сьогодні', yesterday: 'вчора', controlMeasure: 'Контрольний замір', chartLabel: (from: string, to: string) => 'Контрольні заміри: ' + from + ' → ' + to, inDays: (days: number) => 'через ' + days + (days === 1 ? ' день' : days < 5 ? ' дні' : ' днів'),
    minutes: 'хв', completeMetric: 'Допиши метрику', draft: 'Ціль зі стратегії',
    latestLesson: 'Останній висновок', noLesson: 'Що змінюємо наступного разу?', noLessonHint: 'Збережи висновок після практики',
    toPractice: 'У практику', measure: 'Внести замір', back: 'Назад до Росту', start: 'Почати', subskills: 'Підскладові',
    noSubskills: '+ Підскладова', edit: 'Налаштувати навичку', noScoredSessions: 'Ще немає трьох практик із результатом',
    goal: 'ціль', measurements: 'Контрольні заміри', noMeasurements: 'Перший замір покаже твій рух',
    weeklyPlan: 'План на тиждень', addTasks: 'Додати в задачі', addedTasks: 'Додано в задачі',
    previousWeek: 'Попередній тиждень', nextWeek: 'Наступний тиждень', noWeekLesson: 'Додай висновок після наступної практики',
    noWeekSkills: 'Цього тижня ще немає навичок', weeklyTitle: (grown: number, same: number, down: number) =>
      grown ? [(grown === 1 ? 'Одна зросла' : (UK_COUNT[grown] ?? grown) + ' зросли') + ',', down ? (UK_COUNT_LOWER[down] ?? down) + ' потребують уваги' : same === 1 ? 'одна стоїть' : same ? (UK_COUNT_LOWER[same] ?? same) + ' стоять' : 'рухаємось далі'] : ['Тиждень', down ? 'час змінити підхід' : 'твого росту'],
    growth: 'Ріст', noChange: 'Без змін', decline: 'Потрібна увага', plateau: (weeks: number) => 'Плато ' + weeks + ' тиж',
    statuses: { ahead: 'Випереджаєш', on_track: 'На шляху', behind: 'Відстаєш', no_data: 'Немає замірів' },
    noWeakest: 'Знайдемо твій наступний крок', noWeakestDetail: 'Три практики з результатом допоможуть визначити найслабшу ланку.',
  },
  en: {
    title: ['Am I', 'getting better?'], skills: 'Skills', week: 'Week', view: 'Growth view', addSkill: '+ Skill',
    empty: ['Which skill', 'shall we grow?'], examples: ['Cold calling', 'English', 'React', '+ My own'],
    weakest: 'Weakest link', success: 'success', train: 'Practice', nextMeasurement: 'Next measurement', enter: 'Log result',
    today: 'today', yesterday: 'yesterday', controlMeasure: 'Control measurement', chartLabel: (from: string, to: string) => 'Control measurements: ' + from + ' → ' + to, inDays: (days: number) => 'in ' + days + (days === 1 ? ' day' : ' days'),
    minutes: 'min', completeMetric: 'Set your metric', draft: 'Strategy goal',
    latestLesson: 'Latest lesson', noLesson: 'What changes next time?', noLessonHint: 'Save a lesson after your practice',
    toPractice: 'Add to practice', measure: 'Log measurement', back: 'Back to Growth', start: 'Start', subskills: 'Subskills',
    noSubskills: '+ Subskill', edit: 'Edit skill', noScoredSessions: 'Complete three scored practices first',
    goal: 'goal', measurements: 'Control measurements', noMeasurements: 'Your first measurement will show your progress',
    weeklyPlan: 'Plan for the week', addTasks: 'Add to tasks', addedTasks: 'Added to tasks',
    previousWeek: 'Previous week', nextWeek: 'Next week', noWeekLesson: 'Save a lesson after your next practice',
    noWeekSkills: 'No skills for this week yet', weeklyTitle: (grown: number, same: number, down: number) =>
      grown ? [grown + (grown === 1 ? ' skill grew,' : ' skills grew,'), down ? down + ' need attention' : same ? same + ' held steady' : 'keep moving'] : ['A week', down ? 'to change approach' : 'of your growth'],
    growth: 'Growth', noChange: 'No change', decline: 'Needs attention', plateau: (weeks: number) => 'Plateau ' + weeks + ' wk',
    statuses: { ahead: 'Ahead', on_track: 'On track', behind: 'Behind', no_data: 'No measurements' },
    noWeakest: 'Find your next step', noWeakestDetail: 'Three scored practices will help identify your weakest link.',
  },
} as const;

export function useGrowthCopy(lang: Language = 'uk') { return GROWTH_STRINGS[lang]; }
