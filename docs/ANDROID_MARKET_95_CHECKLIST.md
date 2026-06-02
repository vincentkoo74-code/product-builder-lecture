# Android Market 95% Release Checklist

This checklist tracks the Android release quality target for Maru's RPS.

## Current Verdict

- Target readiness: 95%
- Current estimate: 88%
- Status: keep iterating before paid/public store release
- Last updated by: Windows-Dex

## Required To Reach 95%

| Area | Status | Notes |
| --- | --- | --- |
| Debug build | Pass | Android Studio and emulator debug build works. |
| Web bundle build | Pass | `npm run build:web` must pass before every native build. |
| JS syntax smoke | Pass | `npm test` validates the single-file app script parses. |
| Android release build | In progress | Release build now uses R8 and resource shrinking; verify with `assembleRelease`. |
| Android native project source | Pass | Android source is tracked; generated build outputs and copied web assets stay ignored. |
| App ID | Pass | `com.maru.rps`. |
| Target SDK | Pass | Target SDK 35 satisfies current Google Play API requirement. |
| Runtime permissions | Pass | Internet-only permission footprint. |
| OAuth redirects | In progress | Kakao/LINE web and Android WebView redirects must be re-tested after each native build. |
| Multiplayer game flow | In progress | Needs repeated real-device network QA across host/guest/rematch/final result flows. |
| Small-screen layout | In progress | Small Phone and iPhone reports showed clipping; continue responsive checks. |
| Store icon/splash | In progress | Assets exist; final store icon selection and Play Console upload still required. |
| Release signing | Blocked by owner input | Requires Play upload keystore values. Gradle can read signing env vars when provided. |
| Privacy/Data Safety | In progress | Privacy page exists; Play Console Data Safety questionnaire still owner-entered. |
| CI deploy checks | Pass | GitHub production smoke and Supabase deploy workflows exist. |
| Telegram updates | In progress | CI now sends as "윈도우-덱스" when `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` secrets exist. |
| Gradle maintenance | Watch | Current build passes, but AGP/Capacitor deprecated API warnings should be cleaned up before long-term maintenance. |

## Release Signing Variables

When the upload keystore is ready, set these values in the local shell or CI before release build:

- `MARU_RELEASE_STORE_FILE`
- `MARU_RELEASE_STORE_PASSWORD`
- `MARU_RELEASE_KEY_ALIAS`
- `MARU_RELEASE_KEY_PASSWORD`

Without these values, Gradle can still build an unsigned release artifact for validation, but it is not ready for Play upload.

## Telegram Secrets

Add these GitHub repository secrets to enable update notifications:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

Notification sender text is fixed as `윈도우-덱스`.

## Next QA Loop

1. Run web syntax and build checks.
2. Run Android `assembleRelease`.
3. Install the debug build on one active emulator.
4. Test host creates room, guest joins, penalty save, ready, countdown, choice, draw rematch, final loser, stats, and leave-room.
5. Fix any regression, commit, push, and verify GitHub Actions.
