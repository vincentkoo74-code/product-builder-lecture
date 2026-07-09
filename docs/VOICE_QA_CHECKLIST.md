# 🎙️ 한국어 녹음 음성 적용 — 실기기 QA 체크리스트

> 대상: `ASSETS/rps/voice/ko/` 녹음 음성 + `playVoiceClip()` 재생 레이어
> 기준 브랜치: `fix/build6-regression-recovery` · 적용일: 2026-06-26 · **갱신: 2026-06-28 (Build8.4 / WRPS-045)**
> **Build19 이력(WRPS-052-B19)**: intro 카운트다운 구호("안 내면 술래 가위바위보!!")를 담은 사람 목소리 녹음이
> 존재하지 않음을 2026-07-08 whisper(OpenAI) 전사로 확정(`ko_game_start.mp3`는 실제로 "게임을 시작합니다."였음
> — 06-26/28 청취 확인 기록 자체가 오류였음). 1차로 speechSynthesis(TTS) override를 도입했으나, 사용자가 기존
> 단어별 녹음(`ko_scissors/rock/paper.mp3` = "가위"/"바위"/"보")의 실제 내용을 직접 청취로 확인함에 따라
> **TTS를 제거하고 4개 검증된 사람 목소리 파일을 순차 재생(준비→가위→바위→보)하는 방식으로 최종 확정.**
> DR-6(mp3 매핑 이벤트는 TTS 금지) 위반 없음 — 전부 mp3, TTS 미사용.

## 매핑 (코드: `index.html` SoundManager `CLIPS.ko`, ko 로케일 전용)

| 트리거 | 파일 | 시점 | 비고 |
|---|---|---|---|
| ready | `ko_game_ready.mp3`(구 `ko_ready.mp3` 이름변경, 내용 동일="준비") | 카운트다운 1단계 | 사용자 청취 확인(2026-07-08) |
| countScissors | `ko_scissors.mp3` | 카운트다운 2단계 | "가위" — whisper 전사 확인 |
| countRock | `ko_rock.mp3` | 카운트다운 3단계 | "바위" — 사용자 직접 청취 확인(whisper는 오인식) |
| countPaper | `ko_paper.mp3` | 카운트다운 4단계 | "보" — 사용자 직접 청취 확인(whisper는 오인식) |
| becameLoser | `ko_lose.mp3` | 술래 확정(내가 졌을 때) | whisper 전사: "아, 아깝네요."(i18n 정본 문구와 뉘앙스 차이 있음, 재검토 선택사항) |
| gameOver | `ko_you win.mp3` | 게임 최종 승리 | whisper 전사: "이기셨네요."(〃) |
| continue | `ko_safe.mp3` | 라운드 계속(내가 살았을 때) | whisper 전사: "안심하세요. 안전합니다."(〃) |

> **en/ja 로케일은 영향 없음** — 기존 intro(1단계)+go(2단계) TTS 폴백 구조 그대로 유지(`runCountdown()`의 `currentLocale === "ko"` 분기 밖).
> **미사용 녹음(보류)**: `ko_game_start_announcement.mp3`(구 `ko_game_start.mp3` 이름변경, ="게임을 시작합니다.", 트리거 없음), `ko_rock1`, `ko_paper1`, `ko_scissors1`, `ko_mc ment_scissors`, `ko_jrudge_scissor`, `ko_game_start_simple`.
> **backlog(콘텐츠 제작, 코드 아님)**: "안 내면 술래 가위바위보!!" 전체 구호 자체는 여전히 사람 목소리로 존재하지 않음 — 필요 시 신규 MC 성우 녹음 검토.
> 매핑이 틀리면 `index.html`의 `CLIPS.ko` 표 한 줄만 고치면 됨.

## 필수 검증 항목

- [ ] **1. 호스트 폰** — 카운트다운에서 "준비→가위→바위→보" 4박자가 순서대로, 겹침/끊김 없이 재생되는가
- [ ] **2. 참가자 폰** — Ready 버튼 탭 후 카운트다운에서 참가자 단말에도 동일하게 재생되는가 (WRPS-014 unlock 경로)
- [ ] **3. 음소거(🔇)** — 음소거 상태에서 전부 재생되지 않는가, 재생 중 음소거 시 즉시 멈추는가
- [ ] **4. 카운트다운 타이밍** — 4박자 전체 길이(~3.1초)가 부자연스럽게 느리거나 UI와 어긋나지 않는가(en/ja는 기존 1.6초 그대로)
- [ ] **5. WRPS-014 재발 여부** — 참가자 폰에서 음성이 끊기거나 안 나오는 기존 이슈가 재발하지 않는가
- [ ] **6. becameLoser/gameOver/continue 대사 확인** — 상황(졌을 때/게임 승리/라운드 생존)에 맞게 자연스럽게 들리는가

## 추가 확인

- [ ] 영어/일본어 모드 — 기존 intro/go 2단계 + TTS 폴백이 회귀 없이 그대로 동작하는가
- [ ] 네트워크/파일 누락 시 — HTMLAudioElement fallback(Build18, WRPS-052)으로 정상 폴백되는가
- [ ] 같은 라운드 반복 시 음성 겹침/지연 없는가

## 테스트 방법 (로컬 실기기)

1. USB로 아이폰 연결 → Xcode `ios/App/App.xcworkspace` 열기
2. 상단 타깃에서 실기기 선택 → ▶︎ Run (개발 서명 필요)
3. 2대 이상이면 한 대는 호스트, 한 대는 참가자로 같은 방 입장 후 위 항목 점검
4. (TestFlight 경로) Archive → Distribute → build 번호 올려 업로드 → 내부 테스터 설치
