# 🎙️ 한국어 녹음 음성 적용 — 실기기 QA 체크리스트

> 대상: `ASSETS/rps/voice/ko/` 녹음 음성 + `playVoiceClip()` 재생 레이어
> 기준 브랜치: `fix/build6-regression-recovery` · 적용일: 2026-06-26 · **갱신: 2026-06-28 (Build8.4 / WRPS-045)**
> **Build19 갱신(WRPS-052-B19, DR-6 예외)**: intro(ko)는 mp3 대신 TTS_OVERRIDE("안 내면 술래 가위바위보!!", ko-KR)를 우선 시도. **아래 6번 항목(실기기 가청 확인) 전까지 Evidence-gated — 닫지 않음.**

## 매핑 (코드: `index.html` VOICE_CLIPS)

| 트리거 | 파일 | 시점 | 비고 |
|---|---|---|---|
| intro | ~~`ko_game_start.mp3`~~ → **Build19: TTS_OVERRIDE 우선**("안 내면 술래 가위바위보!!", ko-KR) | 카운트다운 1+2단계 **전체 구호** | ✅ mp3는 풀구호로 청취 확인됨(06-26/28). **TTS 실기기 가청 확인은 미완료(6번 항목) — Evidence-gated** |
| go | **VOICE_SILENT (무음)** | 카운트다운 2단계 | **WRPS-045**: intro 풀구호가 커버 → 별도 재생/TTS 없음(혼재 제거) |
| becameLoser | `ko_lose.mp3` | 술래 확정(내가 졌을 때) | 中 |
| gameOver | `ko_you win.mp3` | 게임 종료(내가 이겼을 때) | 低 — **들어보고 확인** |
| continue | `ko_safe.mp3` | 라운드 계속(내가 살았을 때) | 中 |

> **WRPS-045(Build8.4)**: MP3가 매핑된 이벤트는 절대 speechSynthesis(TTS)를 쓰지 않음. `VOICE_SILENT` 이벤트는 재생·진행클립 중단·TTS 모두 안 함. TTS 폴백은 영/일 및 매핑 없는 이벤트에만.
> **WRPS-046(Build8.4)**: 결과 음성(becameLoser/gameOver/continue)은 `playResultVoiceOnce`로 라운드당 1회만 재생.

> 미사용 녹음(보류): `ko_ready`, `ko_rock(1)`, `ko_paper(1)`, `ko_scissors(1)`, `ko_mc ment_scissors`, `ko_jrudge_scissor`, `ko_game_start_simple` — 현재 게임 흐름에 트리거 없음(추가 시 판정/카운트다운 로직 변경 필요).
> 매핑이 틀리면 `index.html`의 `VOICE_CLIPS.ko` 표 한 줄만 고치면 됨.

## 필수 검증 항목

- [ ] **1. 호스트 폰** — 한국어로 게임 시작 시 녹음된 MC 음성(intro)이 재생되는가
- [ ] **2. 참가자 폰** — Ready 버튼 탭 후 카운트다운에서 참가자 단말에도 녹음 음성이 재생되는가 (WRPS-014 unlock 경로)
- [ ] **3. 음소거(🔇)** — 음소거 상태에서 녹음/TTS 모두 재생되지 않는가, 재생 중 음소거 시 즉시 멈추는가
- [ ] **4. 카운트다운 타이밍** — intro→go→선택까지 타이밍이 기존과 동일한가 (느려짐/밀림 없음)
- [ ] **5. WRPS-014 재발 여부** — 참가자 폰에서 음성이 끊기거나 안 나오는 기존 이슈가 재발하지 않는가
- [ ] **6. (Build19) intro TTS 가청 확인** — codex-critic 지적사항: `speechSynthesis`의 `onend`는 발화 완주만 보장하고 실제 소리가 났는지는 보장하지 않는다(WKWebView 오디오 세션 충돌 시 무음 가능 — WRPS-014/051/052와 동일 실패군). **실기기에서 "안 내면 술래 가위바위보!!"가 실제로 들리는지 귀로 확인**하고, QA JSON의 `audioSource:'tts', audioPlayed:true`가 실제 가청과 일치하는지 대조할 것. 불일치 시 WRPS-052-B19 재오픈.

## 추가 확인

- [ ] 결과 화면: 졌을 때 `ko_lose`, 이겼을 때 `ko_you win`/`ko_safe`가 상황에 맞게 나오는가 (대사 내용이 시점과 일치하는지 청취 확인)
- [ ] 영어/일본어 모드 — 기존 TTS로 정상 폴백되는가 (녹음 미적용)
- [ ] 네트워크/파일 누락 시 — 무음이 아니라 TTS로 폴백되는가
- [ ] 같은 라운드 반복 시 음성 겹침/지연 없는가

## 테스트 방법 (로컬 실기기)

1. USB로 아이폰 연결 → Xcode `ios/App/App.xcworkspace` 열기
2. 상단 타깃에서 실기기 선택 → ▶︎ Run (개발 서명 필요)
3. 2대 이상이면 한 대는 호스트, 한 대는 참가자로 같은 방 입장 후 위 항목 점검
4. (TestFlight 경로) Archive → Distribute → build 번호 올려 업로드 → 내부 테스터 설치
