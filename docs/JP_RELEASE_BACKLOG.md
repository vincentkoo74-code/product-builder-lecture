# MARU RPS V1.0_JP — Release Backlog

일본판 출시까지 남은 미해결 항목 추적표. baseline/안전화 단계(2026-08-27)에서
발견했거나 의도적으로 이월한 항목만 기재한다. 완료 항목은 지우지 않고 상태만 바꾼다.

상태: `OPEN` / `IN PROGRESS` / `DONE` / `WONTFIX`

| ID | 상태 | 심각도 | 항목 | 출시 차단 |
|---|---|---|---|---|
| JP-BL-013 | DONE | **Blocker** | JP 백엔드 확보 → **기존 Tokyo 복원(Option A′), ACTIVE_HEALTHY** | — |
| JP-BL-001 | OPEN | High | region-guard 메커니즘을 KR 브랜치로 백포트 | 아니오 (KR 측 위험) |
| JP-BL-002 | DONE | High | JP 빌드에서 Kakao 인증 표면 제거 — 시장 계층 경계. KR 공개 키가 source/dist 에서 사라짐(JPX-001 범위 축소) | — |
| JP-BL-003 | DONE | High | JP 브랜치를 origin 에 push → 539e0de | — |
| JP-BL-004 | DONE | High | GitHub Environments `supabase-KR`/`supabase-JP` 구성 | — |
| JP-BL-005 | OPEN | High | 서버측 매치메이킹 리전 검증 (KR↔JP 크로스매칭 차단) | **예** |
| JP-BL-006 | OPEN | Medium | 네이티브 산출물(ios/android public) JP 재생성 — CEO 지시로 보류 중 | **예** |
| JP-BL-007 | DONE | Medium | Tokyo 백엔드 실물 점검 → **삭제 아님, INACTIVE(일시정지)** | — |
| JP-BL-008 | OPEN | Medium | LINE MINI App / LIFF 요구사항 조사 및 설계 | **예** |
| JP-BL-009 | OPEN | Medium | `ENABLE_LINE_LOGIN` 활성화 + 관련 테스트 잠금 해제 | **예** |
| JP-BL-010 | DONE | Medium | region-guard 를 release gate 에 연결 (출시 모드) | — |
| JP-BL-011 | DONE | Medium | `~/.rps_tokyo_env`(Tokyo 전용) / `~/.rps_seoul_env`(Seoul 전용) 분리 완료. 교차 ref 0건, 0600, 백업 보존 | — |
| JP-REGION-ISOLATION-001 | OPEN | **High** | `feature/rps-kr-seoul-backend` 와 `main` 의 실행 상수가 Tokyo ref — **KR 소유, JP 프로젝트가 고치지 않는다** | 아니오(KR 측) |
| JP-ENTRY-INVITE-002 | DONE | **High** | 보류 초대(pending invite) 도입 — 초대는 신원 확립까지 보류되고 URL 에 남는다. 브라우저 E2E 15/15 로 실증(1라운드 진행 포함) | — |
| JP-TOKYO-REALTIME-001 | DONE | **High** | 실제 Tokyo Realtime 두 클라이언트 검증 — A~H 전 시나리오 REALTIME 도달, 3라운드 완주, 과거 데이터 무변경 | — |
| JP-CORE-DEFERRED-LEAVE-TIMING | OPEN | Medium | 결과 화면에서 누른 퇴장이 **한 라운드 더** 지연 실행된다(WRPS-084 설계). 1:1 대전에서 체감 큼 — **CORE, KR 공용** | 아니오 |
| JP-RT-PRESUBSCRIBE-GAP | OPEN | Medium | 채널 구독 완료 **이전** 커밋 변경은 Realtime 이 재생하지 않는다 → 폴링이 안전망. 전송 특성(R1), 클라이언트 처리 사항 | 아니오 |
| JP-E2E-JWT-FIDELITY | DONE | **High** | 브라우저 게이트가 실제 JWT 검증 + 목표 GRANT/RLS 아래에서 돈다. 로컬 서명 토큰 치환(벗기기 폐기), 부정 경로·소유자 RLS·교차 차단 실증 | — |
| JP-MIG-REPLICA-IDENTITY | DONE | **High** | Realtime publication 마이그레이션이 REPLICA IDENTITY 를 고정하지 않아 저장소만으로 세운 백엔드가 Tokyo(FULL)와 달라졌다 → 필터된 DELETE 이벤트 유실. 마이그레이션에서 수정(Tokyo 는 이미 FULL, no-op) | — |
| JP-I18N-JOIN-DEFAULT | DONE | Medium | 기본 표시명을 시장 계층으로 옮김 — JP=`ゲスト`. 키 없는 시장(KR)은 기존 공용 기본값 유지(KR 무변경) | — |
| JP-TOKYO-SECURITY-MIGRATION-GATE | DONE | **High** | 보안 5종 Tokyo 배포 완료(2026-09-01). 원장 7행, 애플리케이션 데이터 무변경, 배포 후 Realtime·인가 전 검증 통과 | — |
| JP-LEDGER-LEGACY-3 | DEFER | Low | 원장에 없는 legacy 3종(baseline·server_now·leave_after_round) — CEO 지시로 이번 슬라이스에서 다루지 않음 | 아니오 |
| JP-BL-012 | OPEN | Low | JP 앱 식별자·딥링크 스킴 분리 검토 | 미정 |
| JP-BL-014 | DONE | Medium | A5 device-matrix 타임아웃 → **Tokyo 복원으로 해소, 통과 확인** | — |
| JP-BL-015 | RE-VERIFIED | **High** | 로컬 clean bootstrap 실증 완료. **보안 5종은 여전히 Tokyo 미적용**(별도 게이트) | **예** |
| JP-TOKYO-MIG-INVITE-001 | DONE | **High** | `rooms.invite_token` 격리 배포 완료(2026-08-31). 보안 5종 미적용 유지, 원장 2행 | — |
| JP-H1A-STRICT-CALIBRATION | OPEN | Medium | strict 권위 모드의 mutation 민감도 임계값 재보정(11 vs 12, 399.0 vs 400.7). **이번 슬라이스에서 건드리지 않았다** | 아니오 |
| JP-INFRA-STALE-ROOM | OPEN | Medium | 물리적 stale row 정리(cron/TTL) — 별도 인프라 태스크. 도전 유효성 판정과 분리됨 | 아니오 |
| JP-BL-016 | DECIDED | High | free plan 은 엔지니어링 기간 유지, 외부 베타 전 Pro 승격 (JP-PROD-GATE) | **예** |
| JP-BL-017 | OPEN | Medium | `SUPABASE_DB_PASSWORD` 리전별 분리 | 아니오 |
| JP-BL-018 | DESIGNED | **High** | 목표 RLS 설계 완료 — 배포 미승인 | **예** |
| JP-BL-025 | OPEN | Medium | `rooms.status` enum 제약 — 전수 증명 방법 확정 후 적용 | 아니오 |
| JP-BL-026 | OPEN | Low | `created_at` NOT NULL 제약 추가 여부 | 아니오 |
| JP-BL-027 | DONE | **High** | RLS 무음 거부 — 9개 write 에 인라인 검증 적용, 행위 테스트로 실증 | — |
| JP-BL-027-B | DONE | **High** | `nextRound` W1~W4 카디널리티 검증(CORE). W1 은 권위 조회 집합 대조로 **부분 write** 까지 탐지. strict 0행 오류 0건 | — |
| JP-BL-027-D | DONE | **High** | strict = **권위·릴리스 게이팅 모드**로 전환. legacy = 과거 참조 전용(비권위, 삭제하지 않음) | — |
| JP-BL-027-C | PARTIAL | **High** | rc3 하니스에 participants realtime 전파 모델링 (전파·가드 구현 완료, strict RED — R1 미해소) | 아니오 |
| JP-BL-027-C-R1 | DONE | **High** | 시뮬레이터가 REAL `fetchParticipants` 의 host 권위 경로를 우회 — host 역할 전환·자동 시작 배선 완료, strict 하드게이트 90→44 | — |
| JP-BL-027-C-R1b | PARTIAL | **High** | 두 발행 트리거 매핑·Trigger A 구현·선택 제출 게이트 보정 완료. Trigger A 배선은 H1-a 미해소로 보류 | 아니오 |
| JP-BL-027-C-H1a | OPEN | **High** | **선택 제출 지연 모델 부재** — 하니스는 선택창 개시 즉시 전원이 동시 제출. 상수가 프로덕션·기존 rc3 모델 어디에도 없어 CEO 판단 필요 | **예** |
| JP-BL-027-C-H1b | OPEN | Medium | N×M participants 이벤트 팬아웃(발행 시 참가자별 개별 update) — strict 타임아웃 7건의 후보 원인, 미검증 | 아니오 |
| JP-BL-027-C-R2 | OPEN | Medium | 트라이얼 종료 시 participants 배달 drain 미보장 (관측 과소 카운트 방향) | 아니오 |
| JP-BL-027-C-R3 | OPEN | Low | 폴링 경로에서 재조회 보류(pending) 유실 — 프로덕션은 항상 재예약 | 아니오 |
| JP-REALTIME-VALIDATION | OPEN | **High** | 실제 Realtime 이벤트 전달 미검증 | **예** |
| JP-PROD-GATE | OPEN | **Blocker** | 외부 베타/출시 전 JP 백엔드가 미사용 자동 일시정지 대상이면 안 됨 | **예** |
| JP-BL-020 | DESIGNED | **High** | GRANT 최소 권한 정규화 설계 완료 — 배포 미승인 | **예** |
| JP-BL-021 | DESIGNED | Medium | 원장 복구 전략 확정(멱등 재실행) — 배포 미승인 | **예** |
| JP-BL-022 | DESIGNED | Medium | `participants.room_id` 인덱스 마이그레이션 작성 완료 | 아니오 |
| JP-BL-023 | OPEN | Low | Storage 버킷 `rps-app`(public, 미사용) 처리 결정 | 아니오 |
| JP-BL-024 | OPEN | Medium | Tokyo 의 Kakao 네이티브 provider 비활성화 검토 (일본은 Kakao 미사용) | 미정 |
| JP-BL-019 | WONTFIX | Low | `linked-project.json` 히스토리 잔존 — 실제 자격증명 아님, 재작성 불필요 | — |

---

## JP-BL-013 — JP 백엔드 확보 (BLOCKER)

**왜.** 일본 전략의 전제였던 "기존 Tokyo 리전 유지"가 성립하지 않는다 (JP-BL-007).
이 항목이 해결되기 전에는 실행 가능한 일본 빌드를 만들 수 없고, LINE MINI App
작업(JP-BL-008/009)도 붙일 백엔드가 없다.

**CEO 결정 사항 — 엔지니어링이 아니라 사업 판단이다.**

⚠️ **CEO 의 Option A 승인은 "구 프로젝트가 삭제되었다"는 전제 위에서 내려졌다.
그 전제가 틀렸으므로 재확인이 필요하다.** 이제 A′ 선택지가 존재한다.

| 선택지 | 내용 | 고려사항 |
|---|---|---|
| **A′** | 일시정지된 기존 Tokyo 프로젝트를 **복원(restore)** | 기존 일본 사용자 데이터가 살아 있을 가능성. 새 ref 발급 불필요(문서/설정 변경 최소). 단 복원 가능 여부·데이터 잔존은 **미확인**. 프로젝트명이 `vincentkoo74-code's Project` 로 방치되어 있어 정리 필요 |
| A | Tokyo(`ap-northeast-1`)에 **새 Supabase 프로젝트 신규 생성** | 깨끗한 출발, 명명 규칙 확립. 기존 일본 데이터 포기. free plan org 에 프로젝트가 늘어나 과금 영향 **미확인** |
| B | 다른 리전에 JP 프로젝트 생성 | 일본 개인정보 취급 방침·법적 문구와 충돌 가능. 권장하지 않음 |
| C | Seoul 프로젝트에 리전 분리 스키마로 통합 | **KR↔JP 크로스매칭 금지 hard requirement 와 정면 충돌.** 권장하지 않음 |

**A 선택 시 해야 할 일.**
1. Tokyo 리전에 새 Supabase 프로젝트 생성
2. `supabase/migrations/` 4종을 새 프로젝트에 적용 (`supabase-deploy.yml` 을 `region: JP` 로 실행)
3. `config/regions.json` 의 JP `supabase_project_ref` 와 `supabase_anon_key_fingerprint` 갱신
4. `index.html` 의 `SUPABASE_URL`/`SUPABASE_ANON_KEY` 를 새 값으로 교체
5. Auth provider(Apple, 이후 LINE) 재설정
6. `npm run guard:region` PASS 및 A5 device-matrix 테스트 복구 확인

**확인 필요.** 기존 일본 사용자 데이터가 어딘가에 백업되어 있는지, 프로젝트가
언제·왜 사라졌는지는 이 조사로 알 수 없다. Supabase 대시보드/청구 기록 확인이 필요하다.

## JP-BL-001 — region-guard 를 KR 브랜치로 백포트

**왜.** 가드가 JP 브랜치에만 있다. KR 브랜치는 여전히 Seoul/Tokyo 혼입을 코드로 막지 못한다.
**어떻게.** `docs/KR_JP_CONFIG_SEPARATION.md` 7절 절차.
**주의.** KR 브랜치는 출시 안정화 중이므로 착수 시점은 CEO 판단.

## JP-BL-002 — JP 빌드에서 Kakao 로그인 경로 제거

**왜.** KR HEAD 분기로 KR 전용 Kakao 공개 REST 키가 JP 빌드에 상속됐다. 일본은 Kakao 를 쓰지 않는다.
현재 `config/active-region.json` 의 `JPX-001` 예외로 유예 중이며 `blocks_release: true` 다.
**어떻게.** Kakao 버튼에 id 부여 → `ENABLE_KAKAO_LOGIN` 게이트 추가 → JP 에서 false →
`KAKAO_REST_API_KEY` 상수를 JP 소스에서 제거 → `JPX-001` 예외 삭제.
**검증.** `npm run guard:region` 이 WAIVED 없이 PASS.

## JP-BL-003 — JP 브랜치 origin push

**왜.** `feature/rps-jp-line-miniapp` 는 로컬 전용이다. 머신 사고 시 baseline 작업 전부 유실.
같은 위험이 KR 의 `feature/rps-kr-seoul-backend` 에도 있다(그쪽도 로컬 전용).
**주의.** push 는 외부 공개 행위이므로 CEO 승인 후 수행.

## JP-BL-004 — GitHub Environments required reviewers

**왜.** `supabase-deploy.yml` 이 `environment: supabase-<REGION>` 을 선언하지만,
GitHub 에서 해당 environment 에 protection rule 을 걸지 않으면 **승인 게이트가 실제로는 없다.**
워크플로만으로는 완결되지 않는 항목이다.
**어떻게.** Settings > Environments > `supabase-KR`, `supabase-JP` 생성 후 required reviewers 지정.

## JP-BL-005 — 서버측 매치메이킹 리전 검증

**왜.** KR↔JP 크로스매칭 금지는 사업 hard requirement 인데, 현재는 "서로 다른 Supabase
프로젝트를 본다"는 사실에만 의존한다. 클라이언트가 타국 백엔드를 가리키도록 조작되면 막을 게 없다.
region-guard 는 빌드 산출물의 정적 검사일 뿐 런타임을 막지 못한다.
**어떻게.** rooms/participants 에 리전 컬럼 + RLS 로 강제. `docs/SEOUL_KR_V1_SECURITY_RISK_REGISTER.md`
의 V2 보안 백로그와 함께 설계.

## JP-BL-006 — 네이티브 산출물 JP 재생성

**왜.** `ios/App/App/public/`, `android/app/src/main/assets/public/` 이 KR Build37 산출물이다.
이 상태로 Xcode 빌드하면 **일본 앱이 Seoul 백엔드를 가리킨다.**
현재 `npm run guard:region` 이 이 상태를 R1/R2/R3/R6 로 정확히 FAIL 시키고 있다(의도된 동작).
**어떻게.** `npm run build:web && npx cap sync` 후 가드 재실행.
**주의.** 반대 방향도 성립한다 — KR 브랜치로 돌아가 빌드할 때도 반드시 재생성할 것.

## JP-BL-007 — Tokyo 백엔드 실물 상태 점검 — **DONE (2026-08-27)**

**결과 정정: 프로젝트는 존재한다. 상태가 `INACTIVE`(일시정지)다.**

최초에 DNS/HTTP 관측만으로 "삭제"로 판단했으나, Supabase Management API 조회 결과
프로젝트가 남아 있음이 확인됐다. free plan 은 미사용 프로젝트를 자동 일시정지하며
일시정지 시 DNS 가 내려간다 — NXDOMAIN 은 삭제가 아니라 일시정지의 증상이었다.

```text
cmfxhehpreanijwanwrr | ap-northeast-1 | INACTIVE | created 2026-05-16
org wlhfocgtfvkewjxlyzmj (plan=free) / owner vincentkoo74-code
```

아래는 최초 관측 기록(사실 자체는 정확했고, 원인 추론만 틀렸다).

증적(읽기 전용 조회만 수행):

```text
dig @1.1.1.1 cmfxhehpreanijwanwrr.supabase.co → NXDOMAIN
dig @8.8.8.8 cmfxhehpreanijwanwrr.supabase.co → NXDOMAIN
dig @9.9.9.9 cmfxhehpreanijwanwrr.supabase.co → NXDOMAIN
curl https://cmfxhehpreanijwanwrr.supabase.co/auth/v1/health → 연결 실패(rc=35, TLS)
  ↑ 존재하지 않는 임의 ref 와 동일 거동

대조군 sannrfmhevebqgfdqcps (Seoul) → 3개 리졸버 NOERROR, health 401, functions OPTIONS 200
```

Edge Function 3종과 Auth provider 설정은 프로젝트와 함께 사라졌다.
저장소의 `supabase/functions/line-auth/` 소스만 남아 있다.
후속은 JP-BL-013.

## JP-BL-008 — LINE MINI App / LIFF 조사·설계

**왜.** repo 내 `liff` 키워드 0건. 보존된 `line-auth` 는 **네이티브 앱용 OAuth** 로,
LIFF 브라우저 내 MINI App 에서는 그대로 재사용할 수 없다.
"line-auth 가 있으니 절반 끝났다"는 판단은 틀리다.
**확인할 것.** LINE Channel `2010213585` 가 Login 채널인지 MINI App 채널인지 /
LIFF access token 서버 검증 경로 / 기존 `line-auth` 재사용 가능 범위 /
friend·share flow / Official Account·Sticker 연계.

## JP-BL-009 — LINE 로그인 활성화

**왜.** 현재 `ENABLE_LINE_LOGIN = false` 이며 `tests/build35-layout-contract.test.mjs` 와
`tests/jp-region-isolation.test.mjs` 가 이 값을 잠그고 있다.
**어떻게.** JP-BL-008 설계 확정 후 플래그 활성화 + 두 테스트의 단언을 리전 조건부로 변경.

## JP-BL-010 — region-guard 를 release gate 에 연결

**왜.** 현재 가드는 `build:web` 과 `npm test` 에서만 돈다. 공식 릴리즈 판정 경로
(`npm run test:release-gate`) 에는 연결되어 있지 않다.
**주의.** release gate 는 기존에 이미 FAIL 상태(BUILD33 기록)이므로 그 원인과 분리해 다룰 것.

## JP-BL-011 — `~/.rps_seoul_env` 정리

**왜.** 파일명은 seoul 인데 내용은 `RPS_TOKYO_DB_*` 변수다. 사람이 잘못 읽기 쉽다.
**주의.** 저장소 밖 로컬 파일. 값은 확인하지 않았고 이번 단계에서 변경하지 않았다.

## JP-BL-012 — JP 앱 식별자·딥링크 분리 검토

**왜.** 현재 KR/JP 가 `com.maru.rps` appId 와 `com.maru.rps://oauth` 딥링크 스킴을 공유한다.
국가별 독립 앱으로 스토어에 올린다면 충돌한다. MINI App 우선 전략에서는 우선순위가 낮을 수 있어
**미정** 으로 둔다 — JP-BL-008 결과에 따라 판단.


## JP-BL-014 — A5 device-matrix 테스트 타임아웃

**증상.** JP 브랜치에서 `tests/build37-a5-home-device-matrix.test.mjs` 가 600초 hook
타임아웃으로 FAIL 한다 (16 tests skipped). 나머지 70개 테스트 파일 1232 테스트는 PASS.

**원인.** 코드 회귀가 아니다. 이 테스트는 headless Chrome 으로 `index.html` 을 렌더해
레이아웃을 실측하는데, Supabase 클라이언트가 존재하지 않는 Tokyo 엔드포인트로 연결을
시도해 페이지가 idle 에 도달하지 못한다.

**증적.** 동일 커밋 262ef5d 의 KR HEAD 워크트리에서 같은 테스트가 73.25초에 16/16 PASS.
JP 브랜치에서는 600.46초 타임아웃. 차이는 `SUPABASE_URL` 뿐이다.

**해소.** JP-BL-013 으로 실제 JP 백엔드가 생기면 자동 해소될 것으로 예상한다.
**테스트를 수정해 green 을 만들지 않는다** — 죽은 백엔드를 가리게 된다.


## JP-BL-015 — JP 통합 마이그레이션 3종 작성

**왜.** 현 JP 브랜치의 마이그레이션 4종은 **증분 세트**라 신규 프로젝트에 적용하면 실패한다.
`rooms`/`participants` 의 CREATE TABLE 이 어디에도 없다(대시보드에서 out-of-band 생성됨).
상세와 부품 출처는 `docs/JP_BACKEND_REBUILD_INVENTORY.md`.

**주의.** Seoul 의 `20260811010100_kr_v1_account_game_stats.sql` 에는 GRANT 가 없다.
그대로 베끼면 Seoul 이 3개월간 겪은 42501 버그("내 기록이 항상 비어 있음")를 JP 가 반복한다.

## JP-BL-016 — free plan 자동 일시정지 대책

**왜.** 이번 사고의 근본 원인이다. 인프라 장애가 아니라 요금제 정책이다.
새 JP 프로젝트를 만들어도 출시 전 미사용 기간이 길면 **똑같이 다시 일시정지된다.**
KR(`maru-rps-production-kr`)은 현재 활성이지만 동일 org·동일 free plan 이므로 같은 위험에 있다.

**확인할 것.** JP 프로덕션 경계에 유료 플랜이 필요한 시점, org 분리 필요 여부,
free plan 에서 활성 프로젝트 2개 초과 시 과금 발생 조건.

## JP-BL-017 — `SUPABASE_DB_PASSWORD` 리전별 분리

**왜.** `supabase-deploy.yml` 이 `region` 입력으로 대상을 고르지만 DB 비밀번호는 단일
repository secret 을 쓴다. KR/JP 비밀번호가 다르면 한쪽 배포가 실패한다.
**어떻게.** GitHub Environment secret(`supabase-KR`/`supabase-JP` 별로 각각) 로 옮긴다.

## JP-BL-018 — allow-all RLS 승계 여부 결정

**왜.** `rooms`/`participants` 의 `USING(true) WITH CHECK(true)` 정책은 필터 없는 REST
DELETE/UPDATE 로 테이블 전체 파괴가 가능한 상태를 막지 못한다. Tokyo/Seoul 양쪽에
동일하게 존재하던 기존 노출이며 V1 KR 은 CEO 승인 하에 임시 유지로 결정됐다.
**JP 는 백지에서 시작하므로 같은 부채를 승계할지 다시 선택할 수 있다.** JP-BL-005 와 함께 판단.


## JP-BL-019 — `supabase/.temp/linked-project.json` 과거 커밋 잔존

**왜.** `539e0de` 는 추적을 해제했을 뿐 과거 커밋(`465587c`)에 남은 내용은 그대로다.
내용은 조직 slug / 프로젝트명 수준이며 access token·DB 비밀번호 같은 자격증명은 아니다.
저장소가 PUBLIC 이므로 이미 노출된 상태다.
**판정: WONTFIX (2026-08-27, CEO 정책 §16).**
히스토리 전수 스캔 결과 실제 자격증명은 없다.

```text
sbp_ PAT            : 0건
service_role JWT    : 0건 (고유 JWT 2개 전부 role=anon)
DB 비밀번호 리터럴  : 0건 (매치 2건은 ${{ secrets.SUPABASE_DB_PASSWORD }} 표현식)
.p8 / private key   : 0건
```

project ref 와 공개 URL 만으로는 히스토리 재작성을 정당화하지 않는다는 CEO 정책에 따라 종결한다.

---

# codex-critic 검증 이력

## 2026-08-27 — Baseline & Safety (539e0de) 검증

| 심각도 | ID | 내용 | 처리 |
|---|---|---|---|
| HIGH | H1 | CLI 진입점이 공백/한글/심볼릭링크 경로에서 아무 검사 없이 exit 0 (fail-open) | **수정 완료** |
| HIGH | H2 | `index.html` 외 배포 자산(main.js, oauth-bridge.html, ASSETS/**)이 스캔 범위 밖 | **수정 완료** |
| MEDIUM | M1 | `readConst` 가 주석 처리된 옛 선언을 값으로 오인 | **수정 완료** (행 주석 → 재검토 후 블록 주석까지 확대) |
| MEDIUM | M2 | 스캔 0건을 통과로 취급 (fail-open) | **수정 완료 (R7)** |
| MEDIUM | M3 | 유예가 `identifier` 만으로 매칭돼 `owner_region` 무시 | **수정 완료** |
| MEDIUM | M4 | `blocks_release` 가 코드에서 참조되지 않는 장식 필드 | **수정 완료** (`--release` + release-gate 연결) |
| MEDIUM | M5 | `index.html` 의 낡은 V1.0_KR 주석이 LINE 활성화를 지시 | **수정 완료** |
| LOW | L1 | `new URL(".", root).pathname` 이 공백 경로에서 빌드 크래시 | **수정 완료** |
| LOW | L2 | `linked-project.json` 히스토리 잔존 | **JP-BL-019 등록** |
| LOW | L3 | 짧은 숫자 식별자 substring 오탐 가능성 (KR 백포트 시) | **설계 문서 한계 항목에 기록** |
| LOW | L4 | GitHub Environment 실제 설정 여부 미확인 | **구성 완료 — 검증됨** |

수정 중 추가 발견: H1 의 최초 수정(퍼센트 인코딩만 처리)은 macOS `/var → /private/var`
심볼릭 링크 경로에서 여전히 재현됐다. 회귀 테스트가 이를 잡아냈고 `realpathSync` 로 보강했다.


## 2026-08-27 — 수정본(17b5673) 재검토

H1·H2(HIGH) 포함 8개 항목 재현 검증 후 해소 확인. codex-critic 이 구 코드에서
회귀 테스트가 실제로 실패함까지 별도 확인했다. 재검토 중 **새 MEDIUM 잔존 갭 2건**이
추가로 발견되어 같은 세션에서 처리했다.

| 잔존 갭 | 내용 | 처리 |
|---|---|---|
| M1-r | 블록 주석 `/* */` 안에 **유일하게 하나** 남은 선언은 매치 1개라 모호성 검사를 통과, 죽은 값을 정답으로 오인 | `stripComments` 가 블록 주석까지 제거. 선언 0개 → R1/R2 위반. 회귀 테스트 3건 추가 |
| M4-r | `--release` / `MARU_RELEASE_BUILD=1` 이 저장소 어디에서도 호출되지 않아 사람이 기억해야만 동작 | `release-gate.yml` 에 `Region guard (release mode)` 단계 추가 + `DEPLOYMENT.md` 출시 절차 명시. 회귀 테스트 2건 추가 → **JP-BL-010 완료** |

재검토에서 조치 불필요로 판정된 항목:
- 심볼릭 링크 순환 시 `walkFiles` 는 OS 의 ELOOP 한도에서 자연 종료(무한루프·크래시 없음, 수십 ms). 기록만.
- GitHub Environment 설정은 저장소 파일로 독립 검증이 불가능하다(critic 관점에서 "미확인").
  구성 결과는 `gh api` 로 확인했고 `JP_V1_BASELINE.md` 5절에 기록했다.

테스트: `tests/jp-region-isolation.test.mjs` 24 → 43 → **48개**.


## JP-BL-020 — Tokyo GRANT 정리

**왜.** 라이브 캡처 결과 `anon`·`authenticated`·`service_role` 이 `rooms`/`participants`/
`user_game_stats`/`user_game_history` **네 테이블 모두**에 대해
`DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE` 를 갖는다.
대시보드 생성 기본 권한이 그대로 남은 것으로 보인다.

**TRUNCATE 는 RLS 를 우회한다.** PostgREST 가 TRUNCATE 를 노출하지 않아 현재 실질 공격
경로는 없지만, Seoul 마이그레이션이 의도적으로 회수한 바로 그 권한이다.
JP-BL-018(RLS 설계)과 함께 다뤄야 한다. 증적: `docs/JP_TOKYO_LIVE_AUDIT_2026-08-27.md` 3절.

## JP-BL-021 — 마이그레이션 원장 불일치 복구

**왜.** `supabase_migrations.schema_migrations` 에는 `20260528205753` 하나만 기록돼 있는데
`server_now()` 와 `participants.leave_after_round` 는 라이브에 존재한다. 두 마이그레이션이
대시보드에서 out-of-band 로 적용됐다는 뜻이다. `rooms`/`participants` 는 아예 CREATE 기록이 없다.

**영향.** 지금 `supabase db push --linked` 를 Tokyo 에 실행하면
`20260824021500_account_game_stats_grants` 가 anon 권한 단언에서 **예외로 중단된다**
(라이브 확인: `has_table_privilege('anon','public.user_game_stats','select') = true`).
JP 통합 마이그레이션은 이 원장 상태를 전제로 설계해야 한다.

## JP-BL-022 — `participants.room_id` 인덱스

**왜.** 라이브 인덱스는 PK 4개가 전부다. 모든 방 조회가 `participants.room_id` 로 조인하는데
인덱스가 없다. 현재 규모(543행)에서는 무해하나 확장 시 병목이 된다.

## JP-BL-023 — Storage 버킷 `rps-app`

**왜.** public 버킷이 존재하지만 객체 1개(0 bytes)뿐이고 클라이언트 코드 참조가 0건이다.
사용하지 않는 public 버킷은 정리하거나 private 으로 바꾸는 편이 낫다. 급하지 않다.

## JP-BL-024 — Kakao 네이티브 provider

**왜.** Tokyo 에 Supabase **네이티브 Kakao provider** 가 활성화되어 있고 자격증명도 설정돼 있다
(`kakao-auth` Edge Function 과 별개). 일본판은 Kakao 를 쓰지 않으므로 비활성 검토 대상이다.
JP-BL-002(클라이언트 Kakao 경로 제거)와 함께 판단.


## JP-BL-025 — `rooms.status` enum 제약

**왜 지금 넣지 않았나.** 라이브 9종(waiting/ready/result/game_over/lobby/penalty_setting/
playing/stats/destroyed) + 클라이언트 리터럴 `reinviting` 이 확인되지만, 정적 grep 으로
전수를 증명할 수 없다. 불완전한 enum 은 게임을 조용히 깨뜨린다.
**어떻게.** 상태 전이를 코드에서 단일 상수 집합으로 뽑아낸 뒤 그 집합을 근거로 제약을 건다.

## JP-BL-026 — `created_at` NOT NULL

**왜.** 컬럼이 nullable 이라 RLS 부등호가 3값 논리에 노출된다. 라이브 NULL 은 0건이고,
`20260827003500` 트리거가 INSERT 시 항상 채우므로 신규 NULL 은 구조적으로 발생하지 않는다.
남은 것은 "과거 데이터에 NULL 이 없음을 근거로 제약을 마저 걸 것인가"이며, baseline 을
라이브 정확 재현에서 벗어나게 하므로 CEO 판단으로 남긴다.

## JP-BL-027 — RLS 무음 거부 방어 — **실증 완료 (2026-08-28)**

### 실측 증거 (로컬 PostgREST 16.2 + Postgres 17, 저장소 마이그레이션 9종 적용)

| 요청 | 응답 |
|---|---|
| 정상 행 `PATCH /rooms?id=eq.X` (supabase-js 기본, Prefer 없음) | **HTTP 204, 0바이트, error=null** |
| RLS 로 가려진 행 동일 요청 | **HTTP 204, 0바이트, error=null** |
| GRANT 자체가 없는 경우 | HTTP 401 `{"code":"42501"}` — 탐지 가능 |
| `Prefer: return=representation` | 1행 vs **0행** — 탐지 가능 |
| `Prefer: count=exact` | `Content-Range: 0-0/1` vs **`*/0`** — 탐지 가능 |

**즉 RLS 거부는 성공과 HTTP 수준에서 완전히 동일하다.** GRANT 거부만 오류로 드러난다.

### 클라이언트 탐지 실태 (코드 직접 확인)

| write | error 검사 | 행수 검사 | 판정 |
|---|---|---|---|
| `updateRoomStatus` | ❌ | ❌ | **무음 실패** (맨몸 await) |
| `updateRoomStatusScheduled` | ❌ | ❌ | **무음 실패** |
| `updateParticipantChoice` | ❌ | ❌ | **무음 실패** |
| `_doLeaveRoom` 의 delete/update | ❌ | ❌ | **무음 실패** |
| `markReady` | ❌ | ❌ | **무음 실패** + 이후 `me.is_ready = true` 낙관적 갱신 → **UI/DB desync** |
| `reserveDeferredLeave` | ✅ | ❌ | error 만 검사 → 무음 실패 미탐지 |
| `nextRound` | ✅ (throw 승격 + 재시도 안전망) | ❌ | 오류는 견고, 0행은 미탐지 |
| `promoteParticipantToHost` | ✅ + **검증 재조회** | — | **이미 보호됨** |

가장 위험한 것은 `markReady` 다 — write 가 반영되지 않았는데 로컬 상태를 ready 로 바꾸고 렌더한다.

### 수정 시도와 그 결과 (이번 세션)

`writeWithRowCheck(query, context)` 헬퍼(`.select('id')` 로 행 수 판정 + `QA.emit` 메트릭)를
6개 write 에 적용했으나, **기존 회귀 테스트 37건이 깨졌다**(build19 / build37-a2 / build37-a3 등).
원인은 그 테스트들의 supabase 대역(test double)이 update/delete 체인의 `.select()` 를
현재 구현과 다르게 다루기 때문이다. 방어적 폴백을 넣어 재시도했으나 여전히 실패했다.

**5개 테스트 파일의 대역을 내 변경에 맞춰 고치는 것은 "테스트를 약화시켜 GREEN 을 만드는 것"에
해당하므로 하지 않았고, 클라이언트 변경을 전부 되돌렸다.** `nextRound` 에 적용했을 때도
Build29 HIGH-1 계약 5건이 깨져 원복했다.

### 37건 실패의 근본 원인 — **독립 검증 완료** (codex-critic HIGH-3 요구)

되돌린 근거를 검증 없이 두지 않기 위해 로그와 하니스를 직접 확인했다.

실패 분포: `rc3-multiparticipant-sim` 21 / `build37-a7-…race` 10 / `build37-a3` 4 /
`build37-a2` 1 / `build19` 1. 대표 assert: `correctnessPassRate 0 (>=0.99 기대)`,
`예약 write가 없다: expected 0 to be 1`.

**원인은 테스트 대역이 아니라 하니스의 소스 슬라이싱이다.**
이 테스트들은 `extractBlock('async function _doLeaveRoom() {…', …)` 처럼 `index.html` 에서
**개별 함수 소스만 정규식으로 잘라내** `new Function(...)` 샌드박스에서 평가한다.
공유 헬퍼 `writeWithRowCheck` 는 다른 위치에 정의되므로 그 슬라이스 밖이고,
샌드박스 안에서 `ReferenceError` 가 되어 **write 자체가 실행되지 않는다** → 0-row 로 관측된다.

참고로 대역의 update 체인은 `{ eq, then }` 만 제공하고 `.select()` 가 없다
(`chain.then = (res) => res({ error: null })`). 두 번째 시도에서 `typeof query.select !== 'function'`
폴백을 넣었는데도 실패한 것이 이 진단을 뒷받침한다 — 폴백 코드에 도달하기 전에
헬퍼 이름 자체가 해석되지 않았다.

**판정: 프로덕션 회귀 아님. 테스트 하니스 구조상 공유 헬퍼를 쓸 수 없는 것이 원인.**

### 남은 작업 (별도 슬라이스, 설계 필요)
0. **하니스 선결 과제** — `extractBlock` 슬라이스에 공유 헬퍼를 포함시키거나, 헬퍼 없이
   각 write 지점에서 인라인으로 행 수를 검사하도록 설계할 것. 이것을 먼저 정하지 않으면
   같은 실패가 반복된다.
1. 테스트 대역이 `.select()` 체인을 실제 PostgREST 와 동일하게 다루도록 정비
2. 그 위에서 탐지 계층 도입
3. 0행 탐지 시의 **대응**(재시도/토스트/상태 롤백)은 제품 결정 — 특히 `markReady` 의 낙관적 갱신
4. `promoteParticipantToHost` 의 검증 재조회 패턴이 좋은 선례다 — 공유 헬퍼가 아니라
   **호출부 인라인 재조회**라 슬라이싱 문제를 겪지 않는다. 이 패턴을 따르는 것이 안전하다.
5. codex-critic 추가 지적: `_doLeaveRoom` 의 **참가자 self-delete** 도 대상에 포함해야 한다
   (`jp_participants_delete` 도 동일한 24시간 창을 쓰므로 유령 참가자가 남을 수 있다).
6. codex-critic 추가 지적: `reserveDeferredLeave` 는 0-row 도 실패로 승격해야 한다 —
   현재는 반영되지 않았는데 성공 토스트가 뜬다.
7. codex-critic 추가 지적: `markReady` 는 **탐지만으로 불충분**하다. 낙관적 갱신을 되돌리거나
   재시도해야 CEO 요구("correctly detect backend success/failure")를 실질 충족한다.

**왜.** PostgREST 는 RLS `USING` 이 행을 걸러 UPDATE 가 0-row 로 끝나도 에러를 내지 않는다
(200 + 빈 결과). `updateRoomStatus`·`updateParticipantChoice`·`_doLeaveRoom` 등 대부분의
write 는 `error` 조차 검사하지 않아, 24시간 창을 넘긴 세션에서 write 가 "성공한 척" 하고
반영되지 않을 수 있다(codex-critic M-1).
**어떻게.** 핵심 상태 전이(status 전이, round 증가)에 `.select()` 를 붙여 반환 row 수로
0-row no-op 을 판별한다. 클라이언트 변경이므로 별도 슬라이스로 다룬다.

---

# codex-critic 검증 이력 (2)

## 2026-08-27 — 백엔드 현대화 마이그레이션/RLS 설계 검증

| 심각도 | ID | 내용 | 처리 |
|---|---|---|---|
| HIGH | H-1 | 시간 창에 상한이 없어 `created_at` 을 미래로 쓰면 "불멸 행" 생성 — 설계의 핵심 방어가 무력화 | **수정 완료** — `20260827003500` 트리거로 `created_at` 을 서버 통제 불변화 + 정책 상·하한 추가 |
| MEDIUM | M-1 | RLS 거부가 PostgREST 에서 무음(0-row, 200) | **JP-BL-027 등록** + 하위 호환 위험/QA 체크리스트 반영 |
| MEDIUM | M-2 | 원장 복구에 `repair` 보다 멱등 재실행이 안전 | **전략 교체** — `db push` 로 실제 실행 |
| MEDIUM | M-3 | 테스트의 호출 지점 추출이 문장 경계를 인식하지 못함 | **수정 완료** — 다음 `.from(`/`;` 경계로 제한 + 주석 제거 |
| MEDIUM | M-4 | 라이브 `created_at` NULL 여부 미확인 | **확인 완료 — 0건** (양 테이블). 감사 문서에 기록 |
| LOW | L-1 | 호출 지점 수치 불일치 | **재정정** — 정확한 값은 **95**(97 → 리터럴 매치 96 → 주석 1건 제외). 첫 정정에서 두 단계 차감을 혼동해 96 으로 잘못 착지했고, 재검토에서 바로잡았다 |
| LOW | L-2 | 테스트의 `m.group ?? m[1]` 데드 코드 | **수정 완료** |
| LOW | L-3 | RLS 전수 검사가 미지의 테이블에서 중단 가능 | **확인 완료** — public 테이블 정확히 4개, 전부 RLS 활성. 배포 순서 0단계로 사전 조회 명시 |

BLOCKER 0건. HIGH 1건은 조직 규율에 따라 수정 후 재검토 대상이다.

## 2026-08-27 — 현대화 설계 재검토 (H-1 수정본)

**H-1 재검토 통과.** 트리거가 우회 경로 없이 닫혔음을 확인했다
(BEFORE ROW 트리거가 NEW 를 확정한 뒤 RLS WITH CHECK 가 그 값을 검사 / upsert·RETURNING·
service_role 모두 면제 없음 / `disable trigger` 는 소유자 권한이라 클라이언트 도달 불가).
M-1·M-3·M-4·L-2·L-3 및 A6 테스트 개작도 통과.

재검토에서 **신규 2건**이 추가 발견되어 같은 세션에서 처리했다.

| 신규 | 내용 | 처리 |
|---|---|---|
| MEDIUM | M-2 전략 교체가 §5 에만 반영되고 **§11 배포 체크리스트에는 옛 `migration repair` 커맨드가 남아 있었다** — 운영자가 §11 만 보면 폐기된 방식을 그대로 실행하게 된다 | **수정 완료** — §11 3·4·6단계를 `db push` 단일 절차로 정합 |
| LOW | 호출 지점 수 96 → 실제 **95** | **수정 완료** — 산출 근거를 문서에 명시 |
| LOW | 원장 전략 테스트가 `/migration repair/` 만 단언해 전략 회귀를 잡지 못함 | **수정 완료** — `db push --linked` 적극 단언 추가 |

## 2026-08-27 — 스테이징 재현 검증

`docs/JP_STAGING_VALIDATION_2026-08-27.md`. 정적 테스트 44개가 잡지 못한 **실행 순서 결함**을
포함해 3건을 발견·수정했다.

| 발견 | 내용 | 처리 |
|---|---|---|
| **clean bootstrap 실패** | baseline(`20260827001000`)이 증분(`20260806013625`)보다 뒤에 정렬돼 빈 DB 적용 시 `42P01 relation "public.participants" does not exist`. "저장소만으로 재현 가능"이 실제로는 거짓이었다 | baseline 을 `20260101000000` 으로 재배치. `[JP-MOD-7]` 정렬 계약 3건 추가 |
| service_role divergence | 마이그레이션 생성 테이블에는 service_role 기본 권한이 붙지 않아 신규 프로젝트에서 권한 0건 — "서버 사이드 정리" 전제가 무너짐 | `20260827003000` 에 명시 부여 + 자기검증 |
| 그 수정이 과잉 | 4개 테이블 전부에 부여 → KR 시절 A6 계약 테스트가 잡음 | `rooms`/`participants` 로만 축소. 계정 전적 2테이블 무권한을 자기검증으로 강제 |

**클라우드 스테이징은 생성이 차단됐다** — free plan 소유자당 활성 2개 한도를 KR+JP 프로덕션이
사용 중. Pro 승격(과금)·KR 일시정지·Tokyo 일시정지가 모두 금지/미승인이라 로컬 격리 Postgres 로
대체했다. PostgREST·GoTrue·Realtime 전달 계층은 **미검증**으로 남는다.

## JP-BL-027-B — `nextRound` 무음 0행 (CEO 반환)

**왜 남았나.** `nextRound` 의 4개 write 는 `{error}` 를 throw 로 승격하고 재시도 안전망까지
갖췄지만(Build29 HIGH-1), **행 수는 검사하지 않는다.** RLS 무음 거부(HTTP 200/0행/error=null)는
throw 를 만들지 않으므로 안전망이 발화하지 않는다 — codex-critic HIGH-4 지적이 정확하다.

**시도와 결과.** 4개 write 에 `.select('id')` + 카디널리티 검증을 넣었다. 그러자
`rc3-multiparticipant-sim` 이 18건 실패하고 correctnessPassRate 가 1.0 → ~0 으로 붕괴했다.

원인은 프로덕션 코드가 아니라 **시뮬레이션 하니스의 문서화된 한계**다.
`rc3-harness-support.mjs` 의 가짜 DB 는 `.eq(col, val)` 에서 **컬럼을 무시하고 항상 id 1건만**
매치한다. 그래서 `nextRound` 1단계의 `.eq('room_id', roomCode)` 전원 리셋이 원래부터
**무음으로 누락**되고 있었다(하니스가 §한계로 주석에 명시). 행 수 검사를 넣자 그 누락이
0행으로 드러나 매 라운드 throw 가 됐다.

하니스를 컬럼 인식으로 고쳐봤더니 `ZERO_ROW_WRITE` 는 0건이 됐지만, 이제 대량 리셋이
**실제로 수행되면서** 시뮬레이션 동역학이 바뀌어 여전히 18건이 실패했다.

**판단.** 하니스 DB 의미론 교정은 이 저장소에서 가장 정교한 정합성 하니스의 동작을 바꾸는
일이라 별도 슬라이스가 필요하다. 클라이언트 write 무결성 슬라이스에 태울 사안이 아니다.
CEO §16 이 허용한 대로 **되돌리고 반환한다.**

**다음 단계 제안.** ① 하니스를 컬럼 인식으로 고치고 그 자체로 회귀를 안정화 →
② 그 위에서 `nextRound` 카디널리티 검증 도입. 순서를 바꾸면 두 변화가 뒤섞여 원인 분리가 안 된다.

## JP-REALTIME-VALIDATION — OPEN

실제 Realtime 이벤트 전달은 여전히 미검증이다. Docker 부재(회선 ~55KB/s, 이미지 3.5GB ≈ 18시간)로
로컬 Supabase 풀스택을 세우지 못했다. 대역폭이 확보되거나 별도 승인된 검증 전략이 필요하다.

## JP-BL-027-C — rc3 하니스 participants realtime 전파 (Phase B 선행 조건)

### 2026-09-01 (7차) — JP-BL-002: JP 빌드에서 Kakao 인증 표면 제거

공유 기능을 전역에서 제거하지 않았다. **시장 프로필이 인증 표면을 소유**하게 했다 —
`disabledAuthProviders: ['kakao']`, `kakaoRestApiKey: null`. 목록을 선언하지 않는 시장(KR)은
`ENABLE_KAKAO_LOGIN === true` 라 동작이 완전히 같고, Kakao 구현 코드도 그대로 남아 있다.

차단 지점 5곳: UI 버튼 **DOM 제거**(CSS 숨김 아님) · loginWithSns(요청 이전 반환) ·
handleKakaoCallback(최상단 반환, edge function 미호출) · 네이티브 딥링크 · initFromUrl 콜백 분기.

**예전 Kakao 콜백**으로 들어오면 인증을 시도하지 않고 원시 OAuth 파라미터만 지운 뒤
평소 진입으로 보낸다. 정리 대상에 `invite` 를 넣지 않아 초대 연속성과 충돌하지 않으며,
부트 순서상 정리는 `beginInviteEntry` 이후다. 무관한 파라미터도 보존한다.

**JPX-001**: KR 공개 키가 source/dist 에서 사라졌다(region-guard 실측). 남은 검출은
아직 재생성하지 않은 네이티브 산출물뿐이라 예외를 삭제하지 않고 범위를 사실대로 축소했다 —
출시 차단 유지(JP-BL-006 종속).

`kakao-auth` edge function 은 JP 런타임에서 **도달 불가**가 됐다(두 호출부 모두 게이트,
함수 본문도 최상단 반환). CEO §9 대로 클라우드 자원은 건드리지 않았다 —
**DEPLOYED LEGACY / UNUSED** 로 보고만 한다.

검증: 단위 23건 신규 + 브라우저 46/46(Kakao 격리 7건 신규) + 전체 1644 통과.
비공허성: 시장 목록에서 'kakao' 를 빼면 실패한다.

### 2026-09-01 (6차) — JP-TOKYO-SECURITY-DEPLOY-001: 보안 5종 Tokyo 배포

**프로덕션 배포.** CEO 조건부 승인 하에 5종을 **한 번에 하나씩** 배포했다 —
`db push` 를 쓰지 않고 검토된 SQL 을 psql 로 실행 → 효과 검증 → `migration repair` 로 기록,
그 다음 것으로 진행. 실패 시 즉시 중단하도록 각 단계에 게이트를 뒀다(중단 사유 없이 완주).

배포 전 게이트: 활성 백엔드 0 · idle-in-txn 0 · 최근 24시간 방 0 · 스키마·원장이 사전점검과 동일.

| 마이그레이션 | 결과 |
|---|---|
| A room_id 인덱스 | 생성, participants 인덱스 2개(중복 없음) |
| B 최소권한 GRANT | 12조합 전부 검토된 목표와 일치, 시퀀스 authenticated 만 |
| C created_at 불변 | 함수 1 + 트리거 2, 기존 행 무변경, 일회용 행으로 불변성 실증 후 정리 |
| D 목표 RLS | allow-all 2건 제거, jp_* 7건 생성, stats/history 5건 authenticated 로 재선언 |
| E Realtime | **라이브 no-op** (publication·REPLICA IDENTITY 이미 목표 상태) |

원장 2행 → **7행**. legacy 3종은 CEO 지시로 손대지 않았다(JP-LEDGER-LEGACY-3 = DEFER).

**애플리케이션 데이터 무변경** — rooms/participants/stats/history 행 수와 md5, auth.users 수가
배포 전과 모든 검증 후에 걸쳐 완전히 동일하다.

**배포 후 검증(전부 통과).**
- 라이브 스모크(anon): 방 SELECT/INSERT/UPDATE·참가자 CRUD 가능, **방 DELETE 거부**,
  24시간 지난 방 UPDATE 0행(설계된 동결). 전부 트랜잭션 롤백으로 잔여 0.
- 라이브 스모크(authenticated): 소유자 stats 1행·history 184행 조회, 소유자 UPDATE 1행,
  **타 사용자 조회 0행·수정 0행**.
- **Tokyo Realtime 재검증**: 전 시나리오 REALTIME 도달, **폴링 구제 0건**, 3라운드 완주,
  초대 URL → 신원 → 합류 → 준비 → 카운트다운 → 라운드 → nextRound 전 경로 통과.
  일회용 행 전량 회수(방 행은 anon DELETE 가 막히므로 관리자 경로로 정리 — 설계된 동작).
- 로컬 JWT/RLS 브라우저 게이트 39/39.

**보안 적용 후에도 nextRound 다중 write 가 0행 실패 없이 동작한다** — JP-BL-027-B 의
카디널리티 검증이 켜져 있으므로 RLS 가 조용히 막았다면 즉시 드러났을 것이다.

### 2026-09-01 (5차) — JP-E2E-JWT-FIDELITY: 실제 JWT + 목표 보안 하의 인가 충실도

**보안 5종 배포 직전 게이트.** Tokyo 에는 아무것도 배포하지 않았다.

종전 브라우저 게이트는 앱이 보낸 프로덕션 anon JWT 를 로컬이 검증할 수 없어 **인증 헤더를
통째로 벗겼다**. 그래서 JWT 검증·롤 해석·GRANT/RLS 강제력이 전혀 검증되지 않았다.
이제 경계에서 **로컬 서명 토큰으로 치환**한다 — 롤 의미(anon)는 보존되고, 서명 검증과
권한 강제는 전부 실제로 일어난다. 프로덕션 서명 재료는 복사하지 않는다(로컬 전용 비밀, 저장소 밖).

깨끗한 로컬 환경에 **보안 5종 + invite_token 을 포함한 마이그레이션 10종**을 순차 적용해
부트스트랩이 성공함을 확인하고, 그 위에서 게이트 전체를 돌렸다. **브라우저 E2E 39/39 통과**
(초대 → 신원 → 합류 → 준비 → 카운트다운 → 1라운드 → nextRound 까지 목표 보안 아래에서 통과).

**보안 계약에서 찾은 것 (JP-MIG-REPLICA-IDENTITY).**
Realtime publication 마이그레이션이 publication 등록은 재현하면서 **REPLICA IDENTITY 는
고정하지 않았다.** 라이브 Tokyo 는 FULL 인데 저장소만으로 세운 백엔드는 DEFAULT 가 된다.
DEFAULT 면 DELETE 이벤트의 old tuple 에 기본키만 실려 앱이 쓰는 `room_id=eq.<code>` 필터가
평가되지 않아 **참가자 삭제 이벤트가 방 채널로 전달되지 않는다.**
CEO §11 지시대로 앱이 아니라 **마이그레이션을 고쳤다** — Tokyo 는 이미 FULL 이라 no-op 이다.
publication 등록 자체가 대시보드 out-of-band 였던 것과 정확히 같은 부류의 누락이다.

**목표 RLS 24시간 창 경계(의도된 계약, 결함 아님).** 24시간이 지난 방은 갱신·삭제가
HTTP 200 + 0행이 된다. 앱은 이 0행을 조용히 넘기지 않는다 — JP-BL-027 계열 카디널리티
검증이 오류로 세운다. 새 방 생성/합류는 정상이므로 사용자는 새 도전으로 진행할 수 있다.

**created_at 불변성은 소유자에게도 적용된다** — 트리거가 INSERT/UPDATE 모두에서 고정하므로
테이블 소유자 UPDATE 로도 바뀌지 않는다(시간 경과를 시뮬레이션하려면 트리거를 꺼야 했다).

### 2026-09-01 (4차) — JP-TOKYO-REALTIME-001: 실제 Tokyo Realtime 검증

로컬 대역이 아니라 **실제 Tokyo 프로덕션**(`cmfxhehpreanijwanwrr`)에 두 브라우저를 붙여
전송과 애플리케이션 수렴을 함께 검증했다. 일회용 방 1개, 참가자 2명만 만들고 전부 회수했다.

전 시나리오 **REALTIME 도달**(폴링 구제 0건). 3라운드 완주. 과거 데이터·스키마·정책·원장·
publication **완전 무변경**(사전/사후 md5 동일).

**하니스 결함 2건을 먼저 잡았다(H1).** 이것을 못 잡았으면 정반대 결론을 보고할 뻔했다.
- supabase-js 는 **vsn=2.0.0** 을 쓴다 — Phoenix 프레임이 객체가 아니라 배열이다.
  v1 객체로 파싱하니 모든 Realtime 도달이 "미도달"로 집계됐다. 노드/브라우저 직접 프로브로
  Tokyo Realtime 이 정상임을 먼저 확인한 뒤 디코더를 고쳤다.
- Playwright 기본 action timeout 은 무제한이라, 활성화되지 않는 버튼 클릭이 영원히 매달렸다.

**Realtime 특성 2건(R1/CORE, 결함 아님 — 기록 목적).**
- 채널이 PostgreSQL 구독을 마치기 전(약 2.2~3.7초)에 커밋된 변경은 재생되지 않는다.
  이 구간은 2.6초 폴링이 안전망이다. 측정 시에는 구독 완료를 기다린 뒤 써야 한다.
- 결과 화면에서 누른 퇴장은 **다음 라운드가 확정될 때** 실행된다(WRPS-084 Deferred Leave).
  `processDeferredLeaves()` 호출부가 라운드 확정 지점 1곳뿐이기 때문이다. 예약 자체는
  400ms 내에 기록되고(`leave_after_round=true`), 한 라운드 뒤 실제 삭제까지 실증했다.

### 2026-09-01 (3차) — JP-ENTRY-INVITE-002: 신원 부트스트랩을 가로지르는 보류 초대

**근본 원인(확정).** 파서/해석기 결함이 아니다. **앱 부트 순서와 상태 보존** 결함이다.
초대가 *파싱되었다는 이유만으로* 소비되고 URL 에서 지워졌다. 그 시점에 신규 초대자는
아직 신원이 없어(게스트/SNS 미확정) 권위 조회의 selfId 도 입장 권한도 없었다.

**설계(CEO 지정 B안 — PENDING INVITE CONTEXT).**

```
URL → 파싱 → 형식 검증 → pendingInviteContext 생성
    → 신원 부트스트랩을 가로질러 보존 → 사용 가능한 신원 확립
    → 소비 → 권위 room/participant 조회 → resolveInviteChallenge()
    → 합류/재개/네비게이션 → 성공 후에야 URL 에서 invite 제거
```

상태: `PARSED → WAITING_FOR_IDENTITY → RESOLVING → CONSUMED | FAILED` (5개, 그 이상 만들지 않았다).

**소비 규칙(확정).**
- 소비 **아님**: URL 파싱 / 인증 화면 표시 / 게스트 신원 요청 / 세션 조회 중
- 소비: 신원이 있고 **또한** 초대가 권위 해석·네비게이션에 넘겨진 뒤
- 종결 상태(INVALID_TOKEN·HOST_GONE·ROOM_FULL·UNAVAILABLE)는 **화면 확정 후** URL 정리
- 형식 오류는 신원과 무관하게 즉시 종결한다(DB 도 신원도 필요 없다)
- **일시적 조회 실패는 종결이 아니다** → `FAILED`, URL 유지, 새로고침으로 복구

**이 슬라이스가 추가로 찾은 것.** `openInviteEntry` 가 "결과 없음"과 "조회 실패"를 모두
INVALID_TOKEN 으로 묶어 처리하고 있어, **일시적 네트워크 실패가 초대를 영구 파기**했다.
E2E 케이스 12 가 이걸 잡았다. PostgREST `PGRST116`/406(결과 없음)만 종결로 보고
나머지는 `lookupFailed` 로 남겨 URL 을 지키게 했다. VALID 로 흘려보내는 경로는 여전히 없다.

**검증.** 단위 30건(전이·소비규칙·새로고침·멱등성·경계·부트 순서 고정) + 브라우저 E2E **15/15**.
E2E 는 신원 없는 실제 두 번째 브라우저가 초대 URL → 인증 화면 → 게스트 → 합류 →
준비 → 카운트다운 → **실제 1라운드 손 내기**까지 진행하는 것을 관측한다.

단위 스위트 비공허성은 결함 재주입으로 확인했다(부트 순서 되돌리면 2건 실패, 복원 시 30/30).

**릴리스 게이트.** JP 브라우저 E2E 는 이제 공식 JP 출시 준비 게이트다 — `docs/JP_RELEASE_GATE.md` 참조.

### 2026-09-01 (2차) — JP-E2E-INVITE-001: 두 클라이언트 브라우저 E2E

Playwright + 로컬 백엔드(PostgreSQL 17 + PostgREST 16.2)로 **실제 앱 DOM/네비게이션**을 구동했다.
프로덕션 소스는 수정하지 않았다 — SUPABASE_URL 이 하드코딩 상수라 라우트 가로채기로 로컬에 붙였다.

**E2E 10/10 통과** (알려진 결함 3건은 `test.fail()` 로 명시 표기 — 고쳐지면 표시가 실패한다).

실제 브라우저에서 검증된 것:
- 도전 생성 → 보안 토큰 발급·영속(권위 DB 대조) → 대기 화면 + 초대 액션 노출
- 짧은 방 코드가 초대 URL 에 자격증명으로 들어가지 않음
- 오류 경로 4종: 알 수 없는 토큰 / 형식 오류 / **host 퇴장(相手はもう待っていません)** / 정원 초과
- 소비 후 URL 에서 invite 제거, 무관한 파라미터 보존

**E2E 가 발견한 실제 결함 (JP-ENTRY-INVITE-002, P1/JP)**
신규 초대자는 인증 화면이 먼저 뜬다. 그런데 초대 부트스트랩이 **세션 확인보다 앞서** 실행되어
신원이 생기기 전에 초대를 소비하고 URL 에서 지운다 → 합류가 완료되지 않는다.
단위·하니스 테스트는 각 계층을 개별 검증했기 때문에 이 순서 문제를 잡지 못했다.
**브라우저 E2E 를 도입한 목적이 그대로 달성된 사례다.**

환경 제약(I1): playwright headless shell 다운로드가 반복 실패해 시스템 Chrome 채널을 쓴다.
Realtime 은 이 슬라이스에서 연결하지 않는다(폴링 경로로 진행) — JP-TOKYO-REALTIME-001 로 분리.

`npm test` 는 E2E 를 제외하고, E2E 는 `npm run test:e2e` 로 분리했다(GX-7 배선 기록도 함께 갱신).

### 2026-09-01 — 리전 안전 감사 + JP-ENTRY-INVITE-001 (URL 부트스트랩)

**리전 감사(실행 설정 실측)**

| 브랜치 | SUPABASE_URL ref | 판정 |
|---|---|---|
| `dev/kr-build40` (2026-08-29) | sannrfmhevebqgfdqcps | ✅ KR Seoul |
| `release/kr-build40-qa` | sannrfmhevebqgfdqcps | ✅ KR Seoul |
| `release/kr-build39-qa` | sannrfmhevebqgfdqcps | ✅ KR Seoul |
| `feature/rps-jp-line-miniapp` | cmfxhehpreanijwanwrr | ✅ JP Tokyo |
| `feature/rps-kr-seoul-backend` (2026-08-11) | **cmfxhehpreanijwanwrr** | ⚠️ **REGION ISOLATION DEFECT** (index.html:4248, 실행 상수) |
| `main` (2026-06-02) | **cmfxhehpreanijwanwrr** | ⚠️ 동일 (KR Seoul 전환 이전 상태) |

**KR 프로덕션은 위험하지 않다** — 실제 출시 브랜치 3종이 모두 Seoul 을 가리킨다.
결함 브랜치 2개는 stale 이며 **KR 소유**다. 거버넌스에 따라 JP 프로젝트는 고치지 않는다 →
`JP-REGION-ISOLATION-001` 로 등록만 한다.

**CI 는 설계상 안전하다**: `supabase-deploy.yml` 이 ref 를 하드코딩하지 않고
`config/regions.json` 에서 국가별로 해석하며, 대상 ref 를 **그대로 타이핑해야** 진행된다.

**JP-BL-011 완료**: `~/.rps_tokyo_env`(Tokyo 전용) / `~/.rps_seoul_env`(Seoul 전용) 분리.
교차 리전 ref 0건, 권한 0600, `~/.rps_env_legacy_backup` 보존. 비밀값 미출력·미커밋.

**JP-ENTRY-INVITE-001**: `?invite=<token>` → `parseInviteFromSearch` → `buildEntryContext`
→ 기존 어댑터(`openInviteEntry` → `navigateFromInvite`). 부트스트랩은 **파싱·정규화만** 하고
상태 판정을 복제하지 않는다(테스트로 고정). 형식 오류·중복 파라미터는 **DB 조회 없이** 거부한다.
소비 후 `history.replaceState` 로 URL 에서 invite 를 제거하고 다른 파라미터는 보존한다.
입장은 기존 `joinFromQrCode` 경로를 재사용한다 — 초대 전용 입장 로직을 만들지 않았다.

Tokyo Realtime 검증 계획: `docs/JP_TOKYO_REALTIME_VALIDATION_PLAN.md` (준비만, 미실행).

### 2026-08-31 (4차) — JP-SYNC-INVITE-004: 방 생성 → 보안 토큰 → 대기

`createRoom` 의 **host 참가자 insert 성공 직후**에 토큰 발급을 연결했다.
발급은 `issueChallengeInviteTokenWithRetry(code, 3)` — **같은 room id 로만** 재시도하므로
방이 중복 생성되지 않는다(재시도 코드에 insert/delete 가 없음을 테스트로 고정).

부분 실패 처리(§3): 토큰 실패 시 `state.inviteAvailable=false` 로 두고
`INVITE_TOKEN_UNAVAILABLE` metric 을 남긴다. **방은 지우지 않는다** — 참가자 행이 이미 있고
삭제는 파괴적이며 경합을 만든다. 공개 초대를 유효한 것처럼 제시하지 않으며
**짧은 방 코드로 대체하지 않는다**.

대기 상태(§4): 별도 화면을 만들지 않고 `showHostRoom` 생명주기를 확장했다
(`renderHostWaitingState`). KR QR 동작은 무변경이다. 초대 액션은 **토큰이 검증된 뒤에만** 노출된다.
문구는 「友だちの参加を待っています」 — 온라인 여부를 단정하지 않는다.

초대 전송(§5): `buildInviteUrl()` 은 플랫폼 중립 URL(`?invite=<token>`)을 만든다.
나중에 LIFF 어댑터는 `copyInviteLink()` 상당의 **전송 계층만** 교체하면 된다.

**JP-BL-011**: `~/.rps_tokyo_env` 신설(0600, `RPS_TOKYO_PROJECT_REF` 포함).
저장소에는 이 파일들을 참조하는 스크립트가 **없다**(문서 언급뿐)。기존 `~/.rps_seoul_env` 는
**변경하지 않았다** — 그 안의 `SUPABASE_PROJECT_ID=sannrfmhevebqgfdqcps` 가 JP/KR 어느 브랜치의
Supabase URL 과도 일치하지 않아, 소유 프로젝트를 CEO 가 확인하기 전에는 재배치가 위험하다.

### 2026-08-31 (3차) — Tokyo invite_token 격리 배포 + UI 배선 (003B)

상세: `docs/JP_INVITE_UI_TOKYO_MIGRATION_2026-08-31.md`

**Tokyo 격리 배포 완료.** `db push` 를 쓰지 않고 검토된 DDL 한 건만 직접 적용한 뒤,
Supabase 지원 도구(`migration repair <version> --status applied`)로 **그 버전만** 표시했다.
원장 위조(수동 INSERT)를 하지 않았다.

배포 전/후 대조 (373 rooms / 543 participants):

| 항목 | 전 | 후 |
|---|---|---|
| rooms_checksum | aff3416144c16636ee18564ee92d4ef5 | **동일** |
| participants_checksum | 1c8c921535fcae9998f46794ef463b96 | **동일** |
| policies | 7 | **7** |
| grants(anon/rooms) | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE | **동일** |
| realtime publication | 2 | **2** |
| indexes | 4 | 5 (invite_token 부분 unique 추가) |
| `allow_all_*` 정책 | 2 | **2 (그대로 — 보안 세트 미적용 유지)** |
| invite_token 컬럼 | 없음 | 있음, 기존 373행 전부 NULL |

중복 non-null 토큰 insert 는 실제로 거부됨을 실증(트랜잭션 rollback, 행 수 373 불변).
원장은 정확히 2행: `20260528205753`, `20260830010000`.

**UI 배선(003B)**: `screenInviteUnavailable` 마크업 신설 + `hideAllScreens` 등록 +
`renderInviteUnavailable()` / `navigateFromInvite()`. i18n 키로만 렌더하며 원시 DB 문구를
표시하지 않는다. 약한 방 코드로의 fallback 이 없음을 테스트로 고정(§8).

### 2026-08-31 (2차) — JP-SYNC-INVITE-003: 초대 진입 어댑터 + Tokyo 프리플라이트 STOP

상세: `docs/JP_E2E_INVITE_FLOW_2026-08-31.md`

**Tokyo invite_token 배포 = STOP (배포하지 않음).** CEO 의 조건부 GO 규칙에 걸린다:
Tokyo 라이브는 아직 `allow_all_rooms` / `allow_all_participants`(ALL/true/true)이고 인덱스는
PK 4개뿐이다(2026-08-27 라이브 감사). 즉 **2026-08-27 보안/스키마 세트 5종이 미적용**이며,
`supabase db push` 는 invite_token 과 함께 그것들까지 배포한다 → 의도치 않은 보안 마이그레이션 동반.
부수적으로 Tokyo 접근 토큰도 없다(Seoul 자격증명만 존재하며 **혼용하지 않았다**).

**어댑터 배선(플랫폼 중립, LIFF 없음)**:
`openInviteEntry({inviteToken, selfId})` → 권위 조회 → `resolveInviteChallenge()` →
`inviteIntentForState()` → `{action, screen, titleKey, descKey}`.
DB 오류(스키마 미배포 42703 포함)는 **VALID 로 흘러가지 않고** INVALID_TOKEN 으로 흡수되며
원시 DB 문구가 UI 의도에 노출되지 않는다.
`issueChallengeInviteToken()` 은 스키마 미배포 시 **조용히 성공한 척하지 않는다**(reason 반환) —
프로덕션 의존성을 격리한다.

미구현: 실제 DOM 화면(`screenInviteUnavailable`) 생성과 `showScreen` 배선, 방 생성 경로에 대한
토큰 발급 호출 연결. 둘 다 스키마 배포 이후에 의미가 생긴다.

### 2026-08-31 — JP-SYNC-INVITE-002: 대기 / host 부재 / 초대 해석

상세: `docs/JP_WAITING_INVITE_RESOLUTION_2026-08-31.md`

**host presence 조사 결과(§6)** — 발명하지 않고 실제 모델을 확인했다:
- presence 는 **Supabase Realtime 채널 기반**(`state.channel.presenceState()`)이고 **DB 에 영속되지 않는다**
- 명시적 퇴장은 **참가자 행을 삭제**한다(index.html:12440 부근)
- `cleanupDroppedParticipants` 는 **host 를 명시적으로 제외**한다(`!p.is_host`) → 끊긴 host 행은 정리되지 않는다
- 스키마에 `last_seen_at`/`is_online` 이 **없다**

| 구분 | DB 만으로 판별 |
|---|---|
| HOST EXPLICITLY LEFT | ✅ host 행 없음 |
| HOST RECORD STILL EXISTS | ✅ |
| HOST DISCONNECTED TEMPORARILY | ❌ ACTIVELY WAITING 과 구분 불가 |
| HOST ACTIVELY WAITING | ❌ 동일 |

**갭**: 영속 liveness 신호가 없다. V1 최소안은 **구조적 신호만 사용**(host 행 존재 + 방 상태)하고,
"행은 있으나 조용한 host" 는 입장 후 기존 Realtime presence 가 처리하게 둔다.
heartbeat 인프라는 **추가하지 않았다**.

**초대 해석 계약(CORE, 순수 함수)**: `resolveInviteChallenge({token, room, participants, selfId})`
→ `VALID / INVALID_TOKEN / HOST_GONE / ROOM_FULL / ALREADY_JOINED / UNAVAILABLE`.
DB·네트워크를 만지지 않는다(권위 조회는 호출자 책임). 원시 DB 오류를 UI 로 노출하지 않는다.
입장 가능 상태는 `['waiting','lobby','ready']` 로 명시 — **오래된 행이 자동으로 유효한 도전을 뜻하지 않는다**(§9-A).

**host-gone UX**: ko/ja/en 3개 로케일 i18n 키 추가. 일본어는 지정 개념 그대로 「相手はもう待っていません」.
복구 행동 2가지(새 도전 만들기 / 홈).

**로컬 스키마 검증(§8·§12-15, Tokyo 미배포)**: PostgreSQL 17 clean bootstrap —
9종 마이그레이션 **0 실패**, 멱등 재적용 0, 완전 재구축 0.
`rooms.invite_token` 컬럼·부분 unique 인덱스 생성 확인, 유효/무효 조회, **중복 토큰 거부 실증**,
회수(NULL) 다중 허용, host 퇴장 후 `has_host=null`, 새 도전=새 토큰, RLS on(정책 7개),
anon grants(INSERT/SELECT/UPDATE), **롤백→재적용 성공**.

### 2026-08-30 (4차) — JP-SYNC-INVITE-001 (부분): 방 시작 정책 + 초대 토큰

상세: `docs/JP_SYNC_INVITE_FOUNDATION_2026-08-30.md`

**근본 원인 확정**: `areAllActivePlayersReady()` 의 하한이 `active.length > 0` 이라 host 가
혼자 준비를 마치면 **1인 자동 시작**이 발화하고, `status='playing'` 이 되면서
`isJoinLocked()`(index.html:5587)가 초대받은 친구의 입장을 막는다. `isJoinLocked` 의 ready 분기는
host 를 제외하므로 잠금의 실제 경로는 ready 가 아니라 **자동 시작**이다.

**CORE 추상화**(시장 분기 없음): `ROOM_START_POLICY.minParticipantsToStart`.
미설정 시 1 — **KR 동작 불변**(QR 자리에서 host 단독 시작 유지). JP 시장 레이어가 2 로 설정한다.

**초대 토큰**(CORE, 플랫폼 중립): `generateInviteToken()` = 16바이트 CSPRNG → base64url 22자.
CSPRNG 부재 시 약한 토큰으로 대체하지 않고 throw 한다. `isValidInviteTokenFormat()` 이
조회 전에 형식을 거른다. 저장은 `rooms.invite_token` 컬럼 하나(전용 테이블 아님).
마이그레이션 `20260830010000_jp_v1_room_invite_token.sql` **작성만 했고 배포하지 않았다**.

미구현(다음 슬라이스): 대기 화면 UI, host 부재 상태 화면, 토큰 발급/조회 배선(스키마 배포 선행),
stale room 정리 인프라.

### 2026-08-30 (3차) — JP-BL-027-D: strict = 권위 모드 (CEO 결정)

rc3 필터 모드의 권위를 옮겼다. **하니스/QA 변경이며 프로덕션 게임 규칙 변경이 아니다** —
같은 커밋에서 `index.html` / `supabase/` 는 변경되지 않는다.

| 모드 | 지위 |
|---|---|
| **strict** (기본값) | **권위 · 릴리스 게이팅.** 릴리스 준비도는 이 모드로만 판단한다 |
| legacy | 과거 참조 전용 · **비권위 · 게이팅 금지.** 삭제하지 않고 라벨만 명확히 함 |

legacy 가 권위를 잃은 근거(실측):
- `.eq('room_id', …)` 를 표현하지 못해 그 필터의 대상 행을 0건으로 만든다
- 그 결과 프로덕션 `autoFillChoices` 의 권위 재조회가 한 번도 발화하지 못했다(auto-choice 0 vs strict 10)
- JP-BL-027-B 이후 `participants.reset` 이 항상 0행이 되어 게임이 진행되지 못한다
  (legacy 완주 0/700 · strict 700/700, legacy rc3 0행 오류 63200건)

전환이 프로덕션 동작을 바꾸지 않았음:
- rc3 권위 모드 결과 **10 실패 / 53 통과, 0행 오류 0건** — 전환 직전 strict 측정과 **동일**
- 전체 스위트(rc3 제외) 83 파일 1445 통과

**권위 모드의 잔여 10건**(릴리스 게이팅 백로그, 전부 기존 H1-a 계열):
- CROSS_DEVICE_OUTCOME_MISMATCH 하드게이트 40건
- mutation 민감도 마진 2건(11 vs 12, 399.0 vs 400.7) — 변이는 여전히 탐지되며 마진만 근소 미달.
  임계값은 **건드리지 않았다**. strict 기준 재보정이 필요하다(별도 항목).
- 타임아웃 2건

### 2026-08-30 (2차) — JP-BL-027-B W1 부분 write 보강 (CEO CONDITIONAL PASS 대응)

CEO 지적: `participants.reset` 의 `>=1` 계약은 0행은 잡지만 **부분 write**(2명 중 1명만 리셋)를
통과시킨다. 실제로 그랬다 — 역검증에서 `>=1` 중간본(1fd3720)은 부분 write 테스트 2건에서 실패한다.

`nextRound` 에는 권위 참가자 집합이 없다(로컬 `state.confirmedSafeIds/LoserIds` 와 `roomCode` 뿐).
그래서 **최소 권위 조회**를 넣었다: `select('id').eq('room_id', …)` → 반환 집합과 대조.
낡을 수 있는 `state.participants` 는 기대 집합의 출처로 쓰지 않는다.

동시성 처리: 조회와 갱신 사이의 **추가**(입장)는 무해로 통과, **누락**(리셋 안 됨)만 실패로 본다.
누락이 나오면 한 번 더 권위 조회해 "아직 방에 있는" 경우만 실패로 확정한다(동시 퇴장 오탐 제거).

부분 성공 매트릭스(신규 12개 테스트, REAL nextRound 격리 실행): W1~W4 각각에 0행/부분행/error 를
주입해 (a) 방이 진행하지 않고 (b) ZERO_ROW_WRITE 가 남고 (c) advancingRound 가 풀리고
(d) 재시도 카운터가 성공으로 오인 정리되지 않고 (e) 재시도가 변이를 누적시키지 않음을 확인.

### 2026-08-30 — JP-BL-027-B 완료 (CORE)

상세: `docs/JP_CRIS_JP_BL_027B_2026-08-30.md`

`nextRound`(index.html:11057~) 의 4개 write 에 `.select('id')` + **write 별로 다른 카디널리티
계약**을 적용했다. 위반 시 `ZERO_ROW_WRITE` metric(context `nextRound.*`, expectedRows/
affectedRows 포함)을 남기고 throw 로 승격한다 — 승격해야 기존 catch 의 안전망 A/재시도가
dead code 가 되지 않는다.

| write | 필터 | 계약 |
|---|---|---|
| participants.reset | `.eq('room_id', …)` | **≥1** (방 인원 가변) |
| participants.markSafe | `.in('id', safeIds)` | **정확히 safeIds.length** |
| participants.markLoser | `.in('id', loserIds)` | **정확히 loserIds.length** |
| rooms.advance | `.eq('id', …)` | **정확히 1 + id 일치** |

계약 테스트 17개 신설, 반공허성 역검증 완료(수정 전 13/17 실패).

**부수 발견(중요)**: 이 검증이 켜지자 legacy 근사 필터가 `nextRound.participants.reset` 을
0행으로 만든다는 사실이 드러났다 — 즉 **rc3 legacy 는 그 write 가 한 번도 실행된 적 없는
세계를 시뮬레이션해 왔다**(하니스가 `applyNextRoundMarkerWrites` 로 직접 주입해 대체).
실측: legacy 완주 **0/700**, strict 완주 **700/700**. → JP-BL-027-D 로 등록.

회귀: 전체 스위트 **82 파일 1431 통과 / 실패 0**. rc3 strict **8 실패(하드게이트 87), 0행 오류 0건**
— 수정 전과 동일하므로 **strict 회귀 없음**.

### 2026-08-29 (3차) — R1b 슬라이스: 트리거 매핑 완료, 배선은 보류

상세: `docs/JP_RC3_RESULT_PUBLISH_2026-08-29.md`

프로덕션 자동 결과 발행 트리거는 **둘**뿐이다(grep 전수):
`fetchParticipants:7334`(전원 선택 즉시=A) / `autoFillChoices:9271`(선택창 종료=B).
`hostJudgeRound:10640` 은 수동 UI 버튼 전용. 중복 방어는 전부 `publishHostRoundResult`
(7035~7101) 자신에 있다 — 가드·in-flight 래치·자체 권위 재조회·멱등 가드·전원선택 가드.

**발견한 선행 격차(해소 완료)**: 접합부 ②가 카운트다운 진행 중에도 선택을 제출하고 있었다.
프로덕션은 `beginRoundTimer`(9017)가 선택 화면을 띄운 뒤에만 선택이 가능하다(UI 가 실질 게이트).
이를 REAL 관측치 `rendered.choiceStartByRound` 기준으로 바로잡았고, **게이트 단독으로는
legacy 63/63 GREEN 유지**를 분리 실험으로 증명했다.

| 구성 | 하드게이트 | 타임아웃 | legacy |
|---|---|---|---|
| R1 | 44 | 0 | GREEN |
| 게이트 + Trigger A | 30 | 7 | 5건 실패 |
| **게이트만 (납품)** | **41** | **0** | **GREEN** |

**잔여 41건 = 전량 H1.** H1-a(선택 제출 지연 모델 부재, 주 원인) + H1-b(N×M 팬아웃, 미검증).
§9 가 금지한 "수치를 줄이기 위한 지연 튜닝"에 해당하므로 상수를 발명하지 않고 멈춘다.
`strictFilters` 기본값 `false` 유지. **`nextRound`(JP-BL-027-B) 미착수.**

### 2026-08-29 (2차) — R1 슬라이스 결과: strict 하드게이트 90 → 44

상세: `docs/JP_RC3_AUTHORITATIVE_REFRESH_2026-08-29.md`

`refreshParticipantsAuthoritative` 가 프로덕션 `fetchParticipants` 본문(index.html:7140~7354)의
host 권위 전이를 실제로 실행하도록 배선했다(REAL 함수 호출만, 상태 직접 주입 없음):
- 호스트 역할 전환 + `rearmHostProgressionAuthority()`
- `state.participants` 반영 + `updateSelectedCount()`
- `status='ready'` + `areAllActivePlayersReady()` → REAL `startGame()`

결과: strict 하드 게이트 **90 → 44**, 나머지 9개 실패 assertion 은 이전과 **바이트 동일**.
legacy 63/63 GREEN, 전체 스위트 77파일 1381통과, 타임아웃 0.

**잔여 44건 = 전량 H1(하니스 결함), R1b 에 귀속.** 프로덕션은 `publishHostRoundResult` 를
`fetchParticipants:7334`(전원 선택 즉시)와 `autoFillChoices:9271`(선택창 종료) 두 곳에서
자동 호출하는데 rc3 는 후자만 배선돼 있다. 전자를 켜면 하드게이트가 44→39 로 더 줄지만
phase 관측 모델이 무너진다(correctnessPassRate 0.083). 그 둘을 동시에 만족시키는 것이 R1b.

`strictFilters` 기본값 `false` 유지 — 알려진 격차가 있는 동안 strict 를 기본으로 만들지 않는다.
**`nextRound`(JP-BL-027-B)는 여전히 착수하지 않는다.**

### 2026-08-29 결과 — PHASE C STOP GATE 미통과 (Case C)

상세: `docs/JP_RC3_REALTIME_FIDELITY_2026-08-29.md`

구현 완료분(프로덕션 무변경, `tests/` 만 변경):
- participants `postgres_changes` 전파 — 0행/실패 write/타 방 변경은 이벤트를 만들지 않는다.
- 프로덕션과 동일한 2계층 지연: 전파지연(알림 도착) + 고정 80ms trailing-edge 디바운스.
- 재조회 3중 가드: busy/pending, `fetchParticipantsSeq`, `roomCode`(빈 값도 폐기).
- 보류는 즉시 재시도가 아니라 디바운스 재예약.
- 독립 계약 테스트 46개 신설/갱신, 전부 통과.

측정(strict 모드, 프로덕션 무변경):

| 회차 | 하니스 상태 | 하드 게이트 잔여 |
|---|---|---|
| 기준 | 전파 없음 | 88 |
| +전파 | leading-edge, 가드 없음 | 79 |
| +가드 | 재조회 3중 가드 | 67 |
| +trailing(이벤트당 타이머) | — | 98 (타임아웃 1) |
| **최종** | 2계층 80ms + roomCode 정정 | **90** |

**판정: Case C.** 88 → 79 → 67 → 98 → 90 의 **비단조** 이동은 측정이 여전히 하니스 잔여 편차에 지배됨을 뜻한다. strict 수치를 프로덕션 결함의 증거로 사용할 수 없다.

**지배적 잔여 원인 = R1**: `refreshParticipantsAuthoritative` 가 REAL `fetchParticipants`(243줄)의 재조회 부분만 재현하고 host 역할 전환·`shouldResetForParticipantChange`·`areAllActivePlayersReady`→`startGame`·`publishHostRoundResult`·`recoverRoundWhenAllPlayersWaiting` 등을 재현하지 않는다. 전파를 켠 순간 이 축약이 처음 활성화되었다.

회귀 게이트: rc3 legacy 63/63, 계약 46/46, 전체 스위트 76파일 1359통과.
`strictFilters` 기본값은 `false` 유지(§10 전환 보류 — 방어 가능한 GREEN 아님).
**`nextRound`(JP-BL-027-B)는 착수하지 않는다.**

**왜.** Phase A 에서 하니스의 `.eq(col,val)` 컬럼 무시 결함을 교정했다. 그러자 프로덕션
소스를 전혀 바꾸지 않았는데도 rc3 하드 게이트에 `CROSS_DEVICE_OUTCOME_MISMATCH` 88건이
드러났다. 원인 분리 결과 `participants` 대량 갱신(`.eq('room_id',…)`)이 실제로 적용되기
시작한 것이 유일한 원인이었다(rooms 컬럼 인식은 무해).

**왜 이것만으로 결론 낼 수 없나.** 이 하니스는 `participants` 변경에 realtime 전파가 없다 —
구독·브로드캐스트가 `rooms` 에만 있고 기기는 fetch 로만 참가자 변화를 안다. 프로덕션은
`participants` 도 `postgres_changes` 로 전파된다. 따라서 "리셋이 적용되는 순간"과 "다른
기기가 인지하는 순간"의 간극을 하니스가 실제보다 크게 만든다. 88건 중 어디까지가 진짜
레이스인지 지금 증거로는 가를 수 없다.

**현재 상태.** `createDb({ strictFilters })` 로 분리했다. 기본 false(기존 동역학, 회귀 GREEN),
계약 테스트 20건이 true 로 교정본을 검증한다. **기대치는 약화하지 않았다.**

**순서.** ① participants realtime 전파 모델링 → ② `strictFilters` 기본 전환 후 회귀 안정화
→ ③ 그다음 Phase B(`nextRound` 카디널리티 검증). 순서를 바꾸면 하니스 변화와 프로덕션
변화가 뒤섞여 원인 분리가 불가능해진다.

증적: `docs/JP_RC3_HARNESS_DISCREPANCY_2026-08-28.md`
