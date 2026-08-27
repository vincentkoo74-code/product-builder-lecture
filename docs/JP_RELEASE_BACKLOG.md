# MARU RPS V1.0_JP — Release Backlog

일본판 출시까지 남은 미해결 항목 추적표. baseline/안전화 단계(2026-08-27)에서
발견했거나 의도적으로 이월한 항목만 기재한다. 완료 항목은 지우지 않고 상태만 바꾼다.

상태: `OPEN` / `IN PROGRESS` / `DONE` / `WONTFIX`

| ID | 상태 | 심각도 | 항목 | 출시 차단 |
|---|---|---|---|---|
| JP-BL-013 | DONE | **Blocker** | JP 백엔드 확보 → **기존 Tokyo 복원(Option A′), ACTIVE_HEALTHY** | — |
| JP-BL-001 | OPEN | High | region-guard 메커니즘을 KR 브랜치로 백포트 | 아니오 (KR 측 위험) |
| JP-BL-002 | OPEN | High | JP 빌드에서 Kakao 로그인 경로 제거 (JPX-001 해소) | **예** |
| JP-BL-003 | DONE | High | JP 브랜치를 origin 에 push → 539e0de | — |
| JP-BL-004 | DONE | High | GitHub Environments `supabase-KR`/`supabase-JP` 구성 | — |
| JP-BL-005 | OPEN | High | 서버측 매치메이킹 리전 검증 (KR↔JP 크로스매칭 차단) | **예** |
| JP-BL-006 | OPEN | Medium | 네이티브 산출물(ios/android public) JP 재생성 — CEO 지시로 보류 중 | **예** |
| JP-BL-007 | DONE | Medium | Tokyo 백엔드 실물 점검 → **삭제 아님, INACTIVE(일시정지)** | — |
| JP-BL-008 | OPEN | Medium | LINE MINI App / LIFF 요구사항 조사 및 설계 | **예** |
| JP-BL-009 | OPEN | Medium | `ENABLE_LINE_LOGIN` 활성화 + 관련 테스트 잠금 해제 | **예** |
| JP-BL-010 | DONE | Medium | region-guard 를 release gate 에 연결 (출시 모드) | — |
| JP-BL-011 | OPEN | Low | `~/.rps_seoul_env` 파일명/내용 불일치 정리 | 아니오 |
| JP-BL-012 | OPEN | Low | JP 앱 식별자·딥링크 스킴 분리 검토 | 미정 |
| JP-BL-014 | DONE | Medium | A5 device-matrix 타임아웃 → **Tokyo 복원으로 해소, 통과 확인** | — |
| JP-BL-015 | OPEN | **High** | JP 통합 마이그레이션 3종 작성 (현 4종은 신규 프로젝트에 적용 불가) | **예** |
| JP-BL-016 | DECIDED | High | free plan 은 엔지니어링 기간 유지, 외부 베타 전 Pro 승격 (JP-PROD-GATE) | **예** |
| JP-BL-017 | OPEN | Medium | `SUPABASE_DB_PASSWORD` 리전별 분리 | 아니오 |
| JP-BL-018 | DESIGNED | **High** | 목표 RLS 설계 완료 — 배포 미승인 | **예** |
| JP-BL-025 | OPEN | Medium | `rooms.status` enum 제약 — 전수 증명 방법 확정 후 적용 | 아니오 |
| JP-BL-026 | OPEN | Low | `created_at` NOT NULL 제약 추가 여부 | 아니오 |
| JP-BL-027 | OPEN | **High** | RLS 무음 거부 — 실제 PostgREST 로 실증 완료, 클라이언트 미탐지 확인 | **예** |
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
