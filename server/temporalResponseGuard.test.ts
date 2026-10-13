import assert from 'node:assert/strict';
import test from 'node:test';
import { changeOfferQuestion, guardOperationlessReply, guardTemporalResponse, guardUnappliedClaims, hasProposedOperations, lastChangeOffer, staleProposalReply, taskScopeClarificationReply } from './temporalResponseGuard';

const empty = { tasks: [], tabs: [], taskUpdates: [], taskDeletions: [] };
type GuardOptions = Parameters<typeof guardOperationlessReply>[2];
const guardUk = (reply: string, options: GuardOptions = {}) => guardOperationlessReply({ reply, ...empty }, true, options).reply;
const guardEn = (reply: string, options: GuardOptions = {}) => guardOperationlessReply({ reply, ...empty }, false, options).reply;
const NO_CHANGES_UK = /^Змін до завдань не підготовлено, тому застосовувати нічого\./;
const NO_CHANGES_EN = /^I did not prepare any task changes, so there is nothing to apply\./;

test('a claimed preparation without operations is replaced by an honest message', () => {
  // The follow-up "Так" turn from manual testing: nothing was attached, so no Apply button exists.
  const response = guardOperationlessReply({ reply: 'Я підготував видалення всіх 6 завдань. Натисніть «Застосувати зміни», щоб виконати його.', summary: 'x', ...empty }, true);
  assert.match(response.reply, NO_CHANGES_UK);
  assert.equal(response.summary, response.reply);
  for (const reply of ['Пропозицію сформовано.', 'Пропозиція готова: архівування завдань (6).', 'Добре, я вже сформувала пропозицію змін.', 'Зміни підготовлено.']) {
    assert.match(guardUk(reply), NO_CHANGES_UK, reply);
  }
  for (const reply of ["I've prepared the changes. Press Apply to carry them out.", 'Proposal prepared.', 'The proposal is ready.']) {
    assert.match(guardEn(reply), NO_CHANGES_EN, reply);
  }
});

test('an Apply instruction or a yes/no confirmation is removed and an honest note is appended', () => {
  const reply = guardUk('Я пропоную архівувати всі 6 завдань:\n\n- Звіт\n- Лист\n\nВиконати це очищення?');
  assert.match(reply, /^Я пропоную архівувати всі 6 завдань:\n\n- Звіт\n- Лист\n\nЗмін до завдань не підготовлено/);
  assert.doesNotMatch(reply, /Виконати/);
  assert.doesNotMatch(guardUk('Можна прибрати старі завдання, вони вже неактуальні. Прийняти ці зміни?'), /Прийняти/);
  for (const question of ['Підтверджуєте?', 'Чи виконати це?', 'Хочете, щоб я видалив їх?', 'Ви згодні з цими змінами?', 'Підтвердіть, і я все зроблю.']) {
    const guarded = guardUk(`Ці завдання виглядають застарілими й дублюють одне одне. ${question}`);
    assert.ok(!guarded.includes(question), question);
    assert.match(guarded, /Змін до завдань не підготовлено/, question);
  }
  assert.match(guardUk('Якщо все гаразд, натисніть «Застосувати зміни».'), NO_CHANGES_UK);
  const english = guardEn('These two tasks look like duplicates of each other. Shall I proceed?');
  assert.match(english, /^These two tasks look like duplicates of each other\.\n\nI did not prepare any task changes/);
});

test('on the task-command route a description of the missing proposal replaces the whole reply', () => {
  const text = 'Я пропоную архівувати всі 6 завдань… Виконати це очищення?';
  assert.match(guardUk(text, { operationRoute: true }), NO_CHANGES_UK);
  for (const reply of ['Архівую всі 6 завдань.', 'Добре, видалимо «Звіт».', 'Ось пропозиція:', 'Звичайно! Усі шість завдань буде архівовано.']) {
    assert.match(guardUk(reply, { operationRoute: true }), NO_CHANGES_UK, reply);
  }
  assert.match(guardEn("I'll archive all six tasks.", { operationRoute: true }), NO_CHANGES_EN);
  // On a read-only route the same advice is a suggestion, not a claim.
  assert.equal(guardUk('Пропоную перенести «Звіт» на п’ятницю, бо дедлайн у понеділок.'), 'Пропоную перенести «Звіт» на п’ятницю, бо дедлайн у понеділок.');
});

test('operations removed by the command scope produce the precise-name request instead of the claim', () => {
  assert.equal(guardUk('Пропоную архівувати всі 6 завдань.', { operationRoute: true, operationsDropped: true }),
    'Не вдалося визначити, яке саме завдання змінити, тому змін не підготовлено. Назвіть завдання точніше — і я підготую пропозицію.');
  assert.match(guardEn('I propose archiving all six tasks.', { operationRoute: true, operationsDropped: true }), /^I could not determine exactly which task to change/);
  // A reply that claims nothing (e.g. a cancelled proposal) stays.
  assert.equal(guardUk('Пропозицію скасовано.', { operationRoute: true, operationsDropped: true }), 'Пропозицію скасовано.');
});

test('replies with real operations and ordinary read-only answers are untouched', () => {
  const withOperations = { reply: 'Я підготував видалення. Натисніть «Застосувати зміни». Підтверджуєте?', ...empty, taskDeletions: [{ id: 't' }] };
  assert.equal(guardOperationlessReply(withOperations, true, { operationRoute: true, operationsDropped: true }), withOperations);
  const withStrategy = { reply: 'Пропозиція готова.', ...empty, strategy: { actions: [{ id: 'a' }] } };
  assert.equal(hasProposedOperations(withStrategy), true);
  assert.equal(guardOperationlessReply(withStrategy, true), withStrategy);
  const readOnly = [
    'Щоб застосувати пропозицію, натисніть «Застосувати зміни» під нею.',
    'Коли пропозиція готова, натисніть «Застосувати».',
    'Застосуйте техніку помодоро: 25 хвилин роботи, 5 хвилин перерви.',
    'Ваша комерційна пропозиція готова на 80%, залишився розділ з цінами.',
    'Видалити «Звіт» чи «Звіт 2»?',
    'Перенести «Звіт» на завтра чи на п’ятницю?',
    'Я не підготував жодних змін.',
    '> Я підготував зміни — так написав колега.',
    'Що для вас зараз найважливіше?',
  ];
  for (const reply of readOnly) assert.equal(guardUk(reply), reply, reply);
  for (const reply of ['Should I explain the timer in more detail?', 'When the proposal is ready, press Apply changes.', 'Apply the two-minute rule to small tasks.']) {
    assert.equal(guardEn(reply), reply, reply);
  }
});

test('the guard is idempotent on its own messages', () => {
  for (const options of [{}, { operationRoute: true }]) {
    const uk = guardUk('Я підготував зміни.', options);
    assert.equal(guardUk(uk, options), uk);
    const en = guardEn('Proposal prepared.', options);
    assert.equal(guardEn(en, options), en);
  }
  const dropped = guardUk('Архівую всі завдання.', { operationRoute: true, operationsDropped: true });
  assert.equal(guardUk(dropped, { operationRoute: true }), dropped);
});

test('offers of a concrete change are told apart from confirmations of a proposal', () => {
  for (const offer of ['Додати ці кроки до завдання «Інтро»?', 'Я можу додати ці пункти підзадачами до задачі «Інтро» на завтра?', 'Хочеш, я розіб’ю інтро на кроки?',
    'Хочете, щоб я переніс «Звіт» на п’ятницю?', 'Давай додамо таймер на 20 хвилин?', 'Shall I add these steps to the intro?', 'Do you want me to create a task for it?']) {
    assert.equal(changeOfferQuestion(offer), true, offer);
  }
  for (const other of ['Підтверджуєте?', 'Застосувати зміни?', 'Shall I proceed?', 'Перенести «Звіт» на завтра чи на п’ятницю?', 'Додати ці кроки.', 'Що для вас зараз найважливіше?']) {
    assert.equal(changeOfferQuestion(other), false, other);
  }
  assert.equal(lastChangeOffer('[12.10 14:05] План:\n1. Відкрити проєкт — 15 хв\n\n**Додати ці кроки до «Інтро»?**'), 'Додати ці кроки до «Інтро»?');
  assert.equal(lastChangeOffer('Гарного дня!'), undefined);
  assert.equal(lastChangeOffer(undefined), undefined);
});

test('where a yes is carried over, an offer stays while confirmations and claims are still guarded', () => {
  const offer = 'Почніть з короткого кроку на 15 хвилин. Додати цей крок до «Інтро»?';
  assert.equal(guardUk(offer, { offersCanFollow: true }), offer);
  assert.equal(guardUk('Можна розбити інтро на кроки. Хочеш, я розіб’ю його?', { offersCanFollow: true, operationRoute: true }), 'Можна розбити інтро на кроки. Хочеш, я розіб’ю його?');
  // Without the carry-over the same question is still a dead end.
  assert.match(guardUk(offer), /Змін до завдань не підготовлено/);
  assert.match(guardUk('Я підготував зміни. Додати цей крок?', { offersCanFollow: true }), NO_CHANGES_UK);
  assert.match(guardUk('Ці завдання застаріли. Підтверджуєте?', { offersCanFollow: true }), /Змін до завдань не підготовлено/);
});

test('app-written guard notes use the person’s ти and keep ви as the default', () => {
  const tyNote = guardUk('Я підготував видалення всіх 6 завдань.', { address: 'ty' });
  assert.match(tyNote, NO_CHANGES_UK);
  assert.match(tyNote, /напиши, що саме зробити, і назви потрібні завдання точніше/);
  assert.doesNotMatch(tyNote, /напишіть|назвіть/);
  assert.match(guardUk('Я підготував видалення всіх 6 завдань.'), /напишіть, що саме зробити, і назвіть/);
  assert.match(guardUk('Пропоную архівувати «Звіт».', { operationRoute: true, operationsDropped: true, address: 'ty' }), /Назви завдання точніше — і я підготую пропозицію\.$/);
  assert.match(guardUk('Пропоную архівувати «Звіт».', { operationRoute: true, operationsDropped: true }), /Назвіть завдання точніше/);
  // English has no special form.
  assert.equal(guardEn('Proposal prepared.', { address: 'ty' }), guardEn('Proposal prepared.'));

  const claimed = guardUnappliedClaims({ reply: 'Я переніс завдання на завтра.', ...empty }, true, 'ty');
  assert.match(claimed.reply, /Уточни, які завдання/);
  assert.doesNotMatch(claimed.reply, /Уточніть/);
  assert.match(guardUnappliedClaims({ reply: 'Я переніс завдання на завтра.', ...empty }, true).reply, /Уточніть, які завдання/);

  const clock = { now: '2026-10-13T10:00:00Z', timeZone: 'UTC' };
  const contradicting = { reply: 'Готово.', ...empty, taskUpdates: [{ id: 't', plannedDate: '2026-10-20' }] };
  const temporalTy = guardTemporalResponse(contradicting, 'Заплануй це на завтра', clock, true, 'ty');
  assert.match(temporalTy.reply, /У твоєму запиті вказано 2026-10-14/);
  assert.match(temporalTy.reply, /Спробуй повторити запит/);
  assert.deepEqual(temporalTy.taskUpdates, []);
  const temporalVy = guardTemporalResponse(contradicting, 'Заплануйте це на завтра', clock, true);
  assert.match(temporalVy.reply, /У вашому запиті вказано 2026-10-14.*Спробуйте повторити запит/s);
});

test('stale-proposal and task-scope clarifications follow the person’s form of address', () => {
  assert.match(staleProposalReply(true, 'ty'), /Повтори, будь ласка, сам запит або назви потрібні завдання/);
  assert.match(staleProposalReply(true), /Повторіть, будь ласка, сам запит або назвіть/);
  assert.match(taskScopeClarificationReply(true, 'ty'), /на вказану тобою дату\? Назви їх/);
  assert.match(taskScopeClarificationReply(true), /на вказану вами дату\? Назвіть їх/);
  assert.equal(staleProposalReply(false, 'ty'), staleProposalReply(false));
  assert.equal(taskScopeClarificationReply(false, 'ty'), taskScopeClarificationReply(false));
});
