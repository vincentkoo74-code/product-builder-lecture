import { describe, it, expect } from 'vitest';
import { buildManifest, readBuildNumber } from '../scripts/build-manifest.mjs';

// Build15 — BUILD_MANIFEST.json 생성 로직 검증(QA/release 값 분기, source 무오염 보장).

describe('BUILD_MANIFEST', () => {
  const common = { build: 15, branch: 'feature/rps-v2-engine', commit: 'abc123', buildTime: '2026-07-01T00:00:00.000Z' };

  it('QA 빌드 → qa_enabled/dist_qa_flag true, mode=qa-testflight', () => {
    const m = buildManifest({ qa: true, ...common });
    expect(m.product).toBe('WooriMaru RPS');
    expect(m.build).toBe(15);
    expect(m.qa_enabled).toBe(true);
    expect(m.engine_version).toBe('v2');
    expect(m.metrics_schema).toBe('v1');
    expect(m.release_mode).toBe('qa-testflight');
    expect(m.dist_qa_flag).toBe(true);
    expect(m.source_qa_flag).toBe(false); // root source는 항상 OFF
  });

  it('release 빌드 → qa_enabled/dist_qa_flag false, mode=release', () => {
    const m = buildManifest({ qa: false, ...common });
    expect(m.qa_enabled).toBe(false);
    expect(m.release_mode).toBe('release');
    expect(m.dist_qa_flag).toBe(false);
    expect(m.source_qa_flag).toBe(false);
  });

  it('필수 필드가 모두 존재한다', () => {
    const m = buildManifest({ qa: true, ...common });
    for (const k of ['product','build','qa_enabled','engine_version','branch','git_commit','build_time','metrics_schema','release_mode','source_qa_flag','dist_qa_flag']) {
      expect(m).toHaveProperty(k);
    }
  });

  it('git 정보 누락 시 unknown 폴백', () => {
    const m = buildManifest({ qa: false, build: 15, buildTime: 't' });
    expect(m.branch).toBe('unknown');
    expect(m.git_commit).toBe('unknown');
  });

  it('readBuildNumber: pbxproj에서 CURRENT_PROJECT_VERSION 추출', () => {
    expect(readBuildNumber('foo CURRENT_PROJECT_VERSION = 15;\nbar CURRENT_PROJECT_VERSION = 15;')).toBe(15);
    expect(readBuildNumber('no version here')).toBe(null);
  });
});
