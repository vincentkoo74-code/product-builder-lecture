// scripts/history-analyze.mjs — History Analyzer (WES v2.1)
// BUG_MASTER_LEDGER / ACTIVE_ISSUES / REGRESSION_TRACKER / LESSONS_LEARNED / DESIGN_RULES / BUG_TIMELINE / QA_STATUS
// 를 검색해 현재 Issue가 Regression인지 / 과거 사례와 동일한지 자동 분류한다. 순수 분석(파일 읽기만).
//
// 사용: node scripts/history-analyze.mjs WRPS-026 "호스트 빠짐"

import { readFile } from 'node:fs/promises';

const DOCS = [
  'docs/history/BUG_MASTER_LEDGER.md',
  'docs/history/ACTIVE_ISSUES.md',
  'docs/history/REGRESSION_TRACKER.md',
  'docs/history/LESSONS_LEARNED.md',
  'docs/history/DESIGN_RULES.md',
  'docs/history/BUG_TIMELINE.md',
  'QA_STATUS.md',
];

export async function analyzeHistory(keywords = [], { baseUrl = new URL('../', import.meta.url) } = {}) {
  const terms = (Array.isArray(keywords) ? keywords : [keywords]).map((k) => String(k).toLowerCase()).filter(Boolean);
  const matches = [];
  for (const rel of DOCS) {
    let text = '';
    try { text = await readFile(new URL(rel, baseUrl), 'utf8'); } catch (e) { continue; }
    text.split('\n').forEach((line, i) => {
      const low = line.toLowerCase();
      if (terms.some((t) => low.includes(t))) matches.push({ doc: rel, line: i + 1, text: line.trim().slice(0, 240) });
    });
  }
  const inRegressionTracker = matches.some((m) => m.doc.includes('REGRESSION_TRACKER'));
  const inLedger = matches.some((m) => m.doc.includes('BUG_MASTER_LEDGER'));
  const regressionHint = matches.some((m) => /회귀|regression|재발|회차/i.test(m.text));
  let classification;
  if (inRegressionTracker || regressionHint) classification = 'REGRESSION (과거 수정 재발 가능성 — 커밋 추적 필요)';
  else if (inLedger) classification = '기존 Issue 변형/유지 (원장 등재됨)';
  else if (matches.length) classification = '관련 사례 존재 (문서 참조)';
  else classification = '신규 가능성 (과거 문서에 매칭 없음 — 추가 검색 권장)';

  return {
    terms, isRegressionCandidate: inRegressionTracker || regressionHint,
    classification, matchCount: matches.length,
    matches: matches.slice(0, 40),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = await analyzeHistory(process.argv.slice(2));
  console.log('=== History Analysis ===');
  console.log('terms:', out.terms.join(', '));
  console.log('classification:', out.classification, '| regressionCandidate:', out.isRegressionCandidate, '| matches:', out.matchCount);
  out.matches.forEach((m) => console.log(`  ${m.doc}:${m.line}  ${m.text}`));
}
