# BUILD_MANIFEST.json — QA/Release 빌드 메타데이터

Build15부터 모든 웹 빌드는 `dist/BUILD_MANIFEST.json`을 생성한다. Analyzer가 Evidence를 어떤 빌드에서 수집했는지 식별하기 위한 표준 입력이다.

## 생성 위치/규칙
- 생성기: `scripts/build-manifest.mjs` (순수 함수 `buildManifest()` + `readBuildNumber()`), `scripts/build-web.mjs`에서 호출.
- **dist 에만** 출력 — root source(`index.html` 등)는 절대 오염시키지 않는다.
- QA 빌드(`QA_BUILD=1`)와 출시 빌드 **모두** 생성하되 값이 다르다.
- `index.html`의 `__QA_BUILD__` 원본 플래그는 빌드와 무관하게 항상 `false`. dist 사본에만 `QA_BUILD=1`일 때 `true` 주입.

## 필드
| 필드 | QA 빌드 | 출시 빌드 |
|------|---------|-----------|
| `product` | `WooriMaru RPS` | 동일 |
| `build` | `project.pbxproj`의 `CURRENT_PROJECT_VERSION` | 동일 |
| `qa_enabled` | `true` | `false` |
| `engine_version` | `v2` | 동일 |
| `branch` / `git_commit` | git에서 추출(실패 시 `unknown`) | 동일 |
| `build_time` | ISO8601 빌드 시각 | 동일 |
| `metrics_schema` | `v1` | 동일 |
| `release_mode` | `qa-testflight` | `release` |
| `source_qa_flag` | 항상 `false` | 항상 `false` |
| `dist_qa_flag` | `true` | `false` |

## 검증
- `tests/build-manifest.test.mjs` — QA/release 값 분기, 필수 필드 존재, git 폴백, build 번호 추출.

## Build15 결과
- 업로드: TestFlight build 15, CFBundleVersion=15, `__QA_BUILD__=true`, manifest `qa_enabled=true`/`release_mode=qa-testflight`.
- ASC state=VALID, Delivery UUID `73bffbe0-de14-4d37-b643-b4e5743accb8`.
