// BUILD_MANIFEST.json 생성 로직 (테스트 가능하도록 build-web.mjs에서 분리).
// 규칙:
//  - root source는 절대 오염시키지 않는다. dist/BUILD_MANIFEST.json 으로만 출력.
//  - QA 빌드(qa=true): qa_enabled=true, release_mode="qa-testflight", dist_qa_flag=true
//  - 출시 빌드(qa=false): qa_enabled=false, release_mode="release", dist_qa_flag=false
//  - source_qa_flag 는 항상 false (index.html 원본 QA flag는 빌드와 무관하게 false 유지).

const PRODUCT = "WooriMaru RPS";
const ENGINE_VERSION = "v2";
const METRICS_SCHEMA = "v1";

// project.pbxproj 문자열에서 CURRENT_PROJECT_VERSION 추출.
export function readBuildNumber(pbxproj) {
  const m = String(pbxproj).match(/CURRENT_PROJECT_VERSION = (\d+);/);
  return m ? Number(m[1]) : null;
}

// KR-B37(플랫폼 분리): 산출물만 보고 어느 플랫폼/리전/백엔드인지 판별할 수 있어야 한다.
// 종전 manifest에는 platform 필드가 아예 없어 dist 하나를 ios/android가 공유해도 구분이 불가능했다.
export const KR_BACKEND_REF = "sannrfmhevebqgfdqcps";   // Seoul (ap-northeast-2)
export const JP_BACKEND_REF = "cmfxhehpreanijwanwrr";   // Tokyo — KR 산출물에 등장하면 위반
export const RELEASE_LABEL = "KR-B41";                  // 플랫폼 공통 추적 키(버전 필드와 별개)
export const VALID_PLATFORMS = ["web", "ios", "android"];

// 필수 필드 스키마로 manifest 객체 생성(순수 함수).
export function buildManifest({ qa, build, branch, commit, buildTime,
                                platform, region, backendRef, releaseLabel }) {
  return {
    product: PRODUCT,
    platform: platform || "web",
    region: region || "KR",
    backend_ref: backendRef || KR_BACKEND_REF,
    release_label: releaseLabel || RELEASE_LABEL,
    build,
    qa_enabled: qa === true,
    engine_version: ENGINE_VERSION,
    branch: branch || "unknown",
    git_commit: commit || "unknown",
    build_time: buildTime,
    metrics_schema: METRICS_SCHEMA,
    release_mode: qa ? "qa-testflight" : "release",
    source_qa_flag: false,
    dist_qa_flag: qa === true,
  };
}
