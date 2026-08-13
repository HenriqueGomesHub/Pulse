DESIGN STYLE — "Quiet Precision" (Attio-inspired, less-is-better):
- Grayscale-first. Text #0A0B0D on #FFFFFF; secondary #5C5E63; tertiary #9B9DA1;
  borders #E8E9EB (1px hairlines everywhere, shadows nearly invisible).
- ONE accent: #276BF0, max 3 uses per screen (primary CTA, links, focus).
  Primary buttons are DARK (#1C1D1F), not blue.
- Color only for data: low-sat tinted pills (green #E7F6EC/#1B7A3D, amber
  #FCF0DA/#96631B, red #FCE8E8/#C0342C, blue #EAF1FE/#2159C4, purple #F1ECFC/#6A46C8).
- Dark sections: bg #22252A, cards #23262B + border #32363C (elevation via border,
  not contrast).
- Type: Geist; sentence case; hero 56-72px/600/-0.03em ending with a period;
  body 15-16px/1.6 in secondary gray; "bold lead-in" pattern instead of
  heading+paragraph; Geist Mono only for data/micro-labels.
- Spacing: 8px grid; card padding 24-32px; sections separated by 120-160px
  whitespace, never rules.
- Radius: inputs/buttons 8px, cards 12-14px, frames 16-20px, pills full.
- Icons: Lucide, 1.5px stroke, 16px, always gray, always with a label.
- Details: count badges, avatar stacks, hairline-framed screenshots with fade-out
  edges, faint dot-grid only behind diagrams, testimonials as plain centered
  avatar+quote (no card).
- Never: gradients, glows, emoji in chrome, zebra tables, second accent,
  decoration without function. If removing it changes nothing, remove it.

PULSE-SPECIFIC APPLICATION:
- This is a data-dense trading dashboard: Geist Mono for all numbers
  (prices, PnL, z-scores), tinted pills for trade status (green=win,
  red=loss, blue=open, amber=deferred/warning).
- PnL coloring counts as "color for data" — green/red on pnl_pct values
  is correct, not a violation.
- lucide-react is APPROVED as a frontend dependency addition for this
  (icon system is part of the design spec).

OWNER AMENDMENTS — 2026-08-12, dashboard redesign (supersede the above):
- DARK MODE IS IN. The earlier "no dark mode in v1, dark tokens
  reserved" ruling is SUPERSEDED. Light and night mode both ship, the
  choice persisted in a `pulse-theme` cookie (never localStorage — it
  is unavailable in some contexts). Dark uses the dark tokens already
  named above: bg #22252A, cards #23262B, borders #32363C, elevation
  via border and never shadow.
- THE #276BF0 ACCENT IS RETIRED FROM CHROME. The "ONE accent, max 3
  uses per screen" rule no longer applies to Pulse chrome. Links,
  focus rings and interactive affordances are greyscale — near-black
  on light, near-white on dark. Chrome is black / white / grey ONLY.
  Blue survives solely as a DATA pill (open trade, entry signal),
  alongside the other data colors, which are untouched.
  This is an owner decision, not an oversight: a future frontend pass
  MUST NOT "restore" the accent as a fix. To reinstate it, get an
  explicit owner ruling reversing this one.
- Dark-mode data pills use low-alpha tints of their existing
  foreground hues, not the light fills (#E7F6EC and friends glare on
  #22252A). Same hues, different substrate — not a new palette.
