import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { initializeApp } from 'firebase/app';
import { initializeAuth, inMemoryPersistence, browserPopupRedirectResolver, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import config from '../firebase-applet-config.json';
import './index.css';

// Isolated sign-in page: never load the workspace or its sync effects in the browser.
const browserAuth = initializeAuth(initializeApp(config, 'desktop-browser-login'), {
  persistence: inMemoryPersistence,
  popupRedirectResolver: browserPopupRedirectResolver,
});
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });
const state = new URLSearchParams(window.location.hash.slice(1)).get('state');
window.history.replaceState(null, '', window.location.pathname);

function DesktopLogin() {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const login = async () => {
    if (!state || busy || done) return;
    setBusy(true);
    setError('');
    try {
      // This explicit browser click permits the Google account picker popup.
      const result = await signInWithPopup(browserAuth, provider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (!credential?.idToken && !credential?.accessToken) throw new Error('missing-credential');
      const response = await fetch('/callback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state, idToken: credential.idToken, accessToken: credential.accessToken }),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error('callback-expired');
      setDone(true);
    } catch (failure: any) {
      const code = failure?.code || failure?.message;
      setError(code === 'auth/unauthorized-domain'
        ? 'Для входу потрібно додати localhost до Authorized domains у Firebase Authentication.'
        : code === 'auth/popup-closed-by-user'
        ? 'Вхід скасовано. Можна спробувати ще раз.'
        : code === 'auth/popup-blocked'
        ? 'Браузер заблокував вікно Google. Дозвольте спливне вікно для цієї сторінки та спробуйте ще раз.'
        : 'Не вдалося завершити вхід. Перевірте інтернет або почніть вхід заново в застосунку Karkas.');
    } finally {
      await signOut(browserAuth).catch(() => undefined);
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#030303] text-white flex items-center justify-center p-6 font-mono">
      <section className="w-full max-w-md border border-neutral-700 bg-neutral-950 p-8 space-y-6">
        <p className="text-xs text-neutral-400 tracking-widest">KARKAS / GOOGLE</p>
        <h1 className="text-xl font-bold">{done ? 'Поверніться до Karkas' : 'Вхід у застосунок'}</h1>
        <p className="text-sm text-neutral-300 leading-relaxed">
          {done ? 'Дані входу передано застосунку. Цю вкладку можна закрити.'
            : !state ? 'Ця сесія входу завершилась. Натисніть «Увійти через Google» у Karkas ще раз.'
            : 'Оберіть свій Google-акаунт. Після входу застосунок підключить його автоматично.'}
        </p>
        {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
        {!done && state && <button type="button" onClick={login} disabled={busy}
          className="w-full bg-white text-black px-4 py-3 font-bold disabled:opacity-50 cursor-pointer">
          {busy ? 'Очікуємо вхід…' : 'Продовжити з Google'}
        </button>}
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<DesktopLogin />);
