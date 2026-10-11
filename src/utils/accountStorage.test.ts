import assert from 'node:assert/strict';
import test from 'node:test';
import { accountStorageKey, readAccountStorage, removeAccountStorage, writeAccountStorage } from './accountStorage';
import { loadAIChatHistory, saveAIChatHistory, ensureAIChatWelcome, clearAIChatHistory } from '../services/chatHistory';

function memory() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}

test('new slots distinguish guest, account guest, account namespaces and punctuation', () => {
  const storage = memory();
  for (const owner of [null, 'guest', 'account:guest', '', 'a:b', 'a%3Ab']) writeAccountStorage(storage, 'chat', owner, JSON.stringify(owner));
  assert.equal(storage.values.size, 6);
  for (const owner of [null, 'guest', 'account:guest', '', 'a:b', 'a%3Ab']) assert.equal(readAccountStorage(storage, 'chat', owner), JSON.stringify(owner));
  removeAccountStorage(storage, 'chat', 'guest');
  assert.equal(readAccountStorage(storage, 'chat', 'guest'), null);
  assert.equal(readAccountStorage(storage, 'chat', null), 'null');
});

test('legacy data stays available, new writes win, and clearing cannot resurrect an old draft', () => {
  const storage = memory();
  storage.setItem('chat:account-a', 'legacy');
  assert.equal(readAccountStorage(storage, 'chat', 'account-a'), 'legacy');
  storage.setItem(accountStorageKey('chat', 'account-a'), 'newer');
  assert.equal(readAccountStorage(storage, 'chat', 'account-a'), 'newer');
  removeAccountStorage(storage, 'chat', 'account-a');
  assert.equal(readAccountStorage(storage, 'chat', 'account-a'), null);
  storage.setItem('chat:guest', 'ambiguous legacy guest');
  assert.equal(readAccountStorage(storage, 'chat', 'guest'), null);
  assert.equal(readAccountStorage(storage, 'chat', null), 'ambiguous legacy guest');
  writeAccountStorage(storage, 'chat', 'guest', 'private account');
  assert.equal(storage.getItem('chat:guest'), 'ambiguous legacy guest');
});

test('chat history and one-time welcome remain isolated during guest/account switching and migration', () => {
  const storage = memory();
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  try {
    storage.setItem('karkas_ai_chat_history:guest', JSON.stringify([{ role: 'user', content: 'Old guest conversation' }]));
    assert.equal(loadAIChatHistory(null)[0].content, 'Old guest conversation');
    assert.deepEqual(loadAIChatHistory('guest'), []);
    const guest = ensureAIChatWelcome(null, loadAIChatHistory(null), 'Guest welcome', false);
    const account = ensureAIChatWelcome('guest', [], 'Account welcome', false);
    assert.equal(guest.added, true); assert.equal(account.added, true);
    assert.equal(ensureAIChatWelcome('guest', account.messages, 'Repeat', false).added, false);
    saveAIChatHistory('guest', [...account.messages, { role: 'user', content: 'Account private answer' }]);
    assert.equal(loadAIChatHistory(null).some(message => message.content === 'Account private answer'), false);
    clearAIChatHistory('guest');
    assert.equal(loadAIChatHistory('guest').length, 0);
    assert.equal(loadAIChatHistory(null).length, 2);
    storage.setItem('karkas_ai_chat_history:old-account', JSON.stringify([{ role: 'user', content: 'Old account answer' }]));
    assert.equal(loadAIChatHistory('old-account')[0].content, 'Old account answer');
    saveAIChatHistory('old-account', loadAIChatHistory('old-account'));
    assert.equal(storage.getItem('karkas_ai_chat_history:old-account'), null);
    assert.equal(loadAIChatHistory('old-account')[0].content, 'Old account answer');
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
