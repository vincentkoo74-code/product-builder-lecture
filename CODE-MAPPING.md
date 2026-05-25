# Code ↔ Figma Mapping

Manual mapping between Figma components and CSS classes/lines in `index.html`.
(Code Connect requires Org/Enterprise Dev seat — this file is the fallback lookup.)

**Figma file:** [마루의 가위바위보 — Design System](https://www.figma.com/design/AKXbzeft6ZmYfIJhSBYbDR)

## Atoms

| Figma Component | Node ID | CSS Class | index.html line | Usage |
|---|---|---|---|---|
| `Saekdong/Band-Vertical` | [34:2](https://www.figma.com/design/AKXbzeft6ZmYfIJhSBYbDR?node-id=34-2) | `.saekdong-v` | [L739](index.html#L739) | `<div class="saekdong-v"><span></span>×7</div>` — vertical 7-color rainbow band on `.maru-card` left edge |
| `Saekdong/Band-Horizontal` | [34:10](https://www.figma.com/design/AKXbzeft6ZmYfIJhSBYbDR?node-id=34-10) | `.saekdong-edge` | [L727](index.html#L727) | `<div class="saekdong-edge"><span></span>×7</div>` |
| `VRShow-Cap (default)` | [34:18](https://www.figma.com/design/AKXbzeft6ZmYfIJhSBYbDR?node-id=34-18) | `.vrshow-cap` | [L978](index.html#L978) | `<div class="vrshow-cap">오늘의 한 판!</div>` — yellow stamp caption |
| `VRShow-Cap (lg)` | [34:20](https://www.figma.com/design/AKXbzeft6ZmYfIJhSBYbDR?node-id=34-20) | `.vrshow-cap.vrshow-cap-lg` | [L251](index.html#L251) | `<div class="vrshow-cap vrshow-cap-lg">방장 모드!</div>` — 24px nowrap variant for screen headers |
| `GoPill` | [36:2](https://www.figma.com/design/AKXbzeft6ZmYfIJhSBYbDR?node-id=36-2) | `.go-pill` | [L1035](index.html#L1035) | `<span class="go-pill">GO</span>` — inline pill inside `.btn-kparty` |
| `Button/Kparty` | [36:4](https://www.figma.com/design/AKXbzeft6ZmYfIJhSBYbDR?node-id=36-4) | `.btn-kparty` | [L1018](index.html#L1018) | Primary CTA. Rainbow stripe (8px) + orange gradient + GO pill |
| `Card/Maru` | [36:9](https://www.figma.com/design/AKXbzeft6ZmYfIJhSBYbDR?node-id=36-9) | `.card.maru-card` | [L1011](index.html#L1011) | Base screen container with saekdong band + shadow |
| `Button/ChoiceCard` | [36:20](https://www.figma.com/design/AKXbzeft6ZmYfIJhSBYbDR?node-id=36-20) | `.choice-button` | [L867](index.html#L867) | Game choice button (가위/바위/보) with maru hand image |

## Design Tokens (Variables)

| Figma Variable | CSS Custom Property | Notes |
|---|---|---|
| `Primitives/cream/50` | `--cream` / `--bg` | `#FFF8EC` |
| `Primitives/cream/100` | `--cream-2` | `#FFEFD3` |
| `Primitives/cream/200` | `--line` | `#F0E4D0` — border color |
| `Primitives/orange/400` | `--orange` / `--primary` | `#F5A356` |
| `Primitives/orange/500` | `--orange-deep` / `--primary-dark` | `#E48638` |
| `Primitives/pink/300` | `--pink` | `#FFB8C7` |
| `Primitives/gold/400` | `--gold` | `#FFC93C` |
| `Primitives/lime/400` | `--lime` | `#7ED957` |
| `Primitives/sky/400` | `--sky` | `#4DB8FF` |
| `Primitives/red/500` | `--maru-red` | `#E63946` |
| `Primitives/indigo/500` | `--maru-indigo` | `#2E3192` |
| `Primitives/purple/400` | `--maru-purple` | `#A05FBF` |
| `Primitives/brown/700` | `--text` | `#3D2B1F` |
| `Primitives/brown/400` | `--muted` | `#8C7563` |
| `Primitives/green/600` | `--success` | `#16A34A` |
| `Primitives/red/600` | `--danger` | `#DC2626` |
| `Primitives/amber/500` | `--warning` | `#F59E0B` |
| `Saekdong/1-red` … `7-purple` | — | 7-color brand palette |
| `Color/bg/cream` (alias) | `--bg` | Semantic alias to `cream/50` |
| `Color/text/primary` (alias) | `--text` | Semantic alias to `brown/700` |
| `Color/brand/orange` (alias) | `--primary` | Semantic alias to `orange/400` |

## Text Styles

| Figma Text Style | Font | Used on |
|---|---|---|
| `display/lg-46` | Black Han Sans 46 | Home `가위바위보!` title |
| `display/md-26` | Black Han Sans 26 | `.maru-title` |
| `display/sm-24` | Black Han Sans 24 | `.vrshow-cap-lg` |
| `display/xs-18` | Black Han Sans 18 | `.vrshow-cap` (default), section labels |
| `display/code-32` | Black Han Sans 32 (letter-spacing 3) | Room code `.code-text` |
| `heading/h1-30` | Noto Sans KR Black 30 | `h1` |
| `heading/h2-23` | Noto Sans KR Black 23 | `h2` |
| `heading/h3-16` | Noto Sans KR Bold 16 | `h3` |
| `heading/result-42` | Noto Sans KR Black 42 | `.result-title` |
| `body/md-14`, `md-15`, `bold-14`, `bold-15`, `sm-12`, `sm-13` | Noto Sans KR | Body text variants |
| `button/lg-15` | Noto Sans KR Black 15 | Primary buttons |
| `sub/md-13`, `sm-12`, `xs-11` | Gowun Dodum | Soft sub-text |

## Effect Styles (Shadows)

| Figma Style | CSS | Used on |
|---|---|---|
| `shadow/card` | `0 18px 40px rgba(228,134,56,0.18)` | `.maru-card` |
| `shadow/btn-kparty` | `0 8px 18px rgba(245,163,86,0.35)` | `.btn-kparty` |
| `shadow/maru-corner` | `0 8px 16px rgba(245,163,86,0.4)` | `.maru-corner` |
| `shadow/cap-hard` | `0 6px 0 #E48638` | `.vrshow-cap` |
| `shadow/popup` | `0 20px 60px rgba(0,0,0,0.3)` | `.popup-card` |
| `shadow/stamp` | `0 6px 14px rgba(230,57,70,0.35)` | (reserved) |

## Screens (Frames)

| Frame | Node ID | Screen Section ID (HTML) |
|---|---|---|
| `01-Auth` | [7:2](https://www.figma.com/design/AKXbzeft6ZmYfIJhSBYbDR?node-id=7-2) | `#screenAuth` |
| `02-Home` | [7:3](https://www.figma.com/design/AKXbzeft6ZmYfIJhSBYbDR?node-id=7-3) | `#screenHome` |
| `03-QR-Scanner` | [7:4](https://www.figma.com/design/AKXbzeft6ZmYfIJhSBYbDR?node-id=7-4) | `#screenQrScanner` |
| `04-Host-Room` | [7:5](https://www.figma.com/design/AKXbzeft6ZmYfIJhSBYbDR?node-id=7-5) | `#screenHostRoom` |
| `05-Join` | [7:6](https://www.figma.com/design/AKXbzeft6ZmYfIJhSBYbDR?node-id=7-6) | `#screenJoin` |
| `06-Participant-Wait` | [7:7](https://www.figma.com/design/AKXbzeft6ZmYfIJhSBYbDR?node-id=7-7) | `#screenParticipantWait` |
| `07-Penalty` | [7:8](https://www.figma.com/design/AKXbzeft6ZmYfIJhSBYbDR?node-id=7-8) | `#screenPenalty` |
| `08-Lobby` | [7:9](https://www.figma.com/design/AKXbzeft6ZmYfIJhSBYbDR?node-id=7-9) | `#screenLobby` |
| `09-Ready` | [7:10](https://www.figma.com/design/AKXbzeft6ZmYfIJhSBYbDR?node-id=7-10) | `#screenReady` |
| `10-Game` | [7:11](https://www.figma.com/design/AKXbzeft6ZmYfIJhSBYbDR?node-id=7-11) | `#screenGame` |
| `11-Host-Playing` | [7:12](https://www.figma.com/design/AKXbzeft6ZmYfIJhSBYbDR?node-id=7-12) | `#screenHostPlaying` |
| `12-Round-Result` | [7:13](https://www.figma.com/design/AKXbzeft6ZmYfIJhSBYbDR?node-id=7-13) | `#screenRoundResult` |
| `13-Winner-Wait` | [7:14](https://www.figma.com/design/AKXbzeft6ZmYfIJhSBYbDR?node-id=7-14) | `#screenWinnerWait` |
| `14-Loser-Wait` | [7:15](https://www.figma.com/design/AKXbzeft6ZmYfIJhSBYbDR?node-id=7-15) | `#screenLoserWait` |
| `15-Stats` | [7:16](https://www.figma.com/design/AKXbzeft6ZmYfIJhSBYbDR?node-id=7-16) | `#screenStats` |

## How to update

1. **Edit code first** in `index.html` (CSS class or screen markup)
2. **Re-capture screen** via gstack: `$B screenshot --selector ".app" "$HOME/maru-screens/screen{Name}.png"`
3. **Upload to Figma**: get a new submit URL via `mcp__figma__upload_assets` (with the frame nodeId), POST the PNG, then apply imageHash via `mcp__figma__use_figma`
4. **Update this file** if you added/removed/renamed components or tokens

## How to use Figma → Code

1. Inspect any component in Figma (Atoms page)
2. Read its description (auto-populated with CSS class + line number)
3. Open the indicated line in `index.html`
4. CSS variables and semantic names match — `--primary`, `--maru-red`, `var(--space-16)` etc.
