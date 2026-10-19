# Verification: Karkas 1.3.18

Date: 2026-10-19. The user explicitly authorized testing, live checks with their test Gemini key, and this release.

Change: a countdown still auto-stops at zero but records `countdownExpiredAt`; the card offers «Ще працюю (+N хв)» (credits the gap since zero, max 3 h, and extends the countdown instead of restarting a full interval), «Закінчив щойно» (credits until now) and «Не працював»; reminders at 0, +15, +45 min. Planned blocks: «Ти відстаєш від плану на N хв» bar with «Посунути решту дня», agent actions continue_after_expiry, finish_after_expiry, shift_day; tab suggestion instead of silent fallback.

- General and strict typechecks passed.
- Full source suite: 873/873 passed both with and without GEMINI_API_KEY (after the final source change; not repeated for the version bump).
- Live agent (dev server API, real Gemini): «Я ще працюю над встановленням жалюзі» → credited 35 min and extended 30 min; «закінчив жалюзі о HH:MM» → credited 25 min (summary minutes now rounded); «посунь решту дня на пів години» → 3 later blocks shifted; «відпочинок о 22 на годину» → created and suggested an «Особисте» tab.
- In-app (browser, guest workspace seeded through the app's own workspace storage): expiry notice and reminder text, «Ще працюю (+20 хв)» credited 20 min and extended to 90 min; «Посунути решту дня на +25 хв» shifted 2 blocks and Undo restored them; 375 px width without horizontal scroll.
- Production build and Windows x64 NSIS packaging for 1.3.18; latest.yml in the published format.
- Packaged archive: all 37 dist/electron files match; version 1.3.18; no .env files; the local test key string is absent.
- Packaged executable runtime smoke: 2/2 passed without a key; file version 1.3.18.

Not verified: Windows notifications for the +15/+45 reminders in the packaged app; desktop (Electron) chat with a live key.

Release tag: 1.3.18 (no v prefix). Publication through the authenticated GitHub CLI with size and SHA256 digest checks.
