# KR release Normal timing fix

## Scope

- Frozen base: `30245e5104c2283de334cb5c62331989d2557aec` (`release/kr-build47-score-voice-qa`)
- Timing branch: `dev/kr-release-normal-timing-fix`
- No Identity R2, Supabase, RLS, remote, or release-criterion change was made.

## Frozen baseline

The official command `npm run test:release-gate` on the exact frozen base produced Normal **268/360 (74.44%)**, with correctness **100%**. This matches the historical approximately 269/360 failure and establishes a pre-existing product timing defect.

## Proven production path and bottleneck

`publishHostRoundResult()` commits one authoritative `result` room transition through `updateRoomStatusScheduled()`; `nextRound()` commits one authoritative `ready` transition through `updateRoomPenaltyCas()`. Each carries `phaseScheduledAt`. Realtime and polling both enter `handleRoomUpdate()`, which calls `waitForPhaseRender()` to render on that timestamp.

The host does not serially wait for every client before publishing the phase. The scaling failure was instead the 900ms delivery lead: the immutable Normal simulation can deliver a cohort member at 900–2000ms, with tail likelihood increasing by cohort size. A late member then sees an already-past `phaseScheduledAt` and renders immediately, widening the cohort gap beyond the unchanged 250ms contract.

## Correction

`PHASE_RENDER_BUFFER_MS` is now **2200ms**: the existing single authoritative scheduled timestamp receives a 200ms margin beyond the immutable 2000ms Normal Realtime tail. No per-client write, new state machine, polling interval, timeout/cap, timing threshold, simulation parameter, sample count, aggregation, or acceptance criterion changed. The behavioral effect is a fixed additional presentation lead for RESULT/READY, allowing all clients to receive the already-authoritative transition before the common render instant.

Focused source contracts were updated in `tests/build29-render-unblock.test.mjs` and `tests/build30-choice-window-sync.test.mjs`; they passed **35/35**.

## Official release-gate outcome

Final confirmation command: `npm run test:release-gate`

- Normal: **360/360 (100%)**; required threshold remains **>=95%**.
- Correctness: **100%**.
- RESULT violations: **0**.
- READY violations: **0**.
- All reported Normal cohort worst gaps were countdownStart; RESULT/READY therefore had no violating distribution. The harness does not emit per-phase non-violating percentile samples, so no invented RESULT/READY percentile is reported.
- Vitest: **98/98 passed**, **76.10s**.

| Cohort | Normal passes | Worst overall gap | RESULT/READY violations |
| --- | ---: | ---: | ---: |
| N=15 | 20/20 | 167ms | 0 / 0 |
| N=16 | 20/20 | 148ms | 0 / 0 |
| N=17 | 20/20 | 176ms | 0 / 0 |
| N=18 | 20/20 | 173ms | 0 / 0 |
| N=19 | 20/20 | 168ms | 0 / 0 |
| N=20 | 20/20 | 169ms | 0 / 0 |

## Regressions and static gates

- Full non-timing: **90 files passed; 1,511 passed, 10 skipped, 0 failed; 215.58s**.
- RC3 isolated: **1 file, 63/63 passed; 1696.21s**.
- HTML syntax: PASS.
- `git diff --check`: PASS before commit.

The worktree uses a local writable `node_modules` installed without generating a lockfile. No `results.json` EPERM occurred; test assertions and result persistence both succeeded.

## Commit

Code and focused-test commit: `a423b3f` (`fix(kr-v1): close result-ready timing release gate`).
