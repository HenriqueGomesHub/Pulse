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
- No dark mode in v1 — light theme only, dark tokens reserved for
  future use.
