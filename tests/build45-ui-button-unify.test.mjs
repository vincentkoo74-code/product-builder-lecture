// Build45 — 버튼 지오메트리 통일 계약 (Vincent 지시 2026-09-01)
//
// 실측 근거(360×732 감사, 67버튼): 동일 클래스인데 화면별 높이 제각각 —
//   btn-kparty 46.8/48/56/60/62.4/64.4px · btn-outline.btn-full 48~64.4px · fs 14/15/16 혼재
//   버튼 간 간격 4/8/10/12/16px 혼재(인라인 style)
// 원인: 전역 button{padding:15px 16px} 위에 min-height 없이 fs/패딩이 문맥마다 달라짐.
//
// 계약:
//  [1] 토큰 --btn-h:52px (sns-btn 실측 52px와 정렬, 터치 최소 44px 초과)
//  [2] 주요 변형(btn-kparty/primary/success/light/outline/danger) 통일 규칙:
//      min-height:var(--btn-h) + 세로 패딩 12px + font-size 15px → 단일행 버튼 전부 52px
//  [3] 간격: 버튼 인라인 margin 전부 var(--action-gap)=10px 로 통일(픽셀 인라인 금지)
//  [4] 예외(명시 유지): #finalResultBtns>button 48px(2열 압축 표준) ·
//      .qr-direct-row .btn-kparty 56px(입력 높이 매칭) · .btn-quiet 44px(build35 계약)
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

describe('Build45 버튼 통일 — 토큰/규칙', () => {
  it('[1] :root 에 --btn-h:52px 토큰이 있다', () => {
    expect(html).toMatch(/:root\{[^}]*--btn-h:\s*52px/);
  });
  it('[2] 변형 버튼 그룹 규칙: min-height:var(--btn-h) + 세로 패딩 12px + fs 15px', () => {
    const m = /\.btn-kparty,\s*\n\s*\.btn-primary,\s*\n\s*\.btn-success,\s*\n\s*\.btn-light,\s*\n\s*\.btn-outline,\s*\n\s*\.btn-danger\{([^}]*)\}/.exec(html);
    expect(m, '통일 그룹 규칙 없음').not.toBeNull();
    expect(m[1]).toContain('min-height:var(--btn-h)');
    expect(m[1]).toContain('padding-top:12px');
    expect(m[1]).toContain('padding-bottom:12px');
    expect(m[1]).toContain('font-size:15px');
  });
  it('[2] 그룹 규칙은 모든 변형 정의·미디어 오버라이드보다 뒤에 온다(캐스케이드 승리)', () => {
    const g = html.indexOf('.btn-kparty,\n    .btn-primary,');
    expect(g).toBeGreaterThan(html.indexOf('.btn-kparty{'));
    expect(g).toBeGreaterThan(html.indexOf('.btn-quiet{'));
    expect(g).toBeGreaterThan(html.indexOf('padding-right:54px'));
  });
  it('[2] 좁은 화면 미디어의 .btn-kparty 는 가로 패딩만 조정한다(세로 12px 불변)', () => {
    expect(html).not.toContain('padding:14px 54px');
    expect(html).toMatch(/\.btn-kparty\{\s*\n\s*padding-left:18px;\s*\n\s*padding-right:54px;/);
  });
});

describe('Build45 버튼 통일 — 간격', () => {
  it('[3] 버튼 인라인 margin 픽셀값 금지 — 전부 var(--action-gap)', () => {
    const bad = html.match(/<button[^>]*style="[^"]*margin-(top|bottom):\s*\d/g) || [];
    expect(bad, JSON.stringify(bad)).toHaveLength(0);
  });
  it('[3] .btn-kparty 기본 하단 간격도 var(--action-gap)', () => {
    expect(html).toMatch(/\.btn-kparty\{[^}]*margin-bottom:var\(--action-gap\)/);
    expect(html).not.toMatch(/\.btn-kparty\{[^}]*margin-bottom:10px/);
  });
  it('[3] .compact-action-grid 의 재정의 블록도 gap:var(--action-gap)', () => {
    expect(html).not.toMatch(/\.compact-action-grid\{[^}]*gap:8px/);
  });
});

describe('Build45 버튼 통일 — 명시 예외(회귀 방지)', () => {
  it('[4] #finalResultBtns>button 은 48px 압축 표준 유지', () => {
    expect(html).toMatch(/#finalResultBtns > button \{[^}]*min-height: 48px/);
  });
  it('[4] .qr-direct-row .btn-kparty 는 입력 매칭 56px 유지', () => {
    expect(html).toMatch(/\.qr-direct-row \.btn-kparty\{[^}]*height:56px/);
  });
  it('[4] .btn-quiet 44px(build35 계약) 유지', () => {
    expect(html).toMatch(/\.btn-quiet\{[^}]*min-height:44px/);
  });
});

describe('Build45 버튼 통일 — 2열 그리드 압축 표준 일원화', () => {
  it('[5] .action-grid/.footer-actions/#screenLobby .grid 버튼은 finalResultBtns 와 같은 48px 표준', () => {
    const m = /\.action-grid > button,\s*\n\s*\.footer-actions > button,\s*\n\s*#screenLobby \.grid > button\{([^}]*)\}/.exec(html);
    expect(m, '그리드 표준 규칙 없음').not.toBeNull();
    expect(m[1]).toContain('min-height:48px');
    expect(m[1]).toContain('padding:12px 10px');
  });
  it('[5] confirmPopup CTA 는 전용 56px 대신 표준 토큰을 쓴다', () => {
    expect(html).toMatch(/#confirmPopupOk,\s*\n\s*#confirmPopupCancel\{[^}]*min-height:var\(--btn-h\)/);
    expect(html).not.toMatch(/#confirmPopupOk,\s*\n\s*#confirmPopupCancel\{[^}]*min-height:56px/);
  });
  it('[5] 협폭 미디어에 fs14 그리드 잔존 없음', () => {
    expect(html).not.toMatch(/#screenHostRoom \.footer-actions button,\s*\n\s*#screenLobby \.grid > button\{[^}]*font-size:14px/);
  });
});
