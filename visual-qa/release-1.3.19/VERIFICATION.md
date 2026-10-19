# Verification: Karkas 1.3.19

Date: 2026-10-19. The user explicitly authorized testing, browser checks and this release.

Change: dashboard periods День / Тиждень / Місяць / Квартал / Рік replace «Т-1…Т-4» rolling weeks; День shows worked minutes per hour reconstructed from the activity trail (start/pause, running timer, limited attempts, credited overtime); pause-at-zero and credited overtime intervals are recorded in the activity trail; server period selection accepts the new periods; the strategy audit keeps its periods.

- General and strict typechecks passed.
- Full source suite: 900/900 passed both with and without GEMINI_API_KEY (after the final source change; not repeated for the version bump).
- Browser (dev server, guest workspace seeded through the app's own workspace storage): five period buttons; axis labels День «00…22», Тиждень «Вт 13 … Пн 19», Місяць day numbers every 5th (every 10th at 375 px), Квартал week starts «22.07 … 14.10», Рік months with «жов–лис» for the oldest merged bucket; День with stopwatch sessions 09:40–10:20, 11:00–12:30, 13:05–13:50 → 20/20/60/30/45 min per hour and the completion at 12:31; tooltip text casing fixed; 375 px width without horizontal scroll.
- Production build and Windows x64 NSIS packaging for 1.3.19; latest.yml in the published format.
- Packaged archive: all 37 dist/electron files match; version 1.3.19; no .env files; the local test key string is absent.
- Packaged executable runtime smoke: 2/2 passed without a key; file version 1.3.19.

Not verified: «Аналіз часу AI» for the new periods with a live key in the browser (covered by server tests only); old sessions without trail events show zero by design.

Release tag: 1.3.19 (no v prefix). Publication through the authenticated GitHub CLI with size and SHA256 digest checks.
