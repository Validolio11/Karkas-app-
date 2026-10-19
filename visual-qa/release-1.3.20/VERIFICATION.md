# Verification: Karkas 1.3.20

Date: 2026-10-19. The user explicitly authorized testing, live checks with their test Gemini key, browser checks and this release.

Change: `replan_day` lays today's unfinished timed blocks (missed, paused, future) back to back from now and reports overflow past midnight; the agent maps «підкоригуй час, я не встигаю» to it and asks move-to-tomorrow / shorten / clear-time on overflow; `shift_day` also moves missed and paused blocks that stay in the future; missed blocks show «Пропущено з …» with «Почати зараз» / «Перебудувати день»; the list bar appears for missed and paused-overdue blocks with «Перебудувати решту дня від зараз»; the card time range opens a dialog to change start/end/date or clear time; off-topic dictation prompts a clarification.

- General and strict typechecks passed.
- Full source suite: 917/917 passed both with and without GEMINI_API_KEY (after the final source change; not repeated for the version bump).
- Live agent (dev server API, real Gemini) on the user's evening state: «Підкорегуй завдання по годині бо я не встигаю» and «Коригуй час, бо я не встигаю» → replan from 18:45 with overflow clarification (3 options); «посунь решту дня на 30 хв» → nothing moved past midnight, clarification; «Париж зараз 1 година і в Петербурзі час» → asks whether it is about the schedule.
- In-app (browser, guest workspace): bar «2 блоки вже в минулому» with «Перебудувати решту дня від зараз» → 18:45, 19:15–21:15, 21:15, 21:45 and Undo restored all; card «Пропущено з 15:43 · Почати зараз · Перебудувати день»; schedule dialog changed «Відпочинок» to «Сьогодні 22:00–23:00»; 375 px dialog fits without horizontal scroll.
- Production build and Windows x64 NSIS packaging for 1.3.20; latest.yml in the published format.
- Packaged archive: all 37 dist/electron files match; version 1.3.20; no .env files; the local test key string is absent.
- Packaged executable runtime smoke: 2/2 passed without a key; file version 1.3.20.

Not verified: desktop (Electron) chat with a live key. The agent reply may repeat the tool summary line once.

Release tag: 1.3.20 (no v prefix). Publication through the authenticated GitHub CLI with size and SHA256 digest checks.
