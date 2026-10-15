# Verification: Karkas 1.3.14

Date: 2026-10-16. User explicitly authorized testing and then this release.

Changes: task targeting from recent conversation, explicit replacement of recorded work totals, safe pending-proposal revision/cancellation/retry, and validation of timer start after an explicit reopen.

- Previous full source suite: 720 tests, 718 passed, two regressions fixed. Affected groups then passed: 43/43 strategyDiscovery and 21/21 aiTaskTimer/aiTaskUpdates. No unresolved failures. Successful unaffected tests were not repeated under AGENTS.md.
- Three additional notepad recovery edge tests passed.
- General and strict typechecks passed after the final application source changes.
- Functional browser QA: 43 scenarios passed across tasks, timers, checklists, categories, history/trash, statistics, notes, settings and AI proposals. Desktop and narrow-screen screenshots reviewed.
- Production build and Windows x64 NSIS packaging completed successfully for 1.3.14.
- Packaged archive: all 37 dist/electron files match the built workspace bytes; version 1.3.14; no .env files.
- Actual packaged executable runtime smoke: 2/2 passed in an isolated working directory without provider credentials, TCP startup or user-data mutations.
- Final installer/blockmap/update-manifest evidence is recorded in artifact-verification.json. Publication checks require committed source, remote main containing the release commit, fresh tag, exact installer name/size and SHA512, and upload integrity before making the release public.

The earlier functional/source evidence is documented in docs/AI-TIME-FIX-2026-10-16.md and docs/FUNCTIONAL-QA-2026-10-16.md. AI browser/provider tests use synthetic responses; no live Gemini, two-device cloud sync, microphone or Windows suspend/resume validation is claimed. Existing large-chunk build warning and unsigned installer status are unchanged.

Build output: release/release-1.3.14. Release tag: 1.3.14, matching existing published tag format and avoiding an independent v* CI publication.

Publication confirmed: https://github.com/Validolio11/Karkas-app-/releases/tag/1.3.14. All three uploaded assets match verified local sizes and SHA256. A final check through the application's actual resolveTrustedUpdate/verifyUpdateFile implementation accepted the public latest release and manifest as an update from 1.3.13 and matched its SHA512 to the built installer. See publication.json and public-update-verification.json. This check did not install or launch the update on the user's machine.
