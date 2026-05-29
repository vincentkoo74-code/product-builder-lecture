import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.maru.rps",
  appName: "마루의 가위바위보",
  webDir: "dist",
  bundledWebRuntime: false,
  server: {
    androidScheme: "https"
  },
  ios: {
    contentInset: "automatic"
  }
};

export default config;
