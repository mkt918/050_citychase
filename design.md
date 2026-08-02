# Design — City Chase (シティチェイス)

A locked design system for this app. Subsequent screens/components read this file
before emitting code; extend it rather than inventing a parallel system.

## Scope note

City Chase is a single-page **tool/game UI**, not a marketing site. The Hallmark
macrostructure catalogue (hero → features → pricing → footer) does not apply —
there is no macrostructure pick. Instead this file locks the **token system**
(colour, type, spacing, motion) and a bespoke **app layout** shared across the
app's three screens (Title, Online Lobby, Game).

## Genre
atmospheric — dark canvas, night-city chase, single warm accent, calm confident motion.

## Theme
Custom, Midnight-family: **"Nightbeat"**. Cool navy-slate paper (hue 250), one warm
amber accent for brand/CTA surfaces, plus two **functional** faction hues (police
cool-blue, criminal warm-red) that carry game state, not brand decoration — a
two-faction game legitimately needs a second and third hue to keep police/criminal
identifiable at a glance; both stay off the "brand accent" role.

- `--color-paper`   oklch(15% 0.014 250)
- `--color-ink`     oklch(94% 0.008 250)
- `--color-accent`  oklch(76% 0.16 60)  — warm amber, brand/CTA/focus only
- `--color-police`    oklch(72% 0.13 235) — functional, police units/panels only
- `--color-criminal`  oklch(70% 0.17 35)  — functional, criminal unit/panels only

Full token block lives in [`tokens.css`](tokens.css).

## Typography
- Display: Bricolage Grotesque, weight 700–800, roman only (no italic headers)
- Body: Geist, weight 400 (350 on dark surfaces per dark-mode optical-weight rule)
- Outlier: JetBrains Mono — reserved for exactly one role, the "tactical readout"
  (round counter + HUD coordinate/log timestamps). Not used anywhere else.
- Scale: `--text-xs` … `--text-display`, ratio ~1.25, defined in `tokens.css`.

## Spacing
4pt named scale (`--space-3xs` … `--space-3xl`) in `tokens.css`. No raw px in components.

## Motion
- Easings: `--ease-out` / `--ease-in` / `--ease-in-out` (see `tokens.css`) — never
  the browser default `ease`.
- Durations: micro 120ms, short 220ms, long 420ms.
- Reveal pattern: one board-mount fade+rise on screen transitions; no scroll-linked
  motion (the app has no scroll). Board-cell state changes (valid-move glow,
  searchlight, xray) are functional, not decorative, and stay under the 3-primitive
  cap: (1) selection pulse, (2) turn-transition crossfade, (3) result reveal.
- `prefers-reduced-motion: reduce` collapses all pulses/crossfades to ≤150ms opacity.

## Microinteractions stance
- Silent success (a placed helicopter or a confirmed move needs no toast — the
  board update *is* the feedback).
- Every action that changes turn state uses optimistic local render, since this is
  a turn-based game with an explicit confirm step already built in (`showConfirm`).
- Focus rings: instant, 2px, `--color-focus`, never animated in.

## App layout (shared across all three screens)

A single **HUD Command Center** frame, not a marketing macrostructure:

- **Top bar** — wordmark (left) · round/turn/connection HUD (centre-right, mono
  readout) · quit/leave action (right). Sticky, thin, `--color-paper-2`.
- **Title screen** — left-biased headline + mode cards (Local / vs AI / Online),
  asymmetric two-column (content 1.4fr, illustration/board-preview 1fr).
- **Online lobby** — room-code create/join panel, left-biased, HUD readout of
  connected players.
- **Game screen** — board fills the primary column (not centred: it sits left-biased
  on wide viewports), control rail docks right on desktop / becomes a bottom sheet
  under 60rem. Log console is part of the control rail, monospace.
- **Footer** — single inline line (rules link + version tag), title screen only;
  the game screen has no footer (vertical space goes to the board).

## CTA voice
- Primary CTA: filled `--color-accent`, `--color-accent-ink` text, `--radius-pill`,
  press = translateY(1px).
- Secondary: outline `--color-rule-2`, ink text.
- Destructive (quit game): outline `--color-danger`.

## What screens MUST share
Wordmark, accent placement rules, type pairing, spacing scale, CTA voice, the HUD
top bar, the 8-state interactive component discipline.

## What screens MAY differ on
Content composition within the HUD Command Center frame (title vs lobby vs board).

## Exports

### tokens.css
See [`tokens.css`](tokens.css) at the project root — imported by `src/style.css`.
