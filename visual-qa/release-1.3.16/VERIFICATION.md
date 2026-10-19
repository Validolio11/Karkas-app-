# Verification: Karkas 1.3.16

Date: 2026-10-19. The user explicitly authorized testing, live checks with their test Gemini key, and this release.

Change: ordinary chat runs a live Gemini agent (function-calling loop) that operates the app through a shared action engine; safe actions apply immediately with Undo, destructive ones need confirmation; clarification buttons; fallback-model notice removed; bare greetings answered without a model.

- General and strict typechecks passed.
- Full source suite: 803/803 passed both with and without GEMINI_API_KEY in the environment. Running without the key exposed a greeting regression (503 without a key) hidden by the local test key; the canned greeting was restored and the affected tests were updated.
- Live agent checks against real Gemini via the dev server API: compound "збільш час роботи над анімацією до 3х годин і заверш 3 етап" (countdown 2 h → 3 h + step 3), misspelled/surzhyk step completion, start a 25-minute timer, create for tomorrow with priority (no extra deadline), deadline by weekday, delete → pending confirmation, ambiguous "час збільш" → clarification buttons, chained steps + timer on Flash-Lite after raising its agent thinking level to LOW.
- In-app chat (browser, guest workspace, synthetic placeholder key stripped from requests so the server key was used): task creation without custom tabs (fixed: default focus category), compound command, Undo restores timer and step exactly, delete confirmation card and confirmed deletion with Undo.
- Production build and Windows x64 NSIS packaging for 1.3.16 (release/release-1.3.16); latest.yml in the published format.
- Packaged archive: all 37 dist/electron files match the built workspace bytes; version 1.3.16; no .env files; the local test key string is absent from the archive.
- Packaged executable runtime smoke: 2/2 passed without a key; file version 1.3.16.

Not verified: desktop (Electron) chat with a live key, word-by-word streaming (agent text arrives in one piece), two-device sync of agent changes.

Release tag: 1.3.16 (no v prefix, avoiding an independent CI publication). Publication through the authenticated GitHub CLI with size and SHA256 digest checks.
