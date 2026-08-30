# MARU RPS V1.0_JP — JAPAN LEGAL PRE-STUDY REPORT

작성일: 2026-08-29 (모든 URL 접속일 동일)
성격: **법률 자문이 아님.** 일본 출시·상업화 관련 규제 리스크 맵과 전문가 확인 항목 정리.

## 표기 규칙 (§6 — 섞지 않는다)

| 표기 | 의미 |
|---|---|
| **[법률]** | 국회 제정 법률의 조문 |
| **[행정]** | 소관 관청의 고시·가이드라인·Q&A (법률 자체가 아님) |
| **[플랫폼]** | LINE / LY Corporation 정책 (법률 아님. 위반 시 계약·심사 문제) |
| **[관행]** | 업계 관행·2차 해설 |
| **[추정]** | 본 조사자의 추론 — 근거 없음 |

| 신뢰도 | 의미 |
|---|---|
| `official source confirms` | 1차 공식 출처에서 직접 확인 |
| `secondary interpretation` | 2차 자료 기반 해석 |
| `requires counsel confirmation` | 일본 변호사 확인 필요 |

---

## 0. 사전 확인 — 법률 리서치 skill 부재

공식 마켓플레이스(`claude-plugins-official`)에 일본 법률 리서치용 skill은 **없다**. "legal" 매칭 항목은 `box-legal-workflows`(계약서 관리, Box 인증 필요) 및 `azure-compliance`뿐으로, 법령 조사 기능이 없다. **설치하지 않았고 권하지 않는다.** 대신 §4 출처 우선순위대로 공식 사이트를 직접 조회했다.

---

## 1. Executive Summary

1. **무료 게임 단독 출시는 법적 장애가 가장 낮다.** 다만 "아무 의무도 없다"는 것은 사실이 아니다 — 해외 사업자라도 일본 이용자에게 서비스를 제공하면 **개인정보보호법이 역외적용된다**(法171条, `official source confirms`).
2. **일본 법인 필수 여부는 법률이 아니라 LINE 플랫폼 정책의 문제**로 보인다. LINE 공식 문서에서 "일본 법인 필수"라는 명문은 **확인되지 않았다** — 확인도 부정도 되지 않은 `UNKNOWN`이며 LINE에 직접 문의해야 한다.
3. **결제·광고·쿠폰을 붙이는 순간 규제 밀도가 급상승한다.** 특히 게임 결과와 연동된 쿠폰은 景品表示法의 **懸賞** 해당 여부에 따라 금액 상한이 걸린다.
4. **캐릭터 굿즈 직접 판매가 가장 무겁다** — 特定商取引法 표시의무(대표자명 포함)·반품·소비세까지 한꺼번에 걸린다.
5. CEO가 제시한 **FREE GAME → NON-COMMERCIAL → COMMERCIAL 순서는 법무 리스크 관점에서 타당하다**(§14).

---

## 2. Free Game Launch Legal Readiness

무료 게임만 제공할 때 **남는** 의무:

| 항목 | 근거 | 신뢰도 |
|---|---|---|
| 개인정보 취급 (수집·이용목적 공표, 안전관리조치, 누설 시 보고) | **[법률]** 個人情報保護法 §171 역외적용, §23 안전관리, §26 누설보고 | `official source confirms` — PPC FAQ가 "외국에 있는 개인정보취급사업자가 일본 국내에 있는 자에 대한 물품·서비스 제공과 관련하여… 외국에서 취급하는 경우 개인정보보호법이 적용된다"고 명시 |
| 외부송신규율 (Cookie·광고ID 등 단말 정보를 외부로 보낼 때 통지/공표) | **[법률]** 電気通信事業法 개정, 2023-06-16 시행 | `official source confirms` — 総務省: "웹사이트 운영자, 애플리케이션 제공자 등"이 대상 |
| 자사 서비스에 대한 표시가 사실과 다르지 않을 것 | **[법률]** 景品表示法 §5 (優良誤認·有利誤認) | `official source confirms` |
| 이용약관·프라이버시정책·문의처 게시 | **[플랫폼]** LINE MINI App 심사 요건 | `official source confirms` |

**적용되지 않는 것**: 特定商取引法 통신판매 규정(판매·유상역무 없음), 景品表示法 景品規制(景品類 제공 없음), 資金決済法(前払式 발행 없음).

---

## 3. LINE Platform Eligibility

**[플랫폼]** LINE Developers 「審査を依頼する」에서 확인된 것 (`official source confirms`):
- 프로바이더명이 **「サービス提供者」와 동일**해야 한다
- 「チャネル説明」에 정확한 서비스 내용 기재
- 프라이버시정책 설정 시 **이용자 정보 취득 회사 = 프로바이더명**
- 개발사와 서비스 사업주가 다르면 채널설명·프라이버시정책 URL 미설정 시 심사 불가
- 예약·결제·주문 포함 서비스는 테스트 시나리오 제출

**[플랫폼]** LINE 공식계정 認証済アカウント 심사기준 5항목 (`official source confirms`): 이용자 불이익 가능성, 법령 규제 저촉, 이용규약 §18 금지행위, 자체 심사기준, 자사 사업 악영향.

**확인되지 않은 것 (UNKNOWN)**: 두 공식 문서 어디에도 **신청자의 법인격·국적·일본 소재 요건이 명시되어 있지 않다.** 2차 자료는 "일본 국내 마케팅에는 일본 전화번호 개설을 권장"이라고만 한다(`secondary interpretation`).

---

## 4. Corporate / Business Entity Issues

- **[법률]** 일본에는 "외국 사업자가 일본 이용자에게 무료 앱을 제공하려면 일본 법인을 세워야 한다"는 일반 규정이 **없다**. 会社法 §817(외국회사의 일본 내 계속 거래 시 일본 대표자·등기)은 "일본에서 계속하여 거래를 하려는" 경우에 걸리므로, 무료 게임 단독 단계의 해당 여부는 `requires counsel confirmation`.
- **[추정]** 실무상 장벽은 법률보다 **플랫폼 심사·결제·세무 등록**에서 먼저 발생한다.

---

## 5. Privacy / APPI

| 논점 | 내용 | 신뢰도 |
|---|---|---|
| 역외적용 | 외국 사업자가 일본 국내에 있는 자에게 서비스를 제공하며 그 자를 본인으로 하는 개인정보를 외국에서 취급하면 **APPI 적용**(§171). §23 안전관리조치, §26 누설등 보고도 적용 | `official source confirms` |
| Supabase Tokyo 사용 | 데이터가 일본 리전에 있어도 **사업자가 외국에 있으면 역외적용 판단은 동일**. 리전 선택은 「외적환경의 파악」 부담을 줄이는 요소일 뿐 면제 사유가 아님 | `secondary interpretation` |
| 국외이전 | 일본 이용자 개인데이터를 **외국의 제3자**에게 제공하면 §28(외국 제3자 제공) 규율. 자사 그룹 내 취급·위탁 여부에 따라 결론이 갈림 | `requires counsel confirmation` |
| LINE profile / userId | LINE의 userId·표시명·프로필 이미지는 개인정보 해당 가능. 취득 목적 공표와 최소수집 원칙 필요 | `secondary interpretation` |
| 보유·삭제 | APPI는 일률적 보존기간을 정하지 않음. 이용목적 달성 시 소거 노력의무 | `secondary interpretation` |

**MaruRPS 현황 대비**: Tokyo Supabase에 `rooms`/`participants`를 두고 LINE 로그인을 붙이면 위 전부가 활성화된다. 특히 **누설 시 PPC 보고 의무**가 해외 사업자에게도 적용된다는 점이 실무상 가장 큰 부담이다.

---

## 6. Advertising / Sponsored Battle

**[법률+행정]** ステルスマーケティング告示(令和5年内閣府告示第19号), 2023-10-01 시행 (`official source confirms`):
- **규제 대상은 "상품·서비스를 공급하는 사업자(광고주)"** — 인플루언서는 규제 대상에서 명시적으로 제외
- 「一般消費者が事業者の表示であることを判別することが困難である表示」가 부당표시
- 시행일 이전 게시물이라도 시행 후 계속 표시되면 처분 대상 가능

**Sponsored Battle에 적용되는 방식**:
- 스폰서 자금·대가를 받고 게임 내에 브랜드를 노출하면 **그 표시는 "사업자의 표시"**가 될 수 있다 → 광고임을 명료히 표시해야 함
- 브랜드에 대한 우월적 표현(예: "최고", "1위")은 優良誤認 리스크
- 구체적 표기 문구(「広告」「PR」 등)의 적정성은 운용기준 PDF 확인 및 `requires counsel confirmation`

---

## 7. Coupons / Prizes / 景品表示法

**[행정]** 消費者庁 「景品規制の概要」 (`official source confirms`):

| 구분 | 최고액 | 총액 |
|---|---|---|
| 一般懸賞 (거래가액 5,000円 미만) | 거래가액의 **20배** | 매출예정총액의 **2%** |
| 一般懸賞 (5,000円 이상) | **10만円** | 매출예정총액의 **2%** |
| 共同懸賞 | **30만円** | 매출예정총액의 **3%** |
| 総付景品 (1,000円 미만) | **200円** | — |
| 総付景品 (1,000円 이상) | 거래가액의 **10분의 2** | — |

**핵심 판단축**:
- 景品類 = "고객을 유인하는 수단으로서 **자기가 공급하는 상품·서비스의 거래에 부수하여** 제공하는 경제상의 이익"
- **オープン懸賞**(상품 구입·來店을 조건으로 하지 않는 기획)은 景品規制 **미적용**. 平成18年4月 상한 철폐 (`official source confirms`)

**MaruRPS 시나리오 판정**:
- 게임이 무료이고, 쿠폰 획득에 **구입·來店 조건이 없다면** → オープン懸賞 방향 (`secondary interpretation`)
- 쿠폰이 **제휴 카페 방문·주문을 조건**으로 하면 → 거래 부수성 발생, 게임 결과(우연성) 개입 → **一般懸賞** 가능성 → 상한 적용
- "거래가액 0円(무료)"의 취급은 消費者庁 개요 페이지에 **명시가 없다** → `UNKNOWN`, `requires counsel confirmation`

---

## 8. LINE Sticker

**[플랫폼]** LINE Creators Market (`official source confirms`):
- **직업·연령·개인/법인 불문 누구나 회원등록 가능** — 일본 거주 요건이 명시되어 있지 않다
- 분배금은 스탬프 매출의 50%에서 **원천소득세를 공제**한 금액
- 크리에이터가 **일본 비거주 개인 또는 법인**이고 거주지국과 일본 간 **조세조약**이 있으면 「租税条約に関する届出書」 제출로 원천소득세 **경감 또는 면제** 가능

**남는 리스크**: 소비세(JCT) 취급, 한국-일본 조세조약 적용 절차, IP 귀속(캐릭터 저작권을 누가 보유하는가)은 `requires counsel confirmation`.

---

## 9. Character Goods / E-commerce

**[법률]** 特定商取引法 §11 통신판매 광고 표시의무 (`official source confirms`):
- 사업자명(법인은 회사명), **주소**, **전화번호** 표시 필수
- 인터넷 광고 시 법인은 **대표자명 또는 통신판매 업무 책임자명**도 기재
- "주소"는 실제로 사업을 영위하는 장소, "전화번호"는 확실히 연락 가능한 번호
- 개인사업자는 조건부 생략 가능(청구 시 지체 없이 제공하는 체제가 있고 그 취지를 광고에 명시)

**추가로 걸리는 것**: 반품특약 표시, 소비세(국외사업자의 JCT 등록), 제조물책임(PL), 상표·저작권. 전부 `requires counsel confirmation`.

**판정: 무료 게임 대비 규제 밀도가 가장 높다. 가장 마지막에 배치해야 한다.**

---

## 10. Cafe / Restaurant Promotion

- 쿠폰이 **來店을 조건**으로 하면 §7의 거래 부수성이 성립할 가능성이 높다 (`secondary interpretation`)
- 제휴 매장의 상품에 대한 표시(맛·효능·원산지 등)를 MaruRPS가 게시하면 **표시 주체 책임**이 우리에게도 미칠 수 있음 → 계약으로 표시 책임 주체를 명확히 배분해야 함 (`requires counsel confirmation`)
- 건강·영양 관련 소구는 健康増進法·食品表示法 영역 → 별도 검토

---

## 11. Maru Gourmet

- 유상 게재(sponsored placement)·제휴(affiliate) 수익이 있으면 **광고임을 명시**해야 한다 → §6 ステマ告示 직결
- 이용자 리뷰를 사업자가 유도·편집·대가 제공하면 "사업자의 표시"로 취급될 수 있음 (`secondary interpretation`)
- 순위·추천 알고리즘이 대가와 연동되면 有利誤認 리스크

---

## 12. Payments / Tax

**[법률]** 資金決済法 (`official source confirms`, 金融庁):
- 自家型 前払式支払手段 발행자는 **기준일(3월말/9월말) 미사용잔고가 정령 기준액(1,000万円)을 초과**하면 내각총리대신에게 **신고** 의무
- 요공탁액은 기준일 미사용잔고의 **1/2**

**MaruRPS 함의**: 게임 내 "코인"·"포인트" 같은 **선불 가치**를 발행하면 이 규율에 진입한다. **선불 가치를 만들지 않고 그때그때 결제하는 구조**가 규제상 훨씬 가볍다 (`추정` — 설계 방향 제안이며 법적 결론 아님).

**[플랫폼]** LINE MINI App의 인앱 결제 규칙은 심사 시 「テストシナリオ」 제출을 요구할 정도로 별도 취급 → 결제 도입 전 LINE 정책 원문 확인 필요 (`UNKNOWN`).

---

## 13. GREEN / YELLOW / RED / UNKNOWN Matrix

| # | 항목 | 판정 | 근거 |
|---|---|---|---|
| 1 | 무료 게임 단독 출시(결제·광고·쿠폰 없음) | **GREEN** | 特商法·景品規制·資金決済法 미적용 |
| 2 | 프라이버시정책·이용약관·문의처 게시 | **GREEN** | 플랫폼 요건이자 APPI 실무 |
| 3 | APPI 역외적용 대응(공표·안전관리·누설보고) | **YELLOW** | §171 적용 확정. 체계 구축 필요 |
| 4 | 電気通信事業法 외부송신규율 | **YELLOW** | 적용 대상 여부·통지 문안 설계 필요 |
| 5 | 해외 법인 명의 LINE MINI App 공개 | **UNKNOWN** | 공식 문서에 법인 국적 요건 명시 없음 |
| 6 | 해외 법인 명의 LINE 공식계정 운영 | **UNKNOWN** | 동일. 일본 전화번호 권장은 2차 자료 |
| 7 | 국외이전(§28) 해당 여부 | **UNKNOWN** | 구조 확정 후 판단 |
| 8 | Sponsored Battle 광고 표시 | **YELLOW** | ステマ告示 대상은 광고주=우리 |
| 9 | 브랜드 협업 계약·책임 배분 | **YELLOW** | 계약 설계로 대응 가능 |
| 10 | 게임 결과 연동 쿠폰 | **RED** | 懸賞 해당 시 상한. 무료 시 거래가액 취급 불명 |
| 11 | 카페·음식점 프로모션 | **RED** | 거래 부수성 + 식품 표시 책임 |
| 12 | Maru Gourmet 유상 게재 | **RED** | 광고 표시 + 有利誤認 |
| 13 | LINE Sticker 유료 판매 | **YELLOW** | 비거주자 등록 가능. 조세조약 절차 필요 |
| 14 | Character Goods 직접 판매 | **RED** | 特商法 표시·반품·소비세·PL |
| 15 | 게임 내 선불 가치 발행 | **RED** | 資金決済法 진입 |
| 16 | 会社法 §817 해당 여부 | **UNKNOWN** | 상업화 단계에서 재판단 |

---

## 14. Recommended Commercialization Order

CEO 제안 순서(FREE GAME → NON-COMMERCIAL → COMMERCIAL)를 법무 리스크 관점에서 평가하면 **타당하다.** 다만 두 가지를 보정한다:

1. **Phase 0 (출시 전)** — LINE에 "해외 법인 명의 가능 여부"를 **문서로** 확인. 이것이 UNKNOWN인 채로 개발을 더 진행하면 나중에 명의 변경이 강제될 수 있다.
2. **Phase 1 무료 게임** — APPI 역외적용·외부송신규율 대응을 "출시 후 과제"가 아니라 **출시 요건**으로 둔다.
3. **Phase 2 비상업 확장** — Sponsored Battle을 **대가 없는 브랜드 노출**로 먼저 하지 말 것. 대가가 있으면 그 순간 광고 표시 의무가 생기므로, 처음부터 광고 표시를 넣고 시작하는 편이 안전하다.
4. **Phase 3 쿠폰·프로모션** — 여기가 첫 번째 RED. 변호사 확인 없이 진입 금지.
5. **Phase 4 스티커** — 결제 구조가 LINE 안에서 끝나므로 굿즈보다 가볍다.
6. **Phase 5 굿즈·Maru Gourmet 유상 게재** — 가장 마지막.

**즉 스티커를 쿠폰보다 먼저 두는 것이 리스크 순서상 더 낫다** (`추정` — CEO 순서와 다른 유일한 제안).

---

## 15. Questions Requiring Japanese Counsel

1. 해외 법인 명의로 일본 이용자 대상 LINE MINI App·공식계정 운영이 가능한가 (플랫폼 + 会社法 §817)
2. 무료 게임에서 "거래가액 0円"일 때 景品規制상 취급
3. 게임 결과 연동 쿠폰이 一般懸賞인가 総付景品인가 オープン懸賞인가
4. Supabase Tokyo 구성에서 §28 국외이전 해당 여부
5. LINE userId 등 식별자의 개인정보 해당성과 취득 목적 공표 문안
6. Sponsored Battle의 구체적 광고 표시 문구·위치
7. 제휴 음식점 표시에 대한 책임 주체 배분 계약
8. 한국 법인의 LINE Creators Market 분배금에 대한 조세조약 적용 절차
9. 굿즈 직판 시 特商法 표시 항목 확정 및 JCT 등록 요부
10. 장래 게임 내 포인트가 前払式支払手段에 해당하는지

---

## 16. Source List (모두 2026-08-29 접속)

**[행정] 消費者庁**
- 景品規制の概要 — https://www.caa.go.jp/policies/policy/representation/fair_labeling/premium_regulation
- 一般懸賞について — https://www.caa.go.jp/policies/policy/representation/fair_labeling/faq/premium/lotteries
- 共同懸賞について — https://www.caa.go.jp/policies/policy/representation/fair_labeling/faq/premium/joint
- 総付景品について — https://www.caa.go.jp/policies/policy/representation/fair_labeling/faq/premium/not_lotteries
- ステルスマーケティング規制 — https://www.caa.go.jp/policies/policy/representation/fair_labeling/stealth_marketing
- ステマ告示 指定・運用基準 公表 — https://www.caa.go.jp/notice/entry/032672/
- 特定商取引法ガイド 通信販売広告について — https://www.no-trouble.caa.go.jp/what/mailorder/advertising.html
- 特定商取引法 §11 条文PDF — https://www.no-trouble.caa.go.jp/pdf/20240319la03_04.pdf

**[행정] 個人情報保護委員会**
- 域外適用 FAQ (일본 국내 이용자 대상 서비스) — https://www.ppc.go.jp/all_faq_index/faq1-q11-2/
- 域外適用 FAQ (누설 시 보고) — https://www.ppc.go.jp/all_faq_index/faq1-q11-3/
- 域外適用 FAQ (위탁) — https://www.ppc.go.jp/all_faq_index/faq1-q11-4/
- 外国にある第三者への提供編 가이드라인 — https://www.ppc.go.jp/personalinfo/legal/guidelines_offshore/

**[행정] 総務省**
- 外部送信規律 — https://www.soumu.go.jp/main_sosiki/joho_tsusin/d_syohi/gaibusoushin_kiritsu.html
- 外部送信規律 FAQ — https://www.soumu.go.jp/main_sosiki/joho_tsusin/d_syohi/gaibusoushin_kiritsu_00002.html

**[행정] 金融庁**
- 前払式支払手段発行者関係(事務ガイドライン) — https://www.fsa.go.jp/common/law/guide/kaisya/05.pdf
- プリペイドカード 届出・登録 パンフレット — https://www.fsa.go.jp/common/about/pamphlet/2019purika.pdf

**[플랫폼] LINE / LY Corporation**
- LINE MINI App 審査を依頼する — https://developers.line.biz/ja/docs/line-mini-app/submit/submission-guide/
- LINE MINI App はじめに — https://developers.line.biz/ja/docs/line-mini-app/quickstart/
- LINE公式アカウント 認証済アカウント申請の注意点 — https://www.lycbiz.com/jp/column/line-official-account/guideline/20190829/
- LINE公式アカウント 利用規約 — https://terms2.line.me/official_account_terms_jp?lang=ja
- LINE Creators Market 利用規約 — https://creator.line.me/ja/terms/
- Creators ヘルプ 税金について — https://help2.line.me/creators/ios/categoryId/20002320/pc

---

## 최종 평가

**FREE GAME LAUNCH FIRST → NON-COMMERCIAL EXPANSION → COMMERCIAL FEATURES AFTER LEGAL CONFIRMATION 은 법적으로 타당하다.**

단, "무료 게임 단계에는 법적 의무가 없다"는 전제는 **틀렸다** — APPI 역외적용과 전기통신사업법 외부송신규율은 첫 출시부터 적용된다. 이 둘을 출시 요건으로 편입하는 조건에서 위 순서를 지지한다.
