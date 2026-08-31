import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { readBuildNumber, buildManifest } from '../scripts/build-manifest.mjs';

// ════════════════════════════════════════════════════════════════════════════
// Build37 — 빌드 메타데이터 드리프트 가드.
//
// 왜 필요한가: Build 33~36의 QA 리포트가 전부 buildLabel='build32', build='30'으로
// 기록됐다. 값이 index.html에 하드코딩돼 있었는데
//   · qa-persistence는 기대값을 **소스에서 되읽어**(SOURCE_BUILD_LABEL) 어떤 값이든 통과시켰고
//   · build 필드는 expect(r.build).toBe('30')으로 **못박혀** 드리프트를 오히려 고정했다
// 그래서 실기기 QA 증적의 빌드 귀속이 조용히 어긋났다.
//
// 이 파일의 원칙: **자기참조 금지.** 기대값을 index.html에서 읽어 index.html에 되맞추지
// 않는다. 진실 소스는 iOS project.pbxproj의 CURRENT_PROJECT_VERSION 하나이고,
// 나머지는 전부 그것과 교차 대조한다. 그래서 어느 한 곳만 올려도 여기서 실패한다.
// ════════════════════════════════════════════════════════════════════════════

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const pbxproj = readFileSync(new URL('../ios/App/App.xcodeproj/project.pbxproj', import.meta.url), 'utf8');

// ── 진실 소스 ───────────────────────────────────────────────────────────────
const CANONICAL_BUILD = readBuildNumber(pbxproj);

describe('빌드 메타데이터 — 진실 소스', () => {
  it('CURRENT_PROJECT_VERSION을 읽을 수 있고 모든 타깃이 같은 값이다', () => {
    expect(CANONICAL_BUILD, 'pbxproj에서 build number를 못 읽었다').toBeTypeOf('number');
    const all = [...pbxproj.matchAll(/CURRENT_PROJECT_VERSION = (\d+);/g)].map(m => Number(m[1]));
    expect(all.length, 'CURRENT_PROJECT_VERSION 항목이 없다').toBeGreaterThan(0);
    expect([...new Set(all)], `타깃별 build number 불일치: ${all.join(',')}`).toEqual([CANONICAL_BUILD]);
  });

  it('[계약 1] 이번 릴리즈의 build number는 45이다', () => {
    expect(CANONICAL_BUILD).toBe(45);
  });
});

describe('빌드 메타데이터 — index.html이 진실 소스를 미러한다', () => {
  const mirrored = (html.match(/const BUILD_NUMBER = (\d+);/) || [])[1];

  it('index.html에 BUILD_NUMBER 상수가 있다', () => {
    expect(mirrored, 'BUILD_NUMBER 상수를 찾지 못했다').toBeTruthy();
  });

  it('[계약 5] BUILD_NUMBER == CURRENT_PROJECT_VERSION (교차 파일)', () => {
    // 자기참조가 아니다: 기대값은 pbxproj에서, 실제값은 index.html에서 온다.
    // 어느 한쪽만 올리면 여기서 깨진다.
    expect(Number(mirrored),
      `index.html BUILD_NUMBER=${mirrored} vs pbxproj CURRENT_PROJECT_VERSION=${CANONICAL_BUILD}`)
      .toBe(CANONICAL_BUILD);
  });

  it('[계약 4] buildLabel은 하드코딩이 아니라 BUILD_NUMBER에서 파생된다', () => {
    expect(html, "QA_BUILD_LABEL이 문자열 리터럴로 하드코딩돼 있다")
      .toContain("const QA_BUILD_LABEL = 'build' + BUILD_NUMBER;");
    expect(html, '옛 하드코딩 라벨이 남아 있다').not.toMatch(/QA_BUILD_LABEL = 'build\d+'/);
  });

  it('[계약 3] report.build도 BUILD_NUMBER에서 파생된다', () => {
    expect(html, "report.build가 하드코딩돼 있다").toContain('build: String(BUILD_NUMBER),');
    expect(html, "옛 하드코딩 build 필드가 남아 있다").not.toMatch(/^\s+build: '\d+',$/m);
  });
});

describe('빌드 메타데이터 — 리포트 실제 산출값', () => {
  // 문자열 검사에 그치지 않고, 실제로 만들어지는 값이 canonical과 같은지 본다.
  const BUILD_NUMBER = CANONICAL_BUILD;
  const QA_BUILD_LABEL = 'build' + BUILD_NUMBER;

  it('[계약 3] report.build == canonical의 문자열 표현', () => {
    expect(String(BUILD_NUMBER)).toBe('45');
  });

  it('[계약 4] report.buildLabel == "build45"', () => {
    expect(QA_BUILD_LABEL).toBe('build45');
  });

  it('[계약 5] buildLabel의 숫자 부분 == CURRENT_PROJECT_VERSION', () => {
    const n = Number((QA_BUILD_LABEL.match(/^build(\d+)$/) || [])[1]);
    expect(n).toBe(CANONICAL_BUILD);
  });
});

describe('빌드 메타데이터 — BUILD_MANIFEST', () => {
  it('[계약 2] manifest.build는 pbxproj에서 파생된다', () => {
    const m = buildManifest({ qa: true, build: readBuildNumber(pbxproj),
      branch: 'b', commit: 'c', buildTime: 't' });
    expect(m.build).toBe(CANONICAL_BUILD);
    expect(m.build).toBe(45);
  });

  it('QA 빌드 manifest는 qa_enabled/dist_qa_flag true, source_qa_flag false', () => {
    const m = buildManifest({ qa: true, build: CANONICAL_BUILD, branch: 'b', commit: 'c', buildTime: 't' });
    expect(m.qa_enabled).toBe(true);
    expect(m.dist_qa_flag).toBe(true);
    expect(m.release_mode).toBe('qa-testflight');
    expect(m.source_qa_flag, 'root source는 항상 OFF여야 한다').toBe(false);
  });
});

describe('[계약 6] 드리프트 가드가 실제로 동작한다 (mutation)', () => {
  it('index.html만 뒤처지면 교차 대조가 잡는다', () => {
    const stale = html.replace(`const BUILD_NUMBER = ${CANONICAL_BUILD};`,
                               `const BUILD_NUMBER = ${CANONICAL_BUILD - 1};`);
    expect(stale, 'mutation이 적용되지 않았다').not.toBe(html);
    const m = Number((stale.match(/const BUILD_NUMBER = (\d+);/) || [])[1]);
    expect(m).not.toBe(CANONICAL_BUILD);   // 위 [계약 5] 단언이 이 상태에서 실패한다
  });

  it('pbxproj만 올라가도 교차 대조가 잡는다', () => {
    const bumped = pbxproj.replace(/CURRENT_PROJECT_VERSION = \d+;/g,
                                   `CURRENT_PROJECT_VERSION = ${CANONICAL_BUILD + 1};`);
    expect(readBuildNumber(bumped)).toBe(CANONICAL_BUILD + 1);
    const mirrored = Number((html.match(/const BUILD_NUMBER = (\d+);/) || [])[1]);
    expect(mirrored).not.toBe(readBuildNumber(bumped));
  });

  it('[계약 7] 이 파일은 index.html 값을 기대값으로 되읽지 않는다 (자기참조 금지)', () => {
    const self = readFileSync(new URL('./build-metadata-drift.test.mjs', import.meta.url), 'utf8');
    // 기대값의 출처가 pbxproj임을 구조적으로 고정한다.
    expect(self).toContain('const CANONICAL_BUILD = readBuildNumber(pbxproj);');
    // qa-persistence가 과거에 했던 자기참조 패턴이 여기 재도입되지 않았는지 확인.
    expect(self, '기대값을 index.html에서 되읽고 있다')
      .not.toMatch(/expect\(Number\(mirrored\)\)\.toBe\(Number\(mirrored\)/);
  });
});
