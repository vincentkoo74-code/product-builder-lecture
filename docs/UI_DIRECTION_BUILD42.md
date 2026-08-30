# Build42 UI 방향(RIGHTMOST mockup 의도) — 원인·대안·구현·검증 기록

기준: `release/kr-build41-qa` @ H41 `09c563bf…`(frozen) → `dev/kr-build42-ui-direction`. 메타 bump·아티팩트 없음.
근거 이미지: Drive `RPS-KR-QA/Build41_UI_Direction_01~10.png` (LEFT 원본 / CENTER Build41 / RIGHT 의도).
계측: `tests/harness/ui-direction-build42.mjs`(상태 8 × 뷰포트 9, 실제 렌더러 호출) · 테스트 `tests/build42-ui-direction.test.mjs`.
결정 1: 최종 확정 술래(gameOver && lose, tooFew 확정 술래 포함)는 **역할 무관** 벌칙이 1차 정보.
결정 2: 짧은 뷰포트 압축 순서 hero → 장식 간격 → 제목 크기(가독 clamp) → 카드 패딩. 텍스트 삭제 없음.

## 1. 원인 (H41 구조가 의도와 다른 이유)
| RC | 현재 | 결과 |
|---|---|---|
| RC1 여백 분배 | `--result-maru` 상한 170px 고정 | tall 기기에서 hero 가 안 커지고 카드 아래 빈 블록 |
| RC2 벌칙 형태·순서 | 항상 카드 → 한 줄 꼬리 | 확정 술래에게 벌칙이 2차 정보처럼 보임(06/10 right 는 큰 카드 → 카드) |
| RC3 플레이 미리보기 | `.choice-anim{height:120px}` 고정, 요약 → 미리보기 → 카드 | 짧은 기기에서 진행 카드가 fold 아래(05/08) |
| RC4 준비 술래 수 | 카드가 목록 뒤(스크롤) | 짧은 기기에서 술래 N명 안 보임(03 right 는 칩) |
| RC5 압축 규칙 부재 | hero 만 clamp | 02/10 처럼 단계적 압축이 없음 |
| RC6 c-foot placeholder | 플레이 c-foot `<div style="height:12px">` | 예상 밖 하단 12px |

## 2. 대안과 선택
| 클러스터 | A(선택) | B | 이유 |
|---|---|---|---|
| 결과 순서 | **DOM 순서 벌칙 → 카드**(읽기 순서 = 시각 순서) + 상태별 표시는 기존 hidden 토글 | CSS `order` | 벌칙은 "확정 술래" 상태에서만 보이므로 순서가 상태와 무관 — DOM 이동 1회로 접근성 일치 |
| 여백 분배 | **예산 clamp 상한 220 / 하한 40, 예산 620** | grid rows | 기존 패턴, c-head/c-body/c-foot 계약 유지 |
| 플레이 | **요약 → 카드 → 미리보기, 미리보기 `clamp(56, 100dvh−safe−640, 120)`** | breakpoint 로 숨김 | 콘텐츠 손실 없음 |
| 준비 칩 | **h3 행 `[data-tagger-chip]`, `renderRoundProgressCards()` 가 `info.target` 로 채움** | compact 카드 head | 목록 공간 보존, 새 계산 없음 |
| 압축 | **dvh 기반 clamp(간격·패딩·제목·손 이미지)** | 고정 breakpoint | 기기 이름 분기 없음 |
| 하단 액션 | **c-foot 유지**(이미 바닥 고정·safe-area·slot-final) | margin-top:auto 재구조화 | 재구조화 리스크 회피 |

## 3. 프로덕션 diff(index.html) 요약
- 결과: `#resultPenaltyBox` DOM 을 카드 앞으로(`penalty-tail` 제거) · `#screenRoundResult .c-body .penalty-box{padding:clamp(8,1.6dvh,14) 14;margin:0 0 clamp(6,1.4dvh,10)} strong{font-size:clamp(18,2.8dvh,22)}` · `--result-maru: clamp(40px, 100dvh−safe−620px, 220px)` · `.result-hero{padding:clamp(2,1.4dvh,18) 0 clamp(2,1dvh,10)}` · `.result-title{font-size:clamp(28px,5.1dvh,42px)}` · ≤700px 고정값(28px/4px) 제거 · 결과 카드 패딩/제목 간격 clamp
- 플레이: c-body 요약 → 카드 → `#choiceAnim` · `.choice-anim{height:clamp(56px,100dvh−safe−640px,120px);margin-bottom:clamp(6,1.8dvh,16)}` · 손 이미지 `height:min(96px,80%)` · 요약/부제/안내/카드 간격·요약 항목 패딩 clamp · 버튼 손 이미지 `clamp(44,8.4dvh,64)` · c-foot 12px 스페이서 제거(dev 버튼 마진으로)
- 준비: `.section-head-row` + `.tagger-chip[data-tagger-chip]` · 렌더러 `renderRoundProgressCards()` 끝에 칩 채우기 2줄(같은 `info.target`)
- 기능 로직 diff: **0** (판정·토글·realtime·상태 전이 무변경)

## 4. RED → GREEN
Build42 suite 15 tests: RED 12 failed / 3 passed (H41) → **GREEN 15/15**. Build41 suite: 핀 4건을 Build42 계약으로 갱신(벌칙 순서·형태, 플레이 순서, hero 상한, 뮤테이션 가드는 "clamp 제거 + head 복귀" 로 강화) → 26/26.

## 5. 계측(H41 → B42), 대표 뷰포트
| 상태 | 뷰포트 | hero img | 벌칙 | 카드 clip | 액션 | dead(의도) | unexp |
|---|---|---|---|---|---|---|---|
| FINAL LOSER host | 360×732 | 116 → 76 | tail clip42 → **big 312–385 clip0** | 4.8 → **0** | 593–699 | 33(32) | 0 |
| FINAL LOSER participant | 360×732 | 116 → 76 | tail → big clip0 | 0 → 0 | 651–699 | 33(32) | 0 |
| FINAL LOSER host | 393×818 | 153 → 113 | tail → big 406–484 | 0 → 0 | 679–785 | 33(32) | 0 |
| FINAL LOSER host/part. | 414×896 | 170 → **186** | big 471–551 | 0 | 741/799–847 | 49(48) | 0 |
| FINAL WINNER host | 393×818 | 153 → 113 | – | 0, row1 clip 6.8 → **0** | 679–785 | 33 | 0 |
| READY host | 360×732 | – | 칩 `술래 1명` | 그리드 clip 0 | 593–699 | 33 | 0 |
| PLAY | 360×732 | – | – | 카드 clip **68 → 0**, 미리보기 h56 clip0 | 587–699 | 45 → 33 | 12 → 0 |
| PLAY | 393×818 | – | – | 카드 clip 31 → 0, 미리보기 h93 | 673–785 | 33 | 0 |
| PLAY | 414×896 | – | – | 카드 0, 미리보기 h120 | 734–847 | 49 | 0 |
전체 표(72행): `_maru-rps-evidence/Build42-UI-direction/table.txt`.

## 6. 증거로 남기는 한계
- iPhone SE 375×667(승인된 최소 게이트 360×732 미만): 플레이 화면에서 §15 압축을 모두 적용해도 요약+진행 카드+버튼 뒤에 미리보기 56px 중 **7px 만 fold 안**에 남는다(스크롤로 이어짐). 요약·카드·버튼은 온전. 추가 조치(미리보기 숨김 등)는 결정 2에 따라 승인 대상.
- iPhone 11 FINAL LOSER host: 큰 벌칙 카드 + 카드 뒤 참가자 첫 행이 40px 잘림(스크롤) — 참가자 행은 승자 화면 계약 대상(0), 술래 화면은 벌칙·카드가 우선.
