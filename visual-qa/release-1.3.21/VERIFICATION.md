# Verification: Karkas 1.3.21

Date: 2026-10-19. The user explicitly authorized the fix, its tests and this release.

Change: agent replies no longer repeat the applied action summaries that the app lists under them (lines restating a summary are removed regardless of markdown, list markers, quotes and dash styles; an emptied reply becomes «Готово.» or «Ось розклад:» for day plans); the agent instruction asks for a brief answer in its own words.

- General and strict typechecks passed.
- Full source suite: 919/919 passed both with and without GEMINI_API_KEY (after the final source change; not repeated for the version bump). Two new tests cover the filter and an agent turn that only copies summaries; five existing agent tests were updated to assert summaries in the action list instead of the reply text.
- Live agent (dev server API, real Gemini): «Коригуй час, бо я не встигаю» → replan with the overflow question only, no repeated schedule lines; «збільш тривалість навчання друку до години» → «Збільшив тривалість таймера для «Навчання друку» до 1 години.» with the summary only in the action list; an evening plan with an already passed start asks a clarification.
- Production build and Windows x64 NSIS packaging for 1.3.21; latest.yml in the published format.
- Packaged archive: all 37 dist/electron files match; version 1.3.21; no .env files; the local test key string is absent.
- Packaged executable runtime smoke: 2/2 passed without a key; file version 1.3.21.

Not verified: desktop (Electron) chat with a live key.

Release tag: 1.3.21 (no v prefix). Publication through the authenticated GitHub CLI with size and SHA256 digest checks.

Publication confirmed: https://github.com/Validolio11/Karkas-app-/releases/tag/1.3.21 (tag 1.3.21 at the release commit, marked latest). All three assets match local sizes and SHA256 digests. The application's resolveTrustedUpdate/verifyUpdateFile accepted the public release and manifest as an update from 1.3.20 and matched the installer SHA512 (publication.json, public-update-verification.json). The update was not installed on the user's machine.
