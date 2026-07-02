// scripts/qa-merge.mjs — 여러 기기의 QA 레코딩 파일을 하나로 병합(Analyzer 표준 입력).
// 각 기기의 QA📋(copyText: {summary, recent}) 또는 __qaMetrics.export()({manifest,session,recent,snapshots})
// 또는 [QA record...] 배열을 모두 수용. recent를 합치고 manifest/session은 처음 발견된 값을 유지한다.
//
// 사용:  node scripts/qa-merge.mjs A.json B.json C.json > merged.json
//        node scripts/qa-report.mjs merged.json --build 16 --json

import { readFileSync } from 'node:fs';

const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!files.length) {
  console.error('usage: node scripts/qa-merge.mjs <device1.json> [device2.json ...] > merged.json');
  process.exit(1);
}

const merged = { manifest: null, session: null, recent: [], snapshots: [] };
for (const f of files) {
  let o;
  try { o = JSON.parse(readFileSync(f, 'utf8')); }
  catch (e) { console.error(`skip ${f}: ${e.message}`); continue; }
  if (Array.isArray(o)) o = { recent: o };
  merged.manifest = merged.manifest || o.manifest || null;
  merged.session = merged.session || o.session || null;
  merged.recent.push(...(o.recent || o.records || []));
  merged.snapshots.push(...(o.snapshots || []));
}
// 시간순 정렬(ts 있는 것만; 없으면 원순서 유지) → 다기기 이벤트 인터리브 확인 용이.
merged.recent.sort((a, b) => (a.ts || 0) - (b.ts || 0));
process.stderr.write(`merged ${merged.recent.length} records from ${files.length} file(s)\n`);
console.log(JSON.stringify(merged, null, 2));
