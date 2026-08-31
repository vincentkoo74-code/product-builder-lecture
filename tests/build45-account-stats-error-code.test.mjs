// Build45 — 내기록 로드 실패 시 에러코드 표면화 (Vincent 지시 2026-09-01 문제1 보조)
//
// 근본원인(재실측 2026-09-01): Seoul user_game_stats/user_game_history 에 GRANT 미적용 →
// PostgREST 42501 (RLS 평가 이전 거부). 서버 수정은 20260824021500 마이그레이션(사람 적용 대기).
// 클라이언트 보조: 실패 화면에 e.code 를 함께 렌더 → 필드 스크린샷만으로 원인(42501) 식별 가능.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

describe('Build45 내기록 실패 진단성', () => {
  it('로드 실패 렌더는 error code 를 메시지 앞에 표기한다', () => {
    expect(html).toContain('stats-error"><strong>${t("account.loadFailed")}</strong><span>${escapeHtml(e?.code ? "[" + e.code + "] " : "")}${escapeHtml(e?.message || String(e))}</span>');
  });
});
