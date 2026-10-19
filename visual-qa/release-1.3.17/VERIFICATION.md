# Verification: Karkas 1.3.17

Date: 2026-10-19. The user explicitly authorized merging the display branch, testing, live checks with their test Gemini key, and this release.

Change: hour-by-hour day planning by the AI agent (`plan_day` computes sequential visible time blocks with paused countdowns, fixed spoken times, no overlaps, no duplicates of existing tasks), timed fields on create/update, tab chosen by name/meaning, priority rules; task cards show «Сьогодні 14:00–15:00» and today's timed tasks are listed first in time order (merged from refs/heads/claude/sweet-feynman-7e470b, commit 70dfec0).

- General and strict typechecks passed.
- Full source suite: 835/835 passed both with and without GEMINI_API_KEY. Fixed during verification: a timed-fields engine test reused generated IDs; display test fixtures lacked the required `done` field.
- Live agent checks (dev server API, real Gemini): the user's day-plan phrase → 14:00–15:00 blinds (estimated, Особисте), 15:00–15:30 planning, 15:30–20:30 existing «Робота над анімацією» updated without a duplicate (P1), 20:30–21:00 typing in «Навчання», 21:00–22:00 rest (P3, estimated). Spoken hours «з пів першої до третьої…» → 12:30–15:00 and sequential blocks (Flash-Lite fallback kept P2 everywhere and put «друк» without «навчання» in Особисте).
- In-app (browser, guest workspace, synthetic placeholder key stripped so the server key was used): cards show the time range and sort by start; 375 px width without horizontal scroll; Undo removes a whole day plan and a created tab with its task. Agent summary lines now render on separate lines.
- Production build and Windows x64 NSIS packaging for 1.3.17; latest.yml in the published format.
- Packaged archive: all 37 dist/electron files match; version 1.3.17; no .env files; the local test key string is absent.
- Packaged executable runtime smoke: 2/2 passed without a key; file version 1.3.17.

Not verified: desktop (Electron) chat with a live key; Windows start-time notifications for planned blocks in the packaged app; DST-spanning plan blocks are rejected by design.

Release tag: 1.3.17 (no v prefix). Publication through the authenticated GitHub CLI with size and SHA256 digest checks.
