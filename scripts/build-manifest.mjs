// BUILD_MANIFEST.json 생성 로직 (테스트 가능하도록 build-web.mjs에서 분리).
// 규칙:
//  - root source는 절대 오염시키지 않는다. dist/BUILD_MANIFEST.json 으로만 출력.
//  - QA 빌드(qa=true): qa_enabled=true, release_mode="qa-testflight", dist_qa_flag=true
//  - 출시 빌드(qa=false): qa_enabled=false, release_mode="release", dist_qa_flag=false
//  - source_qa_flag 는 항상 false (index.html 원본 QA flag는 빌드와 무관하게 false 유지).
//  - region / supabase_project_ref: 이 산출물이 어느 국가 빌드인지 스탬프한다(KR|JP).

const PRODUCT = "WooriMaru RPS";
const ENGINE_VERSION = "v2";
const METRICS_SCHEMA = "v1";

// project.pbxproj 문자열에서 CURRENT_PROJECT_VERSION 추출.
export function readBuildNumber(pbxproj) {
  const m = String(pbxproj).match(/CURRENT_PROJECT_VERSION = (\d+);/);
  return m ? Number(m[1]) : null;
}

// 필수 필드 스키마로 manifest 객체 생성(순수 함수).
export function buildManifest({ qa, build, branch, commit, buildTime, region, supabaseProjectRef }) {
  return {
    product: PRODUCT,
    build,
    qa_enabled: qa === true,
    engine_version: ENGINE_VERSION,
    branch: branch || "unknown",
    git_commit: commit || "unknown",
    build_time: buildTime,
    metrics_schema: METRICS_SCHEMA,
    release_mode: qa ? "qa-testflight" : "release",
    // V1.0_JP: 국가 스탬프. config/active-region.json 이 단일 기준이며,
    // scripts/region-guard.mjs 가 산출물의 이 값과 선언 리전의 일치를 검사한다.
    // 오래된 타 국가 빌드 산출물이 섞여 있으면 여기서 드러난다.
    region: region || "unknown",
    supabase_project_ref: supabaseProjectRef || "unknown",
    source_qa_flag: false,
    dist_qa_flag: qa === true,
  };
}
