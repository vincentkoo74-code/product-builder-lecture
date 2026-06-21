/*
 * Build8.1.2 마이그레이션 — Firebase 웹 앱 config (Path 1).
 *
 * ⚠️ 채워야 함: 아래 값은 Firebase Console → 프로젝트 설정 → "내 앱" → 웹 앱 추가에서 발급된다.
 *   - 이 값들은 모두 클라이언트 공개값(비밀 아님)이며 앱 번들에 포함된다.
 *   - 단, projectId 는 **Build8 서버의 FIREBASE_PROJECT_ID(=Fly secret)와 반드시 동일**해야 한다.
 *     불일치 시 서버 verifyIdToken 이 aud/iss 불일치로 모든 토큰을 거부한다.
 *   - JWT_AUDIENCE 가 서버에 설정돼 있으면 Firebase 토큰 aud(=projectId)와 일치해야 한다.
 *
 * 보안: 이 파일에는 서비스 계정 키(FIREBASE_PRIVATE_KEY)나 Supabase secret 을 절대 넣지 않는다.
 */
(function () {
  "use strict";

  // TODO(M1): Firebase Console 값으로 교체. projectId 는 서버 FIREBASE_PROJECT_ID 와 동일해야 함.
  var FIREBASE_CONFIG = {
    apiKey: "__FILL_FIREBASE_API_KEY__",
    authDomain: "__FILL_PROJECT_ID__.firebaseapp.com",
    projectId: "__FILL_PROJECT_ID__",
    appId: "__FILL_FIREBASE_APP_ID__",
    messagingSenderId: "__FILL_MESSAGING_SENDER_ID__",
  };

  // Build8 서버 (운영 배포). 변경 금지.
  var BUILD8 = {
    restBase: "https://rps-online-server.fly.dev",
    wsUrl: "wss://rps-online-server.fly.dev/v1/ws",
  };

  // 미설정 가드: placeholder 가 남아 있으면 잘못된 프로젝트로 토큰 발급되는 사고를 막는다.
  var unfilled = Object.keys(FIREBASE_CONFIG).filter(function (k) {
    return String(FIREBASE_CONFIG[k]).indexOf("__FILL_") === 0;
  });

  window.__BUILD8_FIREBASE_CONFIG__ = FIREBASE_CONFIG;
  window.__BUILD8_ENDPOINTS__ = BUILD8;
  window.__BUILD8_CONFIG_READY__ = unfilled.length === 0;
  if (unfilled.length > 0) {
    console.warn("[build8] Firebase config 미설정 필드: " + unfilled.join(", ") +
      " — ASSETS/build8/firebase-config.js 를 채워야 M1 인증이 동작합니다.");
  }
})();
