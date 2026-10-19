# Verification: Karkas 1.3.23

Date: 2026-10-20. The user explicitly asked to release a new version after each change set was tested with their separate permission.

Change: decision-first task list (Now strip, one-line quick add with token parsing, compact cards, relative dates, overdue-first sorting, dashboard category percent fix); end-of-session summary card with neutral countdown-end wording; Windows taskbar progress/overlay and live tray menu; day closure with carry-over and morning recap; first-run onboarding with four actions.

- General and strict typechecks passed.
- Full source suite: 1006/1006 passed (new: quick add parser, relative dates, session summary, desktop presence on both sides, day recap, onboarding).
- Browser checks on the dev build (1440x900 and 375x812): Now strip, quick add parsing and wizard prefill, compact cards and expansion, overdue deadline moves, dashboard percent, session card after pause/completion/countdown end (+10 min), onboarding steps 1–2 with a 5-minute countdown, morning recap, day-close dialog with carry-over (evening simulated by patching the page clock).
- Production build and Windows x64 NSIS packaging for 1.3.23; latest.yml prepared in the published format.
- Packaged archive: all 39 dist/electron files match; version 1.3.23; no .env files.
- Packaged executable runtime smoke: 2/2 passed; file version 1.3.23.

Not verified: taskbar progress, overlay icon, tray menu commands and the onboarding notification test in a running packaged app (they exist only in Electron; covered by unit tests of the pure helpers and the preload bridge). The update was not installed on the user's machine.

Release tag: 1.3.23 (no v prefix). Publication through the authenticated GitHub CLI with size and SHA256 digest checks.
