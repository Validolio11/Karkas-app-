# Verification: Karkas 1.3.13

Date: 2026-10-15. Base: 1.3.12 (9c4d345).

Fix: a successful AI proposal now records its requesting account before Apply becomes ready. The existing owner, hydration, cancellation and one-time confirmation guards remain in place. Previously the owner was always undefined, so confirmation silently returned.

- Full test suite: 690/690 passed.
- General and strict typechecks passed.
- Production build and Windows x64 packaging passed.
- Actual packaged runtime tests: 2/2 passed.
- Archive check: 37 runtime files match SHA256, packaged version is 1.3.13, no .env files. Git metadata .gitignore is excluded by electron-builder.
- Installer SHA512, latest.yml and all three asset hashes verified; see artifact-verification.json.
- Browser regression passed at desktop 1440x1000 and mobile 375x812: proposal awaits explicit confirmation, Apply creates exactly one task, three immediate clicks create no duplicates, applied state/task survive close/reopen and reload. No uncaught browser errors; screenshots inspected.
- Browser checks use the production UI with deterministic assist mocks and a guest workspace. No live model calls, Firebase login or cloud writes. Cross-account cancellation and owner guards were reviewed statically.

Existing large-chunk build warning and unsigned Windows packaging remain. Tests and publication were explicitly authorized for this release.