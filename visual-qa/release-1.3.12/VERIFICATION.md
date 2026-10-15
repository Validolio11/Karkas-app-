# Verification: Karkas 1.3.12

Date: 2026-10-15. Base: 1.3.11 (5e3d096). Scope: repeated personal discovery questions and explicit exit to practical help.

- Full suite: 689 scenarios, 688 passed initially. One fallback fixture still described a now-valid concrete barrier; the fixture was narrowed to its original label-only purpose and an explicit direct-barrier summary regression test was added. The affected server suite then passed 36/36. Across the full run and targeted rerun, all 690 unique scenarios passed.
- General typecheck passed, including the final added test. Strict source typecheck passed.
- Production build passed. Windows x64 packaging passed.
- Packaged runtime: 2/2 passed using the actual app.asar.
- Archive verification: all 37 runtime files from dist and electron match source SHA256; only .gitignore metadata is excluded, matching electron-builder. Packaged version is 1.3.12; no .env files are included.
- Installer SHA512, update manifest and three release asset SHA256 values verified; see artifact-verification.json.
- Browser regression: desktop 1440x1000 and mobile 375x812 passed. Routine evidence survives; help and complaints leave discovery; reopen/reload preserve history and exit state. Screenshots inspected. These checks use deterministic mocked assist responses (6 requests, no live model calls); server behavior is covered separately by utility tests.

Production build retains the existing large-chunk warning. Windows package is unsigned, consistent with the preceding release. Tests and publication were explicitly authorized by the user for this release.