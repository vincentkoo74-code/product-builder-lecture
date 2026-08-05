# Build32 — WRPS-083 2B Room Destroy 실기기 QA 계획

> **STATUS: Build32 TestFlight VALID — 실기기 QA 미실시**
> 작성일 2026-08-06
>
> | 항목 | 값 |
> |---|---|
> | TestFlight build | **32** (`processingState = VALID`, expired=false) |
> | 업로드 | 2026-08-05T16:24:19-07:00 · Delivery UUID `8222d79f-9343-433a-a39d-39e7bea547ec` |
> | metadata commit | **`87e9db86001703b490604ace8e894dc7bd494d5f`** (`chore: prepare Build32 QA metadata`) |
> | 코드 기준 커밋 | `7aaa627974410195bd863fa6b8e6d07a6cecc2db` (WRPS-083 2B) |
> | branch | `fix/replay-force-start-and-confirmed-ids` |
> | `qa_enabled` | **true** (`release_mode = qa-testflight`, `__QA_BUILD__ = true`) |
> | `QA_BUILD_LABEL` | **`build32`** (build30 고정 문제 정정됨) |
> | CFBundleVersion / ShortVersion | **32** / 1.0 (marketing version 무변경) |
> | bundle id | `com.yeongjookoo.woorimaru.rps` |
>
> **Build32는 WRPS-083 1단계·2A·2B 전체의 첫 실기기 검증본이다.** Build31에는 세 단계 모두
> 포함되지 않았으므로(§0), 이번 QA는 2B만이 아니라 host 승계 안전화(1단계)와 WAITING 분리(2A)도
> 실기기에서 처음 돌아가는 것을 함께 관측한다.

---

## 0. 전제 — Build31로는 이 QA를 수행할 수 없다

| 항목 | 값 |
|---|---|
| Build31 아카이브 | `build/App-build31.xcarchive` |
| Build31 `git_commit` | **`0ba1e82145e43666d7b43dc0a9d291d9a319572c`** |
| Build31 `build_time` | 2026-08-03T05:09:00.165Z |
| Build31 `qa_enabled` | `true` (release_mode `qa-testflight`) |

`0ba1e82`는 WRPS-083 **1단계·2A·2B 전부보다 앞선다.** 아카이브 내부 `index.html`을 직접 검사한 결과:

| 함수 | Build31 내 출현 수 |
|---|---|
| `pickDeterministicHostCandidate` (1단계) | **0** |
| `getWaitingPlayers` (2A) | **0** |
| `isRoomClosingOrDestroyed` (2B) | **0** |
| `teardownRoomRuntime` (2B) | **0** |
| `destroyRoomByHost` (2B) | **0** |

→ **Build32 생성이 필수 선행 조건이다.** Build31 기기에서는 나가기 팝업에 "방 종료" 자체가 존재하지 않는다.

---

## 1. 환경 기록표

QA 시작 전 각 기기에서 기록한다. **하나라도 비면 HOLD.**

| 항목 | Device A (Host) | Device B | Device C | Device D (선택) |
|---|---|---|---|---|
| app build (설정 화면) | | | | |
| QA manifest `build` | | | | |
| QA manifest `git_commit` | | | | |
| QA manifest `qa_enabled` | | | | |
| device model | | | | |
| OS version | | | | |
| network type | Wi-Fi | Wi-Fi | LTE/5G | 저속/백그라운드 |
| roomCode | | | | |
| participantId | | | | |
| initial role | host | participant | participant | participant |

**필수 일치 조건** (Build32 실측값 기준)
- 4대 전부 `build == 32`
- 4대 전부 `git_commit == 87e9db86001703b490604ace8e894dc7bd494d5f`
  (metadata 커밋. WRPS-083 2B 코드는 그 부모 `7aaa627`에서 들어왔고 `87e9db8`은 build number와
  QA 라벨만 바꿨다 — 즉 이 SHA가 곧 2B 코드 포함본이다)
- 4대 전부 `qa_enabled == true`
- 하나라도 불일치 → **HOLD**(§9)

---

## 2. 기기 구성

**최소 3대**
- Device A — 현재 Host, Wi-Fi
- Device B — 참가자, Wi-Fi
- Device C — 참가자, LTE/5G

**권장 4대**
- Device D — 저속 네트워크 또는 백그라운드/복귀 검증용 (QA-2B-04 전용)

동일 TestFlight Build32를 사용한다. 혼합 빌드는 금지 — 2B는 종료 전파가 핵심이라 구버전 단말이 섞이면 결과 해석이 불가능하다.

---

## 3. 시나리오

### QA-2B-01 취소

1. 비진행 상태(대기실/게임 종료 후)에서 Host가 나가기 선택
2. `hostLeavePopup`에 **3버튼**(호스트 넘기기 / 방 종료 / 취소) 노출 확인
3. 취소 선택

**PASS** — DB write 0 · role 변화 0 · room status 변화 0 · 3단말 모두 화면 변화 0
**증거** — QA JSON에 `ROOM_DESTROY*` 이벤트 0건

---

### QA-2B-02 Host 넘기기

1. Host A → B 넘기기
2. B가 새 Host로 확정
3. A 퇴장
4. 남은 참가자로 게임 진행

**PASS**
- roomCode 유지
- Host exactly one (B만 `👑` 표시)
- A에게 Host 전용 기능 0 (게임 시작 / 강제 시작 / 한번더 / 벌칙 설정 / 방 종료 버튼 모두 부재)
- `ROOM_DESTROYED*` 이벤트 **0건**
- 기존 전적 유지(§5)
- 다음 라운드 또는 게임 정상 진행

**증거** — `HOST_EXACTLY_ONE_VIOLATION` 0건 · B 단말 스크린샷 · A 단말 스크린샷

---

### QA-2B-03 방 종료

1. Host가 "방 종료" 선택
2. 확인 팝업 승인
3. A/B/C 화면 관찰

**PASS**
- Host 단말 종료 안내 후 홈 이동
- B/C 단말 **동일 종료 안내** 후 홈 이동
- 종료 후 어느 단말에도 방 화면 잔존 0
- Host 자동 복구 0 (`HOST_AUTO_PROMOTED` 0건)
- status가 waiting/ready/playing으로 부활 0

**증거** — 3단말 화면 녹화 · `ROOM_DESTROYED_BY_HOST`(A) · `ROOM_DESTROYED_RECEIVED`(B/C)

---

### QA-2B-04 느린 단말 종료 수렴

1. Device C를 백그라운드 전환 또는 저속 네트워크로 전환
2. Host가 방 종료
3. C를 포그라운드 복귀

**PASS**
- C가 destroyed 수신 (`ROOM_DESTROYED_RECEIVED`)
- §6 허용 지연 안에 홈 이동
- 이전 게임 화면 재개 0
- C의 DB write 0

---

### QA-2B-05 재입장 차단

방 종료 후 **모든 기기**에서 5경로를 시도한다.

| # | 경로 | 기대 |
|---|---|---|
| a | roomCode 수동 입력 | 차단 + 종료 안내 |
| b | 최근 방 재입장(홈 최근방 카드) | 차단 |
| c | 초대 링크 / QR | 차단 |
| d | replay(재초대) | 차단 |
| e | 앱 완전 종료 후 재실행 | 종료된 방 복원 0 |

**PASS** — 5경로 전부 차단. **Host였던 사용자도 동일하게 차단**(과거 Host 이력이 우회 근거가 되지 않음). returning participant 우회 0.

---

### QA-2B-06 destroy 더블탭

Host가 방 종료 확인 버튼을 빠르게 2회 누른다.

**PASS**
- `rooms` destroyed write **1회**
- participants cleanup 중복 실행 0
- 중복 토스트 / 중복 화면 이동 0
- crash 0

**증거** — QA JSON의 `ROOM_DESTROYED_BY_HOST` 정확히 1건

---

### QA-2B-07 transfer / destroy 경합

**순서 ①** 호스트 넘기기 시작 → 거의 동시에 방 종료 시도
**순서 ②** 방 종료 시작 → 거의 동시에 호스트 넘기기 시도

**PASS (양방향 공통)**
- 둘 중 **하나만** 실행
- Host 0명 상태 0
- Host 2명 상태 0
- destroyed 이후 transfer 0
- transfer 성공 후 stale Host의 destroy 0

---

### QA-2B-08 stale Host UI

1. A → B Host 승계
2. A 단말에 과거 Host UI가 잠시 남는 조건 유도(승계 직후 A를 즉시 백그라운드 → 복귀, 또는 네트워크 순단)
3. A가 방 종료 시도

**PASS**
- `rooms` write 0
- `participants` delete 0
- A의 role이 participant로 정정
- B가 Host 유지
- 방 유지

**증거** — A 단말 QA JSON에 `ROOM_DESTROY_UNAUTHORIZED` 1건

---

### QA-2B-09 participants cleanup 실패 내성 — **실기기 미수행**

**주입 수단 read-only 조사 결과: 사용 가능한 hook이 없다.**
- `b8debug`(`index.html:13543`)는 **표시 전용 디버그 진입점**이며 DB 실패 주입 기능이 없다.
- `window.__qaMetrics`(`:9419`)는 QA 리포트 접근자일 뿐 write 실패를 주입하지 못한다.
- Supabase 실패를 실기기에서 억지로 만들려면 네트워크 차단 등 비결정적 수단이 필요하고, 이는 다른 write까지 오염시켜 관측을 무의미하게 만든다.

→ **자동 테스트 증거로 대체한다.** `tests/room-destroy-stage2b.test.mjs`
- **D7/D35** — participants delete 실패 시 tombstone 유지 + 로컬 종료 계속
- **N19** — cleanup 실패 시 로컬 종료를 중단하는 mutant가 RED

---

### QA-2B-10 roomCode 충돌 — **실기기 미수행**

4자 코드 충돌은 현재 밀도(운영 365방 / 36⁴)에서 1회당 ≈ 2.2e-4라 실기기 재현이 비현실적이다.

→ **자동 테스트 + metric 존재로 검증한다.**
- **D40** — PK 충돌 시 새 코드 재생성
- **D41 / N14** — 5회 연속 충돌 시 명시적 실패, 오프라인 폴백 0
- **PK 외 오류** — 즉시 실패(재시도 예산 미소진)
- metric 소스 존재 확인: `ROOM_CODE_COLLISION`(`index.html:6683`), `ROOM_CODE_EXHAUSTED`(`:6691`)

---

## 4. 기기별 관찰표

시나리오마다 3~4대 전부에 대해 채운다.

| 시나리오 | 기기 | 관찰 화면 | role 변화 | room status 변화 | QA event | PASS/FAIL |
|---|---|---|---|---|---|---|
| QA-2B-01 | A / B / C | | | | | |
| QA-2B-02 | A / B / C | | | | | |
| QA-2B-03 | A / B / C | | | | | |
| QA-2B-04 | C (+D) | | | | | |
| QA-2B-05 | A / B / C | | | | | |
| QA-2B-06 | A | | | | | |
| QA-2B-07① | A / B | | | | | |
| QA-2B-07② | A / B | | | | | |
| QA-2B-08 | A / B | | | | | |

---

## 5. 전적 보존 기록표

**방 종료 직전 스냅샷 → 종료 직후 재확인.**

| 항목 | 종료 전 | 종료 후 | 확인 수단 | 동일? |
|---|---|---|---|---|
| wins / losses / draws (참가자별) | | | 앱 통계 화면 + QA JSON | |
| 완료된 round 수 | | | 결과/통계 화면 | |
| `user_game_history` | | | 계정 전적 화면(로그인 시) | |
| account stats | | | 계정 통계 팝업 | |
| room stats archive | | | 방 누적 통계 팝업 | |
| gameNo | | | QA JSON `gameNo` | |

**PASS**
- 완료 전적 동일
- history 삭제 0
- gameNo 임의 증가 0
- 미완료 라운드가 완료 결과로 기록되지 않음

**증거 구분 필수**
- **실기기 직접 확인 가능** — 앱 통계 화면 / 계정 전적 / QA JSON
- **실기기 직접 확인 불가(DB 접근 필요)** — `user_game_history` 행 수준 검증 → 자동 테스트 **D39**(완료 전적 스냅샷 동일)와 코드 근거(`destroyRoomByHost`의 write는 `rooms.update` + `participants.delete` 2개뿐)로 보고한다. **두 증거를 섞어 쓰지 않는다.**

---

## 6. 종료 수렴 시간 기록표

| 이벤트 | 시각 | Δ (Host 확정 기준) | 수렴 경로 |
|---|---|---|---|
| Host destroy 확정(확인 팝업 승인) | | 0 | — |
| Host 홈 이동 | | | 로컬 |
| B 홈 이동 | | | realtime / polling / self-heal |
| C 홈 이동 | | | realtime / polling / self-heal |
| D 홈 이동(있으면) | | | realtime / polling / self-heal |

**수렴 경로 구분**
- **realtime** — 체감상 즉시(1초 이내)
- **polling fallback** — 2.6초 주기 내
- **stale self-heal 이후** — 최대 5회 폴링(≈13초)

**판정**
- ≤ 2.6초 → 정상
- ≤ 13초 → 허용(경로를 기록할 것)
- **> 13초 → FAIL 또는 HOLD**

> 자동 테스트 **D42**가 로컬 gameRound 선행 단말의 지연 상한을 self-heal 임계(5폴링)로 고정한다. 실기기에서 13초 초과가 나오면 자동 테스트가 잡지 못한 새 경로다.

---

## 7. FAIL 증상 (하나라도 발생 시 즉시 FAIL)

- 한 단말만 방에 남음
- Host 없는 방이 유지됨
- Host가 두 명으로 보임
- destroyed 후 waiting/ready/playing 복귀
- 이전 Host가 Host 권한을 다시 얻음
- 재입장 성공
- replay / invite 성공
- 앱 재실행 후 종료된 방 복원
- 완료 전적 손실
- 새 방 생성 전 기존 roomCode 재사용
- crash
- 무한 loading
- 13초 초과 종료 지연

---

## 8. QA 증거

기기별 수집 항목
- QA JSON (export)
- 화면 녹화 (시나리오 단위)
- 방 종료 직전/직후 스크린샷
- role 변화 / room status 변화 기록
- Host 변경 이벤트
- `ROOM_DESTROY*` QA event
- stale / self-heal 이벤트
- DB call sequence(노출되는 범위에서)

**관측해야 할 QA event 전수** (`index.html` 실측)

| eventType | 위치 | 의미 |
|---|---|---|
| `ROOM_DESTROYED_BY_HOST` | `:11392` | Host 종료 성공 |
| `ROOM_DESTROYED_RECEIVED` | `:5986` | 타 단말 destroyed 수신 |
| `ROOM_DESTROY_UNAUTHORIZED` | `:11339` | stale/과거 Host 차단 (QA-2B-08) |
| `ROOM_DESTROY_WRITE_FAILED` | `:11349`, `:11358` | rooms write/preSelect 실패 |
| `ROOM_DESTROY_VERIFY_FAILED` | `:11369` | SELECT 재검증 실패 |
| `ROOM_DESTROY_ARCHIVE_FAILED` | `:11382` | 전적 스냅샷 실패(비치명) |
| `ROOM_DESTROY_CLEANUP_FAILED` | `:11390` | participants 정리 실패(비치명) |
| `ROOM_DESTROYED` | `:11192` | 혼자 남은 방 자동 종료 |
| `ROOM_CODE_COLLISION` / `ROOM_CODE_EXHAUSTED` | `:6683` / `:6691` | roomCode 재생성 (QA-2B-10) |

**저장 규칙**
- `QA-index/`에 저장하고 **커밋하지 않는다**
- 파일명에 실제 build와 device를 포함한다

```
QA-index/BUILD32_WRPS083_2B_HOST_IPHONE11.json
QA-index/BUILD32_WRPS083_2B_PARTICIPANT_A.json
QA-index/BUILD32_WRPS083_2B_PARTICIPANT_B.json
```

---

## 9. PASS / HOLD / FAIL 판정표

| 판정 | 조건 |
|---|---|
| **PASS** | QA-2B-01~08 전부 PASS · 재입장 차단 5경로 전부 PASS · 종료 수렴 ≤13초 · Host exactly-one 유지 · 방 부활 0 · 전적 손실 0 · crash 0 |
| **HOLD** | 필수 증거 부족 · 시나리오 1개 이상 UNTESTED · QA metadata/build 불일치 · 일부 기기 JSON 누락 |
| **FAIL** | 방 부활 · Host 0명/2명 · stale Host destroy 성공 · 재입장 성공 · 전적 손실 · crash · 13초 초과 영구 정지 |

### 최종 판정

| 시나리오 | 판정 | 비고 |
|---|---|---|
| QA-2B-01 취소 | | |
| QA-2B-02 Host 넘기기 | | |
| QA-2B-03 방 종료 | | |
| QA-2B-04 느린 단말 수렴 | | |
| QA-2B-05 재입장 차단 | | |
| QA-2B-06 더블탭 | | |
| QA-2B-07 transfer/destroy 경합 | | |
| QA-2B-08 stale Host UI | | |
| QA-2B-09 cleanup 실패 내성 | **자동 테스트 대체** | D7/D35, N19 |
| QA-2B-10 roomCode 충돌 | **자동 테스트 대체** | D40/D41, N14 |
| 전적 보존 | | |
| 종료 수렴 시간 | | |

**종합 판정**: ☐ PASS ☐ HOLD ☐ FAIL

---

## 10. QA JSON 파일 목록

| 기기 | 파일명 | 수집 여부 |
|---|---|---|
| A (Host) | `BUILD32_WRPS083_2B_HOST_<MODEL>.json` | ☐ |
| B | `BUILD32_WRPS083_2B_PARTICIPANT_A.json` | ☐ |
| C | `BUILD32_WRPS083_2B_PARTICIPANT_B.json` | ☐ |
| D (선택) | `BUILD32_WRPS083_2B_PARTICIPANT_C.json` | ☐ |

---

## 11. 최종 승인 서명란

| 역할 | 이름 | 판정 | 서명 | 일자 |
|---|---|---|---|---|
| QA 실행자 | | | | |
| 검증자(codex-critic) | | | | |
| 최종 승인(CEO) | | | | |

**승인 조건**: 종합 판정 PASS + CRITICAL/HIGH 0.

---

## 부록 A — Build32 생성 실행 기록 (완료)

| # | 단계 | 실행 내용 | 결과 |
|---|---|---|---|
| 1 | build number bump | `project.pbxproj` `CURRENT_PROJECT_VERSION` 31→32 (2곳: L365, L390) | ✅ MARKETING_VERSION 1.0 무변경 |
| 2 | QA 라벨 정정 | `index.html:9290` `'build30'` → `'build32'` | ✅ 매칭 1곳, 실행 코드 변경 0 |
| — | metadata 커밋 | `chore: prepare Build32 QA metadata` | ✅ `87e9db8`, 2 files, +3/−3 |
| 3 | web 빌드 | `QA_BUILD=1 npm run build:web` | ✅ `__QA_BUILD__=true` 치환 |
| 4 | manifest 검증 | `dist/BUILD_MANIFEST.json` | ✅ 6항목 전부 통과(아래) |
| 5 | cap sync | `npx cap sync ios` | ✅ 2.6s, plugin 5개 |
| 6 | archive | `xcodebuild archive` | ✅ **ARCHIVE SUCCEEDED** · `build/App-build32.xcarchive` |
| 7a | export | `xcodebuild -exportArchive` | ✅ **EXPORT SUCCEEDED** · IPA 50,082,328 bytes |
| 7b | validate | `altool --validate-app` | ✅ **VERIFY SUCCEEDED** (warning 1: MinimumOSVersion 14.0) |
| 8 | upload | `altool --upload-app` | ✅ **UPLOAD SUCCEEDED** · UUID `8222d79f-9343-433a-a39d-39e7bea547ec` |
| 9 | TestFlight 상태 | ASC API 조회 | ✅ **build 32 processingState=VALID** |
| 10 | 자동 증가 재확인 | pbxproj / archive / TestFlight | ✅ 셋 다 **32** — 자동 증가 없음, pbxproj 무오염 |

**manifest 검증 6항목** — `build==32` · `qa_enabled==true` · `git_commit==87e9db8…`(metadata 커밋 일치) · `release_mode=="qa-testflight"` · `source_qa_flag==false` · `dist_qa_flag==true`

**IPA 내부 검증** — `CFBundleVersion=32` · `CFBundleShortVersionString=1.0` · `CFBundleIdentifier=com.yeongjookoo.woorimaru.rps` · `__QA_BUILD__=true` · `QA_BUILD_LABEL='build32'` · 2B 코드 포함(`destroyRoomByHost`×3, `isRoomClosingOrDestroyed`×19, `teardownRoomRuntime`×6, `getWaitingPlayers`×3, `pickDeterministicHostCandidate`×6)

**export 빌드번호 자동증가 함정 — 해소 확인**: `build/ExportOptions-AppStore.plist`에 `manageAppVersionAndBuildNumber` 키가 없어 자동 증가가 발생하지 않았다. pbxproj·archive·TestFlight 세 지점 모두 32로 일치한다.

**잔여 경고(비차단)**: `MinimumOSVersion 14.0` — 2027년 봄부터 15.0 이상이 요구된다. 이번 QA 범위 밖이나 출시 전 처리 대상으로 기록한다.

---

## 부록 B — QA 계측 상태

| 항목 | 값 | 근거 |
|---|---|---|
| 소스 기본값 | `__QA_BUILD__ = false` | `index.html:9164` |
| QA 빌드 치환 | `QA_BUILD=1` → dist에서만 `true` | `scripts/build-web.mjs:32-41` |
| 런타임 ON 조건 | `__QA_BUILD__` ∥ `?qa=1` ∥ `localStorage.rpsQA==='1'` ∥ `rpsDebugMode==='1'` | `index.html:9166-9173` |
| Build31 실측 | `qa_enabled: true` | Build31 manifest |

→ **Build32도 `QA_BUILD=1`로 만들어 계측을 ON으로 유지해야 한다.** OFF면 `ROOM_DESTROY*` 이벤트가 전혀 수집되지 않아 §8 증거 요건을 충족할 수 없다.

**QA 비간섭성**: `QA.emit`은 동기·state 읽기 전용이고 방 종료 경로는 기존 QA 래퍼(`leaveRoom`/`leaveRoomForce`/`endGame`) 목록에 **얹지 않았다**(`window.destroyRoomByHost` 별도 전역). 자동 테스트 D26이 QA ON/OFF에서 DB call sequence 동일함을 검증한다.

---

## 부록 C — 자동 테스트로 대체된 항목

실기기 재현이 불가능하거나 비결정적이라 자동 테스트 증거로 대체한 항목이다. **실기기 PASS와 구분해 보고한다.**

| 항목 | 대체 근거 | 테스트 |
|---|---|---|
| participants cleanup 실패 내성 | 주입 hook 부재 | D7 / D35 / N19 |
| roomCode PK 충돌 | 재현 확률 ≈2.2e-4 | D40 / D41 / N14 |
| `user_game_history` 행 수준 보존 | 실기기 DB 접근 불가 | D39 + 코드 근거(write 2개뿐) |
| teardown 후 13초 타이머 무write | 실기기 타이머 관측 불가 | D18 / D36 / N10 / N10b |
| stale gate 지연 상한 | 로컬 gameRound 선행 조건 유도 곤란 | D42 |
