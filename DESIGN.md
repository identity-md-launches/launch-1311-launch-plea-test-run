# PLEA design system (test run 2 site, v11)

## Overview

PLEA is a public Sepolia court: holders buy a token, make a case to sell, and follow verdicts, seasons, the PLEA bonus and Laureates. The interface keeps the character of a private court from the v10 site: ink, parchment and wax red, generous space and restrained typography. The identity is the word **PLEA** set tightly in Instrument Serif; there is no logo icon.

The implementation lives in `web/src/style.css` (tokens and every component style), `components.tsx` (shared parts), `App.tsx` (the persistent shell), `pages.tsx` (Overview, Wall, Seasons, Profile, Status), `Plead.tsx` (plea form, plea actions, permalink page) and `Trade.tsx` (buy, sell and approved-sale forms, position). The Overview pairs a short introduction with the two actions; every other page starts with a title and one sentence, then its task. Live numbers support tasks; they never form a hero.

## Colors

Semantic tokens in `style.css` are the source of truth. `data-theme="dark"` on the root swaps them; the toggle stores the choice in `localStorage` and the initial theme follows the stored choice or the browser preference.

| Token / role | Light | Dark |
|---|---|---|
| `--bg`, page parchment | `#f4eee3` | `#211d19` |
| `--surface`, fields and plea cards | `#fcf8f0` | `#29241f` |
| `--hover`, control hover and muted fill | `#e9dfd0` | `#3a3028` |
| `--text`, primary ink | `#29231e` | `#f4ecdf` |
| `--muted`, supporting copy | `#6c6053` | `#c0b09c` |
| `--border`, separators and outlines | `#b6a997` | `#85735f` |
| `--accent`, primary action | `#7e2d29` | `#e5b6a0` |
| `--accent-hover` | `#65211e` | `#f3c7b1` |
| `--on-accent`, action text | `#fcf8f0` | `#352018` |
| `--error`, `--error-bg`, error notices | `#7e2d29` / `#f4dfd8` | `#f0b2a5` / `#402923` |
| `--success`, confirmed transaction and alive dot | `#38553b` | `#b4ccab` |
| `--focus`, keyboard outline | `#7e2d29` | `#e8c38a` |

Verdict states carry one colour each, as a text/fill pair used by both the wax seal (`.stamp`) and the small state tag (`.state-tag`), selected with `data-tone`:

| Tone (`data-tone`) | States | Light text / fill | Dark text / fill |
|---|---|---|---|
| `approved` | Approved, Executed, Overturned | `#38553b` / `#dfe9dc` | `#b4ccab` / `#2b3a2a` |
| `denied` | Denied, Upheld | `#7e2d29` / `#f4dfd8` | `#f0b2a5` / `#402923` |
| `pending` | Pending | `#7a4f0e` / `#f6e6c4` | `#e9c27a` / `#40331c` |
| `neutral` | No verdict, Expired, Lapsed | `#5f574f` / `#e6e0d6` | `#c9bfb2` / `#3a342e` |
| `gold` | Laureate | `#715416` / `#f1e5c2` | `#e3c581` / `#3e3421` |

The mapping is `toneOf` in `domain.ts`; the seal text always names the state, so colour is never the only cue. Measured text-on-fill contrast for every tone (round 3, `artifacts/browser-round3.json`): light 5.40–7.14:1, dark 6.77–7.45:1; body/page 13.44:1 light and 14.28:1 dark; muted/page 5.29:1 and 7.92:1. No neutral is pure black or grey.

## Typography

`main.tsx` imports self-hosted fonts through `@fontsource/instrument-serif` (Latin 400 and italic) and `@fontsource-variable/geist`; Vite emits them into `dist/assets/`, so there are no font CDN requests. The browser check confirmed both families loaded. Addresses use the system monospace stack; all numerals are tabular.

One scale of six sizes:

| Token | Size | Use |
|---|---|---|
| `--text-small` | 14px / .875rem | metadata, hints, tables, state tags, notices |
| `--text-body` | 16px / 1rem | body, controls, seal text |
| `--text-lead` | 18px / 1.125rem | introduction, h3, plea text on cards |
| `--text-title` | 24px / 1.5rem | h2, plea text on the permalink page, live figures |
| `--text-heading` | 36px / 2.25rem; 32px at ≤700px | h1 page titles |
| `--text-display` | 48px / 3rem; 40px at ≤700px | the PLEA wordmark |

Compared with v10, headings moved one step down (h1 from the display size to `--text-heading`, h2 to `--text-title`) and plea text on cards from 24px to 18px, with 16px card padding. Body line-height is 1.6; h1/h2 are Instrument Serif 400 at line-height 1.12 with −.02em / −.01em tracking; h3 is Geist 600. Paragraphs stop at 70ch, headings wrap balanced, and plea text keeps its own direction with `dir="auto"`. The navigation drops to 11.5px (0.72rem) only at ≤700px so all seven items share one row at 360px.

## Layout

One spacing scale: `--s1` to `--s9` = 4, 8, 12, 16, 24, 32, 48, 64 and 96px in rem. Header, main and footer share a 1200px maximum width with 32px side margins (16px at ≤700px). `intro-grid`, `two-column` and `detail-layout` are twelve-column grids with 48px gaps (32px on mobile); the task takes the wider span and supporting notes sit beside it. No card is nested in another card.

| Width | Behaviour |
|---|---|
| > 1050px | Wall and Laureate gallery in three columns; seven navigation items in one row of a 7-column grid. |
| 701–1050px | Wall and gallery in two columns; intro and side columns re-span. |
| 701–900px | Forms and the plea permalink become one column. |
| ≤ 700px | Every grid is one column; live strip two columns; the navigation becomes a flex row of seven items at least 44px wide and 44px tall, all visible; the leaderboard hides its Share column and prints the share under the wallet so the IMD and PLEA columns stay on screen; footer stacks. |

Round 3 of the browser check found no horizontal overflow on any of the 48 page/theme/width combinations, a clean 320px reflow, and the wordmark plus the Buy PLEA action inside the first screen at 390×844.

## Elevation, depth and shapes

Flat surfaces only: a tinted page, slightly lighter/darker cards and fields, 1px borders. No shadows, gradients, glass, blur, glow or modal layer; the skip link is the only fixed element. Controls and notices use a 3px radius; the season link and the state tag are pills; plea cards are square. The verdict seal keeps v10's irregular outline (`44% 49% 45% 48%`), inset ring and −9° rotation at 76px (68px at ≤700px, 64px as the small Laureate seal).

## Components

- **Shell (`App.tsx`)**: wordmark, Cabal clock line, season pill (`Season N · time left · pot X IMD + 5M PLEA` while the bonus applies), theme toggle and one Connect control on every page. Plead leaves the navigation after the Cabal dies. Hash routes update the title, scroll to the top and focus `main`.
- **`Stamp`** (`label`, `animate`, `small`) and **`StateTag`** (`state`): the seal and the small tag share the tone tokens. The only authored motion is `.stamp-arrives`: 550ms, `cubic-bezier(.16, 1, .3, 1)`, scale 1.35→1, rotation −16°→−9°, opacity 0→1, defined only under `prefers-reduced-motion: no-preference` (verified: `animationName` is `none` with reduced motion).
- **`PleaCard` / `PleaGrid`**: author (Laureates name or short address), text as text, amount, facts/need, judges' score, season points, state tag, Intake v2 failure line ("The panel gave no answer (reason). A of B answers agreed." with the record link), countdowns, appeal pairs (Denied #n → Overturned/Upheld tag #m), timestamp and explorer links.
- **`TxButton`**: one control per write with preparing / confirm-in-wallet / pending / confirmed states, explorer link, and errors decoded from the contracts' custom errors into plain words. Disabled without live data, a wallet, or while another write runs; `aria-busy` while working.
- **Forms** (`Plead.tsx`, `Trade.tsx`, `pages.tsx`): native labels, helper and error text next to the control, decimal input modes, live UTF-8 byte counter mirroring the Gate's `_validateText`, live fact score and need, live name availability with "This is your current name." for the owned name, and a previewed quote before any trade.
- **`Leaderboard`**: semantic table with caption and scoped headers; ten ranks, points, share, IMD prize and (seasons 1–4) PLEA bonus; "Rolls over" / "Burns" notes below the 60-point minimum; closed seasons show actual PrizePaid and BonusPaid amounts.
- **`Notice` / `Empty`**: status or alert roles, plain words and a next action.
- **`NFTGallery`, `OracleDetails`**: on-chain SVG Laureates with descriptive alt text; the judges' record with the Gate's failure split when the Intake cleared a plea.

Icons are Phosphor regular, used only for the theme toggle, external links, refresh and the confirmed/error marks.

## Do's and don'ts

Start a new route with the shell, `page-heading` and an existing grid. Reuse the semantic tokens, the six text sizes and the spacing scale; take every number from the live contracts. Use `TxButton` for every write. One primary action per task. Keep the wordmark typographic, cards flat, the seal motion unique and controls at least 44px. Do not add fonts, icon sets, nested cards, gradients, glass, glows, bounce or modals, and never signal a state by colour alone.

The pinned Better Interface guide (Jakub Krehel, MIT) and the Impeccable documentation method (Paul Bakaus, Apache-2.0) were applied during implementation and review; their notices are in `web/licenses/design-guidance.txt`. Coverage, findings and limits are recorded in `artifacts/validation.md`.
