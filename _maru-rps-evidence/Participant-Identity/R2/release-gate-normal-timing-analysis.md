# KR R2 release-gate Normal timing root-cause analysis

Date: 2026-09-05 (Asia/Shanghai)
Mode: diagnosis only; no product, migration, timing-constant, test-expectation, remote, commit, or push change was made.

## Scope and command

Repository: `/Users/vk/Documents/Codex/2026-06-02/new-chat/maru-rps-kr-ui-fieldfix`
Branch: `dev/kr-participant-identity-binding`
HEAD: `260290b381ee0ac685248b46fbbe09e4878298da`

The official entry point is `npm run test:release-gate`, defined in `package.json` as:

```text
node scripts/run-release-gate.mjs
```

`scripts/run-release-gate.mjs` forcibly sets `CEO_GATE_STRICT=1` and invokes:

```text
node_modules/vitest/vitest.mjs run tests/ceo-official-measurement.test.mjs
```

One permitted clean diagnostic invocation of that exact command was run after source inspection. It completed its assertions and reproduced the gate result: **268 / 360 timing passes (74.44%), required >= 95%**, then exited non-zero for the expected strict gate failure and separately reported the Vitest-cache EPERM described below. No second diagnostic release-gate run was made.

## Exact architecture and definition of Normal timing

The test file is `tests/ceo-official-measurement.test.mjs`; its simulation and extracted-application harness is `tests/rc3-harness-support.mjs`.

`Normal` is the `PROFILES.Normal` simulated cohort profile: optimistic simulated Realtime delivery, monotonic delivery ordering, polling enabled (default 2600 ms), host clock skew 0, non-host simulated clock skew in approximately +/-300 ms, and simulated clock-RPC RTT base 120--350 ms with configured jitter. It is not a browser test, real HTTP call, local Supabase call, or Seoul call.

Each trial uses `runEliminationTrial` with a decisive choice driver and `targetLoserCount: 2`. The harness builds an in-memory rooms/participants database and a simulated Realtime scheduler. It extracts and executes selected gameplay blocks from `index.html`. The normal release gate measures the maximum relevant-device span for these phases:

```text
countdownStart, choiceStart, choiceEnd, result, ready
```

The phase limit is `CEO_PHASE_TIMING_LIMIT_MS = 250`. A trial gets one timing pass unit only when every applicable measured phase is at or below 250 ms. Correctness is separately required to be 100%; it did not fail in this run.

### Why the denominator is exactly 360

The official source loops participant counts `N = 3..20` (18 values) and `BASELINE_TRIALS = 20` with seed:

```text
seed = N * 97000 + repetition
```

Therefore:

```text
18 participant-count scenarios x 20 deterministic repetitions = 360 Normal timing trials
```

One trial represents a full simulated cohort (host `p0`, participants `p1..p(N-1)`), not a per-device sample. The report records only the cohort maximum gap, so it cannot name which device caused an individual maximum.

## Result and failure distribution

Aggregate result:

| Metric | Value |
| --- | ---: |
| Timing pass | 268 |
| Timing fail | 92 |
| Timing rate | 74.44% |
| Required rate | 95.00% |
| Correctness failures | 0 |
| Failed trial reason | timing only |

All 92 failed trials contain at least one phase gap above 250 ms: 51 have only `result`, 28 only `ready`, and 13 have both. That is 113 violating phase observations. The standard runner reports no causal marker that distinguishes Realtime from polling for a given phase; both mechanisms are simulated and polling is enabled. There is no live network involved.

| Cause group | Failed trials / violating observations | % of 92 trials | Median delta | Max delta |
| --- | ---: | ---: | ---: | ---: |
| `result` exceeds 250 ms (includes 13 mixed trials) | 64 / 67 | 69.57% | +315 ms | +892 ms |
| `ready` exceeds 250 ms (includes 13 mixed trials) | 41 / 46 | 44.57% | +338 ms | +883 ms |
| Any timing violation | 92 / 113 | 100.00% | N/A (mixed phases) | +892 ms |

The phase groups overlap, so their trial percentages intentionally do not sum to 100%. Both transitions occur after gameplay state changes and traverse simulated delivery/render synchronization; the evidence does not support assigning either phase to polling or Realtime alone.

### Complete 92-trial failure ledger

Boundary for every entry is <=250 ms. `s` is the deterministic repetition number. Each entry gives transition, round, observed cohort span, and delta from the boundary. Role is aggregate cohort maximum (not emitted by the runner).

| N | Failed repetition(s): phase / round / observed (+delta) |
| ---: | --- |
| 3 | 5: result r2 836ms (+586) |
| 6 | 11: result r3 823ms (+573); 16: result r3 319ms (+69); 17: result r1 280ms (+30) |
| 7 | 0: result r4 937ms (+687) |
| 8 | 6: result r5 965ms (+715); ready r6 364ms (+114); 7: result r4 739ms (+489); 13: result r2 1091ms (+841); result r3 329ms (+79); 17: result r5 301ms (+51); 18: result r3 631ms (+381) |
| 9 | 1: result r3 373ms (+123); ready r4 837ms (+587); 7: result r2 377ms (+127); 16: result r2 284ms (+34); 17: result r2 323ms (+73); 18: ready r7 627ms (+377) |
| 10 | 0: ready r7 754ms (+504); 1: result r3 254ms (+4); ready r3 363ms (+113); 9: result r3 885ms (+635); 10: result r6 584ms (+334); 12: result r3 409ms (+159); 13: result r2 742ms (+492); ready r11 306ms (+56); 15: ready r5 588ms (+338) |
| 11 | 2: ready r5 955ms (+705); 3: ready r2 620ms (+370); result r4 484ms (+234); 6: result r6 962ms (+712); 8: result r3 662ms (+412); 9: result r2 340ms (+90) |
| 12 | 1: ready r4 350ms (+100); result r5 1005ms (+755); ready r5 1081ms (+831); 2: result r2 434ms (+184); 7: result r3 1027ms (+777); 10: result r2 468ms (+218); 12: result r2 565ms (+315); 14: result r4 679ms (+429); 19: ready r4 445ms (+195) |
| 13 | 6: result r6 369ms (+119); 13: result r2 507ms (+257); 19: ready r4 363ms (+113) |
| 14 | 1: result r2 444ms (+194); 4: ready r3 405ms (+155); 8: result r2 669ms (+419); 9: result r2 330ms (+80); 10: ready r6 488ms (+238); 15: ready r4 583ms (+333); 16: ready r4 526ms (+276) |
| 15 | 7: ready r3 539ms (+289); 11: ready r3 505ms (+255); 14: ready r2 592ms (+342); 17: result r3 931ms (+681) |
| 16 | 1: ready r3 405ms (+155); 2: ready r2 624ms (+374); 5: result r8 970ms (+720); 6: result r2 536ms (+286); 7: result r2 428ms (+178); 8: result r2 483ms (+233); 10: result r4 1066ms (+816); 14: result r9 695ms (+445); 15: ready r2 532ms (+282) |
| 17 | 2: result r2 275ms (+25); 3: result r7 506ms (+256); 8: ready r5 309ms (+59); 11: result r2 371ms (+121); result r3 268ms (+18); ready r4 791ms (+541); 16: ready r2 701ms (+451); 17: result r2 403ms (+153); 18: result r3 367ms (+117); 19: ready r2 749ms (+499) |
| 18 | 0: ready r5 905ms (+655); ready r6 724ms (+474); 6: ready r5 762ms (+512); 9: ready r4 395ms (+145); result r6 727ms (+477); 11: ready r4 635ms (+385); 12: result r6 538ms (+288); 13: result r4 608ms (+358); 16: result r3 1142ms (+892) |
| 19 | 3: result r6 1003ms (+753); 6: ready r2 994ms (+744); 7: result r6 536ms (+286); ready r6 695ms (+445); 8: ready r5 870ms (+620); 10: ready r4 294ms (+44); 13: result r4 573ms (+323); 14: ready r3 358ms (+108); 15: ready r4 665ms (+415); ready r5 608ms (+358); 16: result r5 346ms (+96); ready r5 1133ms (+883); ready r6 699ms (+449); 19: result r3 646ms (+396) |
| 20 | 1: ready r4 359ms (+109); 2: result r3 662ms (+412); 3: result r3 754ms (+504); ready r4 532ms (+282); 4: result r2 591ms (+341); 5: result r2 644ms (+394); result r6 878ms (+628); 7: ready r3 448ms (+198); result r7 1085ms (+835); 8: ready r2 293ms (+43); result r5 323ms (+73); ready r5 890ms (+640); 9: result r3 789ms (+539); 10: result r6 252ms (+2); 17: result r2 302ms (+52) |

Failure counts by repetition `s=0..19` are: `3, 6, 5, 4, 2, 3, 6, 7, 6, 5, 6, 4, 3, 5, 4, 4, 6, 6, 3, 4`. Failures are distributed across every deterministic repetition group, rather than isolated to one seed.

## Timing distribution

### Observable violating phase observations

| Transition | Count | Min | p50 | p75 | p90 | p95 | p99 | Max | Mean | Std. dev. |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| result | 67 | 252 | 565 | 754 | 970 | 1027 | 1091 | 1142 | 598.88 | 255.52 |
| ready | 46 | 293 | 588 | 724 | 890 | 955 | 1081 | 1133 | 601.33 | 217.44 |

These are distributions of only the 113 observations that violated the limit, not of all measured phase gaps.

### Scenario-level data emitted by the official runner

The runner retains per-round values only long enough to summarize each cell. It emits `sample count`, p50, p95, p99, and worst per N, not every passing phase observation. Consequently an exact global all-360 raw-gap minimum/p75/p90/mean/standard deviation cannot be derived from unmodified official output. The global worst is observable: 1142 ms. This is an observability limitation, not authorization to instrument or alter the runner in this task.

| N | pass / fail | emitted raw-gap samples | p50 | p95 | p99 | max |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 3 | 19 / 1 | 280 | 58 | 127 | 144 | 836 |
| 4 | 20 / 0 | 240 | 89 | 142 | 142 | 207 |
| 5 | 20 / 0 | 230 | 80 | 114 | 123 | 182 |
| 6 | 17 / 3 | 295 | 78 | 138 | 280 | 823 |
| 7 | 19 / 1 | 245 | 90 | 142 | 161 | 937 |
| 8 | 15 / 5 | 320 | 95 | 151 | 631 | 1091 |
| 9 | 15 / 5 | 335 | 93 | 144 | 373 | 837 |
| 10 | 13 / 7 | 465 | 94 | 146 | 584 | 885 |
| 11 | 15 / 5 | 355 | 104 | 135 | 620 | 962 |
| 12 | 13 / 7 | 335 | 107 | 162 | 679 | 1081 |
| 13 | 17 / 3 | 390 | 107 | 143 | 240 | 507 |
| 14 | 13 / 7 | 370 | 101 | 166 | 488 | 669 |
| 15 | 16 / 4 | 345 | 116 | 162 | 505 | 931 |
| 16 | 11 / 9 | 395 | 120 | 147 | 624 | 1066 |
| 17 | 12 / 8 | 515 | 111 | 160 | 371 | 791 |
| 18 | 13 / 7 | 475 | 106 | 173 | 724 | 1142 |
| 19 | 10 / 10 | 415 | 126 | 168 | 699 | 1133 |
| 20 | 10 / 10 | 450 | 116 | 169 | 754 | 1085 |

There is no per-role distribution in the official result: the measured value is a cohort span. The ledger and this table are the complete scenario/repetition evidence exposed without changing the harness.

## Historical baseline comparison

`c5e1e99c7ada0e6456d19960edb57fca1212c434` (2026-08-02, `test(rc3): establish release-gate measurement baseline`) introduced the CEO release-gate test. Its checked-in test comment records Normal as **269 / 360 = 74.72%**, explicitly below the same strict 95% requirement and intended to block in strict mode. That commit is contained by `release/kr-build47-score-voice-qa` as well as the current branch.

| Comparison | Historical checked-in baseline | Current diagnostic |
| --- | ---: | ---: |
| Normal timing | 269 / 360 | 268 / 360 |
| Rate | 74.72% | 74.44% |
| Required rate | 95% | 95% |
| Difference | -- | -1 trial (-0.28 percentage points) |

No tracked evidence of a previous GREEN Normal release gate was found. Machine/environment metadata for the historical static baseline is not recorded, and the harness has evolved alongside other product work. Therefore **last known GREEN commit: not proven** and **BASELINE NOT PROVEN**. What is proven is that an almost identical failure predates the identity R2 patch and was already present on the frozen release lineage.

## Identity critical-path analysis

**Verdict: B. Identity patch is not on the measured critical path.**

The participant identity implementation in `index.html` establishes guest Auth using `db.auth.getSession()` and `db.auth.signInAnonymously()`, and uses ownership data/policies in database-backed flows. The CEO harness does not implement an Auth API, does not invoke those calls, and does not connect to local Supabase. Its fake `db` implements simulated `rooms`, `participants`, and `server_now` only. The extracted measurement blocks are gameplay/room state/render blocks; they do not include guest-auth establishment or live RLS enforcement.

This verdict does not claim identity code has no product effect in a real browser. It establishes that it cannot explain the 360 simulated release-gate samples through an executed Auth, owner-lookup, RLS, local DB, or extra network path. The `release..HEAD` range also includes broader `index.html` work, so it cannot isolate every non-identity gameplay change without a separately authorized comparison run.

## RC3 versus release gate

| Dimension | RC3 | Release Gate Normal |
| --- | --- | --- |
| Entry test | `tests/rc3-multiparticipant-sim.test.mjs` | `tests/ceo-official-measurement.test.mjs` |
| Assertion result | 63 / 63 pass | 268 / 360 timing units; strict gate fails |
| Primary contract | broad multi-participant correctness, adversarial state/reconnect/polling behavior and selected timing checks | all Normal baseline cells must meet strict CEO aggregate timing rate |
| Timing ceiling | RC3’s own contracts/tolerances; not the CEO aggregate criterion | 250 ms for each applicable phase, 95% of 360 trials required |
| Sample grid | RC3 scenarios/mutations | N=3..20 x 20 deterministic repetitions |
| Profile | multiple conditions | only `Normal` for this gate metric |
| Participants | scenario-specific | full cohorts p0..p(N-1), N=3..20 |
| Clock/network | simulated harness facilities | same family of simulated facilities, with Normal’s optimistic/monotonic/polling profile |
| Aggregation | test assertions | one pass unit per all-phases-clean trial, then percentage |
| Live Auth/DB/network | no | no |

RC3 passing does not establish that the far stricter 250-ms/95%-of-360 CEO contract passes. The two suites deliberately test different contracts and aggregate differently.

## Machine/load evidence

Non-invasive evidence at diagnosis time:

| Signal | Observation |
| --- | --- |
| Host | Darwin arm64, Mac mini (`malueong-aui-Macmini.local`) |
| Load average | 2.01 / 2.12 / 2.22 |
| Memory | VM statistics showed about 236 MiB free pages, ~3.89 GiB active, ~4.04 GiB inactive, ~1.78 GiB wired; swap-out count is cumulative, not current pressure proof |
| Disk | ~205 GiB available |
| CPU/memory hardware query | sandbox denied `sysctl hw.ncpu` / `hw.memsize` |
| Process inventory | sandbox denied process-list access |
| Docker status/usage | Docker socket unavailable in sandbox |
| Simulators | simulator service unavailable in sandbox |

This means the active Maru stack, FitFlow stack, browser/IDE processes, and other heavy processes could not be enumerated non-invasively in this environment. No evidence connects host load to the timing result. More importantly, the one allowed diagnostic run reproduced the exact 268/360 aggregate and the release gate uses deterministic seeded simulation rather than wall-clock production I/O. Environment interference is therefore not the supported primary cause.

## Vitest results.json EPERM (separate issue)

`node_modules` in this worktree is a symlink:

```text
node_modules -> ../maru-rps-kr-android-qa/node_modules
```

The target and `.vite/vitest/results.json` are regular `vk:staff` paths with normal displayed POSIX modes (`drwxr-xr-x` directories, `-rw-r--r--` file); no immutable flag was displayed. However, the symlink target is outside this workspace’s writable sandbox root. Vitest follows the link when persisting `node_modules/.vite/vitest/results.json`, and that write is denied with EPERM.

**EPERM_ROOT_CAUSE = sandboxed write through the `node_modules` symlink to a target outside the writable workspace.**

Minimal safe remediation outside this diagnosis: use a project-local writable dependency/cache location, or configure Vitest’s cache/results output to a writable project/temporary directory. Do not chmod, chown, or delete the shared target merely to mask the failure. This cache-persistence issue is independent of the timing assertion: the strict timing gate had already failed.

## Classification and remediation options

**Primary classification: C. PRE-EXISTING PRODUCT TIMING DEFECT.**

Evidence: the release-gate introduction records 269/360 (74.72%) against the same 95% contract on the frozen-release lineage; the current value is one trial lower; the measured identity paths are not executed; and the failure is repeatable across deterministic seeds and many N values. This classifies the gate behavior under its existing simulated product contract. It does not prove live-device production latency because the gate is a simulation.

Contributing factors:

- delayed `result` and `ready` state/render synchronization is the only asserted failure class;
- failure increases materially at larger cohorts, while some smaller cells are clean;
- the official runner discards passing raw gap values, limiting diagnosis precision;
- cache EPERM causes process/result persistence trouble but not the timing failure.

| Option | Proposal | Likely files | Product change | Timing contract change | Scope / risk |
| --- | --- | --- | --- | --- | --- |
| A (preferred) | Narrowly diagnose and optimize the result-to-ready state/render path: avoid duplicate/deferred delivery work while preserving canonical phase ordering, CAS/state checks, Realtime and polling behavior. | `index.html`; targeted existing RC3/CEO regression tests only if behavior needs coverage | Yes | No | Small-to-medium; high care needed around host authority, reconnect, and stale-writer protections |
| B | Make phase delivery/rendering a single explicit, idempotent phase-transition pipeline with canonical timestamps/sequence handling, then retain current fallback behavior. | `index.html`, related gameplay helpers if extracted, RC3/CEO coverage | Yes | No | Medium-to-large; broader behavioral surface but more durable under cohort growth |
| C (only if later proven) | Add a non-scheduling-changing diagnostic reporter for per-trial/per-role gap records, or correct a demonstrably incorrect harness mapping. | `tests/ceo-official-measurement.test.mjs`, `scripts/run-release-gate.mjs` | No (unless a harness mapping is proven wrong) | No | Small; not currently justified as a fix and must not alter thresholds or skip samples |

Recommended next step: Option A, after a narrowly scoped follow-up diagnosis identifies the exact `result`/`ready` scheduling work responsible for the recorded spans. It must preserve the 250-ms and 95% contract. Expected change surface is product gameplay transition code plus targeted regression coverage; risk is moderate/high because it touches authoritative room-state transitions.

## Worktree and integrity

`git diff --check` is clean. The worktree already contained identity R2 modifications/untracked evidence and shared `node_modules` before this diagnosis. This analysis adds only this required evidence document; no product or database file was changed.

## Recommendation

**RELEASE GATE IS VALID — PRODUCT TIMING FIX REQUIRED**
