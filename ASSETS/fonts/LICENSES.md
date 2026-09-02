# 번들 폰트 라이선스

이 디렉터리의 폰트는 **SIL Open Font License 1.1 (OFL-1.1)** 로 배포된다.
아래 정보는 각 `.ttf` 파일의 `name` 테이블(copyright / license / licenseURL 레코드)에서
직접 읽어낸 것이며, 추정이 아니다. (확인일: 2026-09-02, Sprint JP-02C)

OFL-1.1 은 재배포·번들을 허용하되 **라이선스 고지를 동반할 것**을 요구한다.
이 파일이 그 고지다.

| 파일 | 버전 | 저작권 (name 테이블 원문) | 라이선스 |
|---|---|---|---|
| `Anton-Regular.ttf` | 2.116 | Copyright 2020 The Anton Project Authors (https://github.com/googlefonts/AntonFont.git) | OFL-1.1 |
| `BebasNeue-Regular.ttf` | 2.000 | Copyright 2019 The Bebas Neue Project Authors (https://github.com/dharmatype/Bebas-Neue) | OFL-1.1 |
| `MPLUSRounded1c-Regular.ttf` | 1.059.20150529 | Copyright 2016 The Rounded M+ Project Authors. | OFL-1.1 |
| `MPLUSRounded1c-Bold.ttf` | 1.059.20150529 | Copyright 2016 The Rounded M+ Project Authors. | OFL-1.1 |
| `MPLUSRounded1c-Black.ttf` | 1.059.20150529 | Copyright 2016 The Rounded M+ Project Authors. | OFL-1.1 |
| `ReggaeOne-Regular.ttf` | 1.100 | Copyright 2020 The Reggae Project Authors (https://github.com/fontworks-fonts/Reggae/) | OFL-1.1 |

각 파일의 `license` 레코드 원문은 동일하다:
> This Font Software is licensed under the SIL Open Font License, Version 1.1.

라이선스 전문: https://scripts.sil.org/OFL

## 사용처

| 로케일 | display | body / sub |
|---|---|---|
| ja | Reggae One → 일본어 시스템 스택 | M PLUS Rounded 1c (400/700/900) → 일본어 시스템 스택 |
| en | Bebas Neue → Anton → … | (Inter — 외부 CDN) |
| ko | (Black Han Sans — 외부 CDN) | (Noto Sans KR — 외부 CDN) |

**JP 로케일은 이 번들만으로 렌더링된다** — 외부 폰트 요청이 0건이다(JP-02C 실측).

## 하지 않은 것

- macOS / Windows 시스템 폰트를 복사하지 않았다
- 재배포 권한이 확인되지 않은 폰트를 커밋하지 않았다
- 사용하지 않는 weight/style 을 추가로 내려받지 않았다

KR/EN 이 쓰는 Google Fonts 가족(Noto Sans KR, Black Han Sans, Gowun Dodum, Inter)은
**번들하지 않았다** — 해당 로케일에서만 런타임에 CDN 으로 로드된다.
