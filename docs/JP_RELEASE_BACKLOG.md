# MARU RPS V1.0_JP — Release Backlog

일본판 출시까지 남은 미해결 항목 추적표. baseline/안전화 단계(2026-08-27)에서
발견했거나 의도적으로 이월한 항목만 기재한다. 완료 항목은 지우지 않고 상태만 바꾼다.

상태: `OPEN` / `IN PROGRESS` / `DONE` / `WONTFIX`

| ID | 상태 | 심각도 | 항목 | 출시 차단 |
|---|---|---|---|---|
| JP-BL-013 | OPEN | **Blocker** | **JP 백엔드 확보 — Tokyo 프로젝트가 존재하지 않음** | **예** |
| JP-BL-001 | OPEN | High | region-guard 메커니즘을 KR 브랜치로 백포트 | 아니오 (KR 측 위험) |
| JP-BL-002 | OPEN | High | JP 빌드에서 Kakao 로그인 경로 제거 (JPX-001 해소) | **예** |
| JP-BL-003 | OPEN | High | JP 브랜치를 origin 에 push (현재 로컬 전용) | 아니오 |
| JP-BL-004 | OPEN | High | GitHub Environments 에 required reviewers 설정 | 아니오 |
| JP-BL-005 | OPEN | High | 서버측 매치메이킹 리전 검증 (KR↔JP 크로스매칭 차단) | **예** |
| JP-BL-006 | OPEN | Medium | 네이티브 산출물(ios/android public) JP 재생성 | **예** |
| JP-BL-007 | DONE | Medium | Tokyo 백엔드 실물 상태 점검 → **프로젝트 부재 확인** | — |
| JP-BL-008 | OPEN | Medium | LINE MINI App / LIFF 요구사항 조사 및 설계 | **예** |
| JP-BL-009 | OPEN | Medium | `ENABLE_LINE_LOGIN` 활성화 + 관련 테스트 잠금 해제 | **예** |
| JP-BL-010 | OPEN | Medium | region-guard 를 release gate 에 연결 | 아니오 |
| JP-BL-011 | OPEN | Low | `~/.rps_seoul_env` 파일명/내용 불일치 정리 | 아니오 |
| JP-BL-012 | OPEN | Low | JP 앱 식별자·딥링크 스킴 분리 검토 | 미정 |
| JP-BL-014 | OPEN | Medium | A5 device-matrix 테스트 타임아웃 (JP-BL-013 의 증상) | **예** |

---

## JP-BL-013 — JP 백엔드 확보 (BLOCKER)

**왜.** 일본 전략의 전제였던 "기존 Tokyo 리전 유지"가 성립하지 않는다 (JP-BL-007).
이 항목이 해결되기 전에는 실행 가능한 일본 빌드를 만들 수 없고, LINE MINI App
작업(JP-BL-008/009)도 붙일 백엔드가 없다.

**CEO 결정 사항 — 엔지니어링이 아니라 사업 판단이다.**

| 선택지 | 내용 | 고려사항 |
|---|---|---|
| A | Tokyo(`ap-northeast-1`)에 **새 Supabase 프로젝트 신규 생성** | 기존 기준(일본 데이터는 일본 리전)에 부합. 스키마는 `supabase/migrations/` 로 재구축 가능. 기존 일본 사용자 데이터는 복구 불가 |
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

**결과: Tokyo Supabase 프로젝트 `cmfxhehpreanijwanwrr` 는 존재하지 않는다.**

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
