# Verification: Karkas 1.3.15

Date: 2026-10-19. The user explicitly authorized testing, then this release.

Change: limited start on the "Next step" card (5/15/25-minute ceiling, permission to stop, attempt credited from one minute, continuation, 7-day summary), with sync/validation support and neutral AI context.

- General and strict typechecks passed.
- Full source suite: 740/740 passed (one bundle test first failed only because dist/server.cjs had not been built; passed after `npm run build`).
- Functional browser QA on the dev server (guest workspace): 5-minute ceiling selection, running attempt state, stop under one minute (not credited, time banked), stop after 70 s (credited `attempt` event, no extra pause event, previous stopwatch restored), "5 more min" continuation reaching the ceiling (calm notice, 7-day summary 1 attempt · 6 min), dismiss, and 375 px width without horizontal scroll.
- Version bump and release notes only after QA; no application source changed since, so the suites were not repeated under AGENTS.md.
- Production build and Windows x64 NSIS packaging completed for 1.3.15 (release/release-1.3.15). latest.yml written in the published 1.3.14 format.
- Packaged archive: all 37 dist/electron files match the built workspace bytes; version 1.3.15; no .env files (artifact-verification.json).
- Packaged executable runtime smoke: 2/2 passed in an isolated working directory; file version 1.3.15.

Not verified: the Windows notification for an attempt in the packaged app, live Gemini, two-device cloud sync. Unsigned installer and large-chunk build warning are unchanged.

Release tag: 1.3.15 (published tag format without the v prefix, avoiding an independent CI publication).

Publication confirmed: https://github.com/Validolio11/Karkas-app-/releases/tag/1.3.15 (tag 1.3.15 at the release commit, marked latest). publish.ps1 stopped before any API call: Windows PowerShell 5.1 sent a malformed `git credential fill` request. The same checks were done with the authenticated GitHub CLI instead: a draft release from the pushed commit, upload of the three assets, size and SHA256 digest match with local files, then publication. A check through the application's resolveTrustedUpdate/verifyUpdateFile accepted the public release and manifest as an update from 1.3.14 and matched the installer SHA512. See publication.json and public-update-verification.json. The update was not installed on the user's machine.
