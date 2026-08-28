import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { buildManifest, KR_BACKEND_REF, JP_BACKEND_REF, RELEASE_LABEL } from '../scripts/build-manifest.mjs';

// ════════════════════════════════════════════════════════════════════════════
// KR-B37 플랫폼 분리 게이트 (T1~T12)
//
// 목적: iOS KR 과 Android KR 이 같은 공용 게임 로직을 쓰되, 빌드 설정·산출물·메타데이터가
//       서로 오염되지 않는 것을 **구조적으로** 보장한다.
//
// 원칙: fail-closed. 지정 누락은 "기본값으로 진행"이 아니라 빌드 실패다 —
//       잘못된 백엔드/리전/공유URL을 실은 패키지가 조용히 만들어지면 필드 QA 증적이
//       통째로 오염되고, 그 사실을 나중에 알 방법이 없다.
// ════════════════════════════════════════════════════════════════════════════

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const buildWeb = readFileSync(join(ROOT, 'scripts/build-web.mjs'), 'utf8');
const capConfig = readFileSync(join(ROOT, 'capacitor.config.ts'), 'utf8');

const readManifest = (p) => {
  const f = join(ROOT, p);
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
};
const IOS_M = () => readManifest('dist/ios-kr/BUILD_MANIFEST.json');
const AND_M = () => readManifest('dist/android-kr/BUILD_MANIFEST.json');

/** build-web.mjs 를 주어진 env 로 실행하고 성공 여부를 돌려준다. */
function runBuild(env) {
  try {
    execFileSync(process.execPath, ['scripts/build-web.mjs'],
      { cwd: ROOT, env: { ...process.env, ...env }, stdio: 'pipe' });
    return { ok: true, err: '' };
  } catch (e) {
    return { ok: false, err: String(e.stderr || e.stdout || e.message) };
  }
}

describe('소스 기본값 — release-safe', () => {
  it('[T9] index.html 의 SHARE_BASE_URL 기본값은 빈 문자열이다', () => {
    expect(html).toContain('const SHARE_BASE_URL = "" /*__SHARE_BASE_URL__*/;');
  });
  it('[T9] index.html 의 QA 플래그 기본값은 false 다', () => {
    expect(html).toContain('const __QA_BUILD__ = false /*__QA_BUILD_FLAG__*/;');
  });
  it('공용 소스에 public share URL 리터럴을 박지 않았다', () => {
    const decl = /const SHARE_BASE_URL = "([^"]*)"/.exec(html);
    expect(decl && decl[1], 'build-time 주입이어야 한다').toBe('');
  });
});

describe('fail-closed 계약 — 지정 누락은 빌드 실패다', () => {
  it('[T11] MARU_PLATFORM 없이 네이티브 값을 주면 웹 빌드로 처리되고 주입은 일어나지 않는다', () => {
    // PLATFORM 이 없으면 isNative=false → 주입도, 플랫폼 격리도 없다. 그 사실을 고정한다.
    expect(buildWeb).toContain('const isNative = PLATFORM === "ios" || PLATFORM === "android";');
    expect(buildWeb).toContain('const OUT_DIR = isNative ? `dist/${PLATFORM}-kr/` : "dist/";');
  });

  it('[T10] 네이티브 빌드에서 SHARE_BASE_URL 미주입이면 실패한다 (REAL 실행)', () => {
    const r = runBuild({ MARU_PLATFORM: 'android', MARU_REGION: 'KR', MARU_SHARE_BASE_URL: '' });
    expect(r.ok, '미주입인데 빌드가 성공했다').toBe(false);
    expect(r.err).toContain('MARU_SHARE_BASE_URL');
  });

  it('[T12] REGION 이 KR 이 아니면 실패한다 (REAL 실행)', () => {
    const r = runBuild({ MARU_PLATFORM: 'android', MARU_REGION: 'JP',
      MARU_SHARE_BASE_URL: 'https://product-builder-lecture-phi.vercel.app/' });
    expect(r.ok, 'JP 리전인데 빌드가 성공했다').toBe(false);
    expect(r.err).toContain('KR');
  });

  it('[T12] REGION 미지정이면 실패한다 (REAL 실행)', () => {
    const r = runBuild({ MARU_PLATFORM: 'ios', MARU_REGION: '',
      MARU_SHARE_BASE_URL: 'https://product-builder-lecture-phi.vercel.app/' });
    expect(r.ok).toBe(false);
    expect(r.err).toContain('MARU_REGION');
  });

  it('[T7] 외부에서 열 수 없는 share base 는 전부 거부한다 (REAL 실행)', () => {
    const banned = [
      'https://localhost/', 'https://127.0.0.1/', 'https://192.168.1.6/',
      'capacitor://localhost/', 'http://product-builder-lecture-phi.vercel.app/',
    ];
    const survived = [];
    for (const base of banned) {
      const r = runBuild({ MARU_PLATFORM: 'android', MARU_REGION: 'KR', MARU_SHARE_BASE_URL: base });
      if (r.ok) survived.push(base);
    }
    expect(survived, '외부에서 열 수 없는 base 가 통과했다').toEqual([]);
  });

  it('유효하지 않은 PLATFORM 값은 거부한다 (REAL 실행)', () => {
    const r = runBuild({ MARU_PLATFORM: 'windows', MARU_REGION: 'KR',
      MARU_SHARE_BASE_URL: 'https://product-builder-lecture-phi.vercel.app/' });
    expect(r.ok).toBe(false);
    expect(r.err).toContain('MARU_PLATFORM');
  });
});

describe('출력 격리 — 경로로 갈라 놓는다', () => {
  it('[T8] capacitor webDir 이 플랫폼별 경로를 쓴다', () => {
    expect(capConfig).toContain('const platform = process.env.MARU_PLATFORM;');
    expect(capConfig).toContain('`dist/${platform}-kr`');
  });
  it('[T8] MARU_PLATFORM 없으면 기존 dist 를 그대로 쓴다 (웹 빌드 회귀 없음)', () => {
    expect(capConfig).toMatch(/\? `dist\/\$\{platform\}-kr` : "dist"/);
  });
});

const built = () => IOS_M() && AND_M();
const maybe = built() ? describe : describe.skip;

maybe('산출물 manifest — 빌드 후에만 검사', () => {
  it('[T3] Android manifest 의 platform 은 android 다', () => {
    expect(AND_M().platform).toBe('android');
  });
  it('[T4] iOS manifest 의 platform 은 ios 다', () => {
    expect(IOS_M().platform).toBe('ios');
  });
  it('[T5] 양 플랫폼 backend_ref 가 Seoul 이다', () => {
    expect(AND_M().backend_ref).toBe(KR_BACKEND_REF);
    expect(IOS_M().backend_ref).toBe(KR_BACKEND_REF);
  });
  it('[T2] 양 플랫폼 region 이 KR 이다', () => {
    expect(AND_M().region).toBe('KR');
    expect(IOS_M().region).toBe('KR');
  });
  it('release_label 이 플랫폼 공통 추적 키다', () => {
    expect(AND_M().release_label).toBe(RELEASE_LABEL);
    expect(IOS_M().release_label).toBe(RELEASE_LABEL);
  });
  it('버전 필드를 플랫폼 간 공유하지 않는다', () => {
    // manifest.build 는 iOS 의 CURRENT_PROJECT_VERSION 이다. Android versionCode 는 gradle 소관.
    const gradle = readFileSync(join(ROOT, 'android/app/build.gradle'), 'utf8');
    expect(gradle).toContain('versionCode 3801');
    expect(gradle).toContain('versionName "1.0-KR-B38"');
    expect(String(AND_M().build)).not.toBe('3801');   // 같은 필드로 억지 공유 금지
  });

  it('[T1] 어느 산출물에도 Tokyo ref 가 없다', () => {
    for (const p of ['dist/ios-kr/index.html', 'dist/android-kr/index.html']) {
      const s = readFileSync(join(ROOT, p), 'utf8');
      expect(s.includes(JP_BACKEND_REF), `${p} 에 Tokyo ref`).toBe(false);
      expect(s.includes(KR_BACKEND_REF), `${p} 에 Seoul ref 없음`).toBe(true);
    }
  });

  it('[T7] 양 플랫폼 산출물의 canonical share URL 이 계약을 만족한다', () => {
    for (const p of ['dist/ios-kr/index.html', 'dist/android-kr/index.html']) {
      const s = readFileSync(join(ROOT, p), 'utf8');
      const v = (/const SHARE_BASE_URL = "([^"]*)"/.exec(s) || [])[1];
      expect(v, `${p} 주입 안 됨`).toBeTruthy();
      expect(v).toMatch(/^https:\/\//);
      expect(v).not.toMatch(/localhost|127\.0\.0\.1|192\.168\.|capacitor:\/\//);
    }
  });

  it('[T6] iOS 산출물이 Android 전용 경로/값을 참조하지 않는다', () => {
    const ios = readFileSync(join(ROOT, 'dist/ios-kr/index.html'), 'utf8');
    expect(ios.includes('android-kr'), 'iOS 산출물에 android 경로').toBe(false);
    expect(IOS_M().platform).not.toBe('android');
  });
});

describe('manifest 순수 함수 계약', () => {
  it('platform 미지정 시 web 으로, backend_ref 는 Seoul 로 채운다', () => {
    const m = buildManifest({ qa: true, build: 37, branch: 'b', commit: 'c', buildTime: 't' });
    expect(m.platform).toBe('web');
    expect(m.region).toBe('KR');
    expect(m.backend_ref).toBe(KR_BACKEND_REF);
    expect(m.release_label).toBe(RELEASE_LABEL);
  });
  it('KR 과 JP ref 상수가 서로 다르다 (가드가 공허해지지 않도록)', () => {
    expect(KR_BACKEND_REF).not.toBe(JP_BACKEND_REF);
    expect(KR_BACKEND_REF).toBe('sannrfmhevebqgfdqcps');
    expect(JP_BACKEND_REF).toBe('cmfxhehpreanijwanwrr');
  });
});
