import type { CapacitorConfig } from "@capacitor/cli";

// KR-B37(플랫폼 분리): webDir 을 플랫폼별로 가른다.
// dist 하나를 공유하면 `cap sync ios` 직후 `cap sync android` 가 iOS용 산출물을 그대로
// 집어가 두 플랫폼 패키지가 서로 오염된다. 경로로 격리하면 구조적으로 불가능해진다.
// MARU_PLATFORM 이 없으면 기존 "dist" 를 그대로 써서 웹 빌드 동작은 바뀌지 않는다.
const platform = process.env.MARU_PLATFORM;
const webDir = platform === "ios" || platform === "android" ? `dist/${platform}-kr` : "dist";

const config: CapacitorConfig = {
  appId: "com.maru.rps",
  appName: "마루의 가위바위보",
  webDir,
  bundledWebRuntime: false,
  server: {
    androidScheme: "https"
  },
  ios: {
    contentInset: "automatic"
  }
};

export default config;
