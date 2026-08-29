# known-red — 의도적 RED 스위트 (릴리즈 회귀에서 제외)

이 디렉터리의 `*.red.mjs` 는 **아직 수정하지 않기로 결정된 결함**을 결정론적으로 재현한다.
파일명이 `*.test.mjs` 가 아니므로 `npm test`(vitest 기본 include) 에 잡히지 않는다.

| 파일 | 결함 | 상태 | 기대 결과 |
|---|---|---|---|
| `build39-m1-choice-write-clobber.red.mjs` | 참가자 선택 write 가 확정 결과 인코딩(`rock\|lose`)을 `paper` 로 덮어씀 | 수정 보류 (Build39 필드 미관측) | 2 failed / 3 passed |
| `build39-m2-host-result-row-errors.red.mjs` | host per-row 결과 write 실패에도 status=result 전이 | 수정 보류 (Build39 필드 미관측) | 2 failed / 2 passed |

실행: `npm run test:known-red` — 위 기대 결과와 다르면(RED 가 GREEN 이 되거나 카운트가 바뀌면)
누군가 결함을 고쳤거나 하네스가 깨진 것이다. 어느 쪽이든 보고 대상.

수정이 승인돼 GREEN 이 되면 `tests/` 로 옮기고 `.test.mjs` 로 되돌린다.
