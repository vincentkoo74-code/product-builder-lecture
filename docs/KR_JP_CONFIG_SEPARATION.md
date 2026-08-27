# KR / JP Configuration Separation — 설계

일본판 분기(V1.0_JP) 에 맞춰 국가별 백엔드·자격증명 분리를 설계·구현한 문서다.
구현체는 `config/`, `scripts/region-guard.mjs`, `tests/jp-region-isolation.test.mjs` 다.

## 1. 해결하려는 문제

분기 이전의 국가 분리는 **사람의 주의력에만 의존**했다.

- 백엔드 선택이 806KB `index.html` 안의 하드코딩 상수 2개(`SUPABASE_URL`, `SUPABASE_ANON_KEY`)
- 그 상수가 source → `dist/` → `ios/.../public/` + `android/.../public/` 3계층으로 **수동 복제**
- 어느 계층 하나만 갱신되지 않아도 "한국 앱이 일본 백엔드에 쓰는" 사고가 조용히 발생
- 검증 수단은 릴리즈 때 사람이 grep 하는 것뿐 (`docs/BUILD33_KR_V1_BLOCKER_STATUS.md` 참조)

KR↔JP 크로스매칭 금지는 사업상 **hard requirement** 인데, 이를 강제하는 코드가 없었다.

## 2. 설계 원칙

1. **선언 우선** — 브랜치가 어느 국가를 빌드하는지 파일로 선언한다. 추론하지 않는다.
2. **단일 기준(single source of truth)** — 국가별 값은 한 곳에만 적고, 코드·CI·테스트가 모두 그 파일을 읽는다.
3. **Fail-closed** — 판정이 불확실하면 통과가 아니라 중단이다.
4. **키 원문 미보관** — 레지스트리는 anon key 원문을 담지 않고 SHA-256 지문만 담는다.
5. **유예는 기록된 예외로만** — 임시 통과는 ID·사유·해소 계획·릴리즈 차단 여부를 남긴다.

## 3. 구조

```text
config/regions.json         국가별 프로필 레지스트리 (KR, JP)
                            ref / 리전 / anon key 지문 / Edge Function / provider 정책
                            / 공개 client id / 매치메이킹 풀
config/active-region.json   이 브랜치가 빌드하는 국가 선언 + known_exceptions
scripts/region-guard.mjs    R1~R6 검사기 (순수 함수 + CLI)
```

**국가 전환 = `active-region.json` 의 `region` 한 줄 변경.** 이는 CEO 승인 사항이다.

### 왜 환경변수가 아니라 파일인가

이 프로젝트는 Vite 같은 env 주입 빌드가 없고, 산출물이 3계층으로 복제된다.
환경변수는 빌드 시점에만 존재해 **산출물에 남지 않으므로 사후 검증이 불가능**하다.
파일 선언 + 산출물 스탬프(`BUILD_MANIFEST.json`) 조합이라야
"이 ipa 는 어느 나라 빌드인가"를 나중에도 확인할 수 있다.

## 4. 검사 규칙

| 규칙 | 내용 | 유예 |
|---|---|---|
| R1 | `SUPABASE_URL` 이 선언 리전의 project ref 를 가리키는가 | 불가 |
| R2 | `SUPABASE_ANON_KEY` 의 SHA-256 지문이 선언 리전과 일치하는가 | 불가 |
| R3 | 타 리전의 project ref 가 산출물에 섞여 있지 않은가 | 불가 |
| R4 | 타 리전의 공개 client id 가 섞여 있지 않은가 | `known_exceptions` |
| R5 | 클라이언트 계층에 `service_role` JWT 가 없는가 | **불가** |
| R6 | 산출물의 `BUILD_MANIFEST.json` 국가 스탬프가 선언 리전과 일치하는가 | 불가 |

검사 계층: `source`, `dist`, `ios`, `android`, 각 계층의 `BUILD_MANIFEST.json`, `.github/workflows/*.yml`.

R5 는 anon key 와 service_role key 가 육안으로 구분되지 않는다는 점(둘 다 `eyJ...` JWT)을
겨냥한다. JWT payload 의 `role` 클레임을 디코드해 판정하므로 눈으로 놓치는 유출을 잡는다.

R6 는 **브랜치 전환 footgun** 을 겨냥한다. `ios/.../public/` 은 git 미추적 산출물이라
KR 브랜치에서 만든 자산이 JP 브랜치 체크아웃 후에도 그대로 남는다. 국가 스탬프가
없으면 그 상태로 Xcode 빌드가 나가버린다.

## 5. 강제 지점

| 지점 | 동작 |
|---|---|
| `npm run build:web` | `source` + `dist` 계층 검사. 위반 시 **빌드 중단** |
| `npm run guard:region` | 전 계층(네이티브·CI 포함) 검사. 위반 시 exit 1 |
| `npm test` | `tests/jp-region-isolation.test.mjs` 24개 계약 테스트 |
| `supabase-deploy.yml` | 브랜치 선언 리전 ≠ 배포 대상이면 배포 중단 |

## 6. 현재 유예 중인 예외

| ID | 항목 | 사유 | 해소 | 릴리즈 차단 |
|---|---|---|---|---|
| JPX-001 | `KAKAO_REST_API_KEY` 가 JP 빌드에 상속 | KR HEAD 분기로 상속된 KR 전용 공개 REST 키 | Phase 2 로그인 작업에서 JP 빌드의 Kakao 경로 제거 | **예** |

`blocks_release: true` 이므로 이 예외가 남아 있는 한 JP 출시 빌드를 승인하지 않는다.

## 7. KR 브랜치 백포트

이 메커니즘은 현재 **JP 브랜치에만** 있다. KR 브랜치는 여전히 가드가 없다.

백포트 절차:
1. `config/`, `scripts/region-guard.mjs`, `tests/jp-region-isolation.test.mjs`,
   `scripts/build-web.mjs`/`build-manifest.mjs` 변경분, 워크플로 2종을 KR 브랜치로 가져온다
2. `config/active-region.json` 의 `region` 을 `"KR"` 로 바꾼다
3. 테스트의 JP 고정 단언(`[JP-ISO-1]`, `[JP-ISO-2]`)을 리전 중립으로 일반화한다
4. `known_exceptions` 에 KR 쪽 항목(`LINE_CHANNEL_ID` 상속)을 등록한다

추적: `JP_RELEASE_BACKLOG.md` JP-BL-001.

## 8. 한계 (정직하게)

- 이 가드는 **빌드 산출물의 정적 검사**다. 런타임에 사용자를 잘못된 풀에 넣는 것은
  막지 못한다. 서버측 매치메이킹 리전 검증은 별도 과제다 (JP-BL-005).
- 네이티브 계층 검사는 `public/index.html` 이 디스크에 존재할 때만 동작한다.
  Xcode 가 다른 경로에서 빌드하면 검사를 우회한다.
- `config/regions.json` 의 지문은 현재 두 리전의 anon key 로 생성됐다. 키가 rotate 되면
  지문을 갱신해야 하며, 갱신을 잊으면 R2 가 false positive 를 낸다 (fail-closed 이므로 안전한 방향).
