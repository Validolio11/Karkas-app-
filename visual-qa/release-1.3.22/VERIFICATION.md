# Verification: Karkas 1.3.22

Date: 2026-10-19. The user explicitly demanded full human-factor testing, the fixes and this release.

Change: moving a timed task to another day keeps its hour; new `move_day` bulk action for "all of today's tasks → tomorrow"; the agent starts on Gemini 3.5 Flash-Lite with 3.8 Flash as fallback (free Flash tier ~20 requests/day, agent turns spend 2-4); Ukrainian date labels in the per-request (non-cached) part of the agent prompt.

- General and strict typechecks passed.
- Full source suite: 919/919 passed both with and without GEMINI_API_KEY. Model-order tests were updated to the new Lite-first default; a cache test caught the date labels in the static prompt prefix and they were moved to the dynamic part.
- New live suite `scripts/agent-scenarios.ts` (40 scenarios: moving days and single tasks, surzhyk dates, replanning, shifting, clearing/setting hours, day plans with spoken times, weekday + time creation, timers, overtime credit, finish time, limited attempt, forgotten timer, steps, priorities, tabs by name, completion/reopen, delete confirmation, rename with typos, pin, tab, note, dashboard, read-only questions, bare word, dictation noise, partially impossible request, English, clear completed, clarification button follow-up, follow-up context). First run 37/39 (one test expectation error, one Google quota hit) and revealed the date-move hour bug, the missing bulk move, wrong month names and Flash quota stalls. After fixes: 40/40 (docs/AGENT-SCENARIOS-2026-10-19.txt).
- Production build and Windows x64 NSIS packaging for 1.3.22; latest.yml in the published format.
- Packaged archive: all 37 dist/electron files match; version 1.3.22; no .env files; the local test key string is absent.
- Packaged executable runtime smoke: 2/2 passed without a key; file version 1.3.22.

Not verified: desktop (Electron) chat with a live key. The live suite covers the phrases above, not every possible wording.

Release tag: 1.3.22 (no v prefix). Publication through the authenticated GitHub CLI with size and SHA256 digest checks.
