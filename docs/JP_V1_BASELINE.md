# MARU RPS V1.0_JP — Japan Working Baseline

이 문서는 **일본판 Maru RPS 의 작업 기준점을 고정하는 권위 문서**다.
일본 작업을 시작하는 사람은 이 문서를 먼저 읽고, 여기 적힌 브랜치·SHA·리전 외의
값을 추측으로 사용하지 않는다.

## 0. ⚠️ Tokyo Supabase 프로젝트 상태 — 삭제 아님, **INACTIVE(일시정지)**

**2026-08-27 최초 관측 → 같은 날 Management API 로 정정된 항목이다. 정정본이 정확하다.**

| | 최초 관측 (DNS/HTTP) | 정정 (Supabase Management API) |
|---|---|---|
| 관측 사실 | 3개 공용 리졸버 NXDOMAIN, TLS 연결 실패 | `GET /v1/projects` → 프로젝트 **존재** |
| 상태 | — | `status: INACTIVE`, region `ap-northeast-1`, created 2026-05-16 |
| 결론 | ~~삭제됨~~ (**틀린 추론**) | **일시정지(paused)** |

DNS/TLS 관측 자체는 정확했다. 원인 추론이 틀렸다. Supabase 는 **free plan 프로젝트를
미사용 시 자동 일시정지**하며, 일시정지되면 DNS 레코드가 내려간다. NXDOMAIN 은
삭제가 아니라 일시정지의 증상이었다.

```text
org  : wlhfocgtfvkewjxlyzmj ("vincentkoo74-code's Org")  plan = free
  ├─ sannrfmhevebqgfdqcps  maru-rps-production-kr        ap-northeast-2  ACTIVE_HEALTHY
  └─ cmfxhehpreanijwanwrr  vincentkoo74-code's Project   ap-northeast-1  INACTIVE  ← JP
org  : eyyzcftidrdgpubwfber ("Fitflow-app")
  └─ resmnqnqslnftgcdhliu  fitflow-APP                   ap-northeast-1  INACTIVE  (무관 — 손대지 말 것)
```

### 이것이 바꾸는 것

- **기존 일본 데이터가 남아 있을 수 있다.** 일시정지 프로젝트는 복원(restore) 경로가 존재한다.
  삭제되었다면 불가능했을 선택지다. 다만 복원 가능 여부·데이터 잔존 여부는 **미확인**이며
  대시보드 확인이 필요하다.
- **근본 원인은 인프라가 아니라 요금제다.** free plan 은 미사용 프로젝트를 자동 일시정지한다.
  새 JP 프로젝트를 만들어도 출시 전 미사용 기간이 길면 **똑같이 다시 일시정지된다.**
  JP 프로덕션 경계를 실제로 유지하려면 유료 플랜 검토가 필요하다.
- CEO 의 Option A(신규 Tokyo 프로젝트 생성) 승인은 "구 프로젝트는 사라졌다"는 전제 위에서
  내려졌다. 전제가 바뀌었으므로 **재확인이 필요하다** — JP_RELEASE_BACKLOG.md `JP-BL-013`.

### 관측 가능한 증상 (변함 없음)

`npm test` 에서 `tests/build37-a5-home-device-matrix.test.mjs` 가 **600초 타임아웃으로
FAIL** 한다. headless Chrome 이 `index.html` 을 렌더할 때 Supabase 클라이언트가 일시정지된
Tokyo 엔드포인트로 연결을 시도해 페이지가 idle 에 도달하지 못하기 때문이다.

동일 커밋(262ef5d)의 KR HEAD 워크트리에서 같은 테스트는 **73초에 16/16 PASS** 한다.
이 실패는 코드 회귀가 아니라 **백엔드 부재의 증상**이며, 유효한 엔드포인트가 복구되면
해소된다. 테스트를 약화시켜 우회하지 않는다.

---

## 1. 권위 브랜치 (Authoritative branch)

```text
repository : product-builder-lecture (github.com/vincentkoo74-code/product-builder-lecture)
branch     : feature/rps-jp-line-miniapp
forked from: 262ef5d2230f0a6380be34c78db7b6cde9861e20
             chore(kr-v1): bump build metadata to Build37 (2026-08-27)
             = fix/replay-force-start-and-confirmed-ids 의 HEAD
strategy   : ② KR 최신 HEAD 에서 분기 후 백엔드 상수만 Tokyo 로 전환 (CEO 승인 2026-08-27)
```

이 브랜치가 **일본판의 단일 작업 위치**다. 다른 곳에서 일본 작업을 시작하지 않는다.

### 왜 KR HEAD 에서 분기했는가

`c452b11` (마지막 Tokyo 설정 커밋, 2026-08-08) 에서 분기하면 Tokyo 설정은 그대로
얻지만 2026-08-08 ~ 08-27 사이의 KR 안정화 커밋 19개(리플레이/호스트 승계/카운트다운
동기화/계정 통계 권한 등)를 통째로 잃는다. 게임 로직 안정성이 국가와 무관한 공통 자산
이므로, **최신 안정성을 취하고 백엔드 지정만 되돌리는 쪽**을 택했다.

## 2. 역사적 기준점 (Historical baseline — 참조 전용)

```text
c452b11d0fec8a4bf60e1c618997497de6e19cf7
chore(WRPS-084): track leave_after_round migration (2026-08-08)
```

`index.html` 이 Tokyo Supabase 를 가리키던 **마지막 커밋**이다.
그 다음 커밋 `92ae7af feat(kr-v1): route KR client to Seoul Supabase` 에서 KR 로 전환됐다.

이 SHA 의 용도는 **오직 역사적 참조**다.
- Tokyo anon key 등 JP 자격증명의 원출처
- KR/JP 분기점(merge-base) 증적

여기서 새 브랜치를 만들거나 여기로 되돌리지 않는다.

## 3. 리전 구조

| | KR | JP |
|---|---|---|
| 제품 버전 | V1.0_KR | V1.0_JP |
| Supabase project ref | `sannrfmhevebqgfdqcps` | `cmfxhehpreanijwanwrr` |
| 리전 | AWS `ap-northeast-2` (Seoul) | AWS `ap-northeast-1` (Tokyo) |
| 주 로그인 | Kakao + Apple + Guest | LINE 중심 (Phase 2) + Apple + Guest |
| 매치메이킹 풀 | KR | JP |
| 크로스매칭 | **금지** | **금지** |

기계가 읽는 단일 기준은 문서가 아니라 다음 두 파일이다.

- `config/regions.json` — 국가별 백엔드/공개 식별자 레지스트리 (키 원문 미보관, SHA-256 지문만)
- `config/active-region.json` — **이 브랜치가 빌드하는 국가 선언**

설계 근거와 운영 규칙은 [KR_JP_CONFIG_SEPARATION.md](KR_JP_CONFIG_SEPARATION.md) 참조.

## 4. 이 브랜치의 현재 상태

### 완료

- `index.html` 의 `SUPABASE_URL` / `SUPABASE_ANON_KEY` → Tokyo 전환
- `config/regions.json`, `config/active-region.json` 신설 (region = **JP**)
- `scripts/region-guard.mjs` — fail-closed 리전 오염 가드 (R1~R6)
- `npm run build:web` 이 빌드마다 가드를 실행하고 `BUILD_MANIFEST.json` 에 국가 스탬프를 찍는다
- `tests/jp-region-isolation.test.mjs` — 24개 계약 테스트
- Tokyo 자동 배포 경로 제거 (아래 5절)

### 미완료 — Phase 2 이후

- **LINE 로그인은 여전히 `ENABLE_LINE_LOGIN = false`** 로 잠겨 있다.
  이 단계는 baseline/안전화 작업이며 LINE/LIFF 기능 구현은 포함하지 않는다.
- LIFF SDK / LINE MINI App 전환 — 착수 전 (repo 내 `liff` 키워드 0건)
- Kakao 경로가 JP 빌드에 상속되어 있다 → `JPX-001` 로 유예 중
- 네이티브 산출물(`ios/`, `android/` 의 `public/`)은 여전히 KR Build37 산출물이다
- **JP 백엔드가 존재하지 않는다** (0절) — 실행 가능한 일본 빌드를 만들 수 없다

### 알려진 가드 FAIL (의도된 상태)

`npm run guard:region` 은 **현재 의도적으로 FAIL 한다.**

```text
ERROR [R1/R2/R3] ios, android  — 네이티브 public 자산이 아직 KR Build37 산출물
ERROR [R6] ios:manifest, android:manifest — 국가 스탬프 없음
```

이는 가드가 정상 동작한다는 증거다. `npm run build:web && npx cap sync` 로
네이티브 계층을 재생성하면 해소된다. **JP 빌드를 만들기 전에 반드시 재생성할 것.**
`source` / `dist` 계층은 이미 PASS 한다.

## 5. Tokyo 프로덕션 보호

이 단계에서 **Tokyo 백엔드는 일절 변경하지 않았다.** 변경한 것은 "어떻게 배포되는가"뿐이다.
(0절에서 밝혔듯 Tokyo 프로젝트는 이미 존재하지 않으므로 변경할 대상 자체가 없었다.
아래 조치는 그럼에도 유효하다 — KR 포함 **모든** 국가의 프로덕션에 적용되는 안전장치이며,
새 JP 백엔드가 생기면 그대로 보호한다.)

| 제거한 위험 | 조치 |
|---|---|
| `supabase-deploy.yml` 이 `main` push 로 Tokyo 에 자동 배포 | 자동 트리거 전면 삭제. `workflow_dispatch` 전용 |
| project ref 하드코딩 | `config/regions.json` 에서 도출 |
| 오배포 | 대상 project ref 를 그대로 타이핑해야 진행 |
| 브랜치/대상 불일치 | 브랜치의 `active-region.json` 과 배포 대상이 다르면 중단 |
| 승인 게이트 부재 | `environment: supabase-<REGION>` 지정 (**GitHub Settings > Environments 에서 required reviewers 를 걸어야 실효** — 미설정 시 게이트 없음) |
| `supabase/.temp/project-ref` 가 git 추적 | 추적 해제 + `.gitignore` |
| smoke 테스트가 Tokyo 하드코딩 | 리전 레지스트리에서 도출 (읽기 전용 유지) |

## 6. 다음 사람이 해야 할 일

1. **JP 백엔드 확보 방침 결정 (JP-BL-013) — 다른 모든 일본 작업의 선행 조건**
2. 이 브랜치를 `origin` 에 push (현재 로컬 전용 — 유실 위험)
3. GitHub Settings > Environments 에서 `supabase-KR` / `supabase-JP` 에 required reviewers 설정
4. LINE MINI App / LIFF 요구사항 조사 → Phase 2 설계

미해결 항목은 [JP_RELEASE_BACKLOG.md](JP_RELEASE_BACKLOG.md) 에서 추적한다.
