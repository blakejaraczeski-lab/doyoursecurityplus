---
name: study-ui
description: Design and accessibility bar for the doyoursecurityplus interface. Use whenever adding or changing any screen, component, or stylesheet in this project, before writing the markup.
---

# The bar for this interface

This is a tool someone stares at for a hundred hours while preparing for an exam
they have paid for. Fatigue, legibility and focus are functional requirements,
not polish. Default dashboard aesthetics fail here.

## Non-negotiable

**Typography.** IBM Plex Sans for interface and prose, IBM Plex Mono for
anything that is data: addresses, ports, log lines, scores, counts. Never Inter,
never a bare system stack, never a third family. Question stems render at
`--t-xl` with 1.6 leading and are the largest text on the screen after the page
heading, because they are the thing being read.

**Measure.** Prose caps at 68 characters. Anything that must be read rather than
scanned gets `.prose` or lives inside a `max-width: var(--measure)` container.

**State is never colour alone.** Every correct/incorrect/partial state carries a
glyph or a border-weight change as well as a hue. WCAG 1.4.1. Check every new
state against this before shipping it.

**Contrast and size.** Body text 4.5:1 minimum against its own background, large
text 3:1. `--ink-faint` is the floor and already at the limit, so nothing lighter.
`scripts/check_materials.py` computes every text and `--on-accent` pair from the
tokens in both themes and fails under 4.5:1. The dark theme's filled surfaces
(accent, good, bad, warn) are pale, so `--on-accent` is dark ink there and white
in the light theme; never write `#fff` on a fill. A screen recedes by tone (a
lighter token step), never by `opacity`, which multiplies every label below the
floor.
Body is 16px: `--t-md` is the base and nothing below `--t-sm` carries meaning the
reader must take in.

**Document structure.** Every view has exactly one `h1` and never skips a level.
A screen that is deliberately bare still needs one: the drill view carries
`<h1 class="sr-only">`, because stripping chrome is a visual decision and a
screen reader should not pay for it. Section labels use `<h2 class="eyebrow">`,
which keeps the small-caps look without inventing an `h3` under an `h1`.

**Focus.** Every interactive element shows `:focus-visible`. The drill screen is
fully keyboard operable: A-J answer, G marks a guess, S skips, Enter continues,
1-4 grade a recall card. `?` opens the shortcut sheet (a native `<dialog>` in
`index.html`, filled from `SHORTCUTS` in `app/ui/chrome.js`) and `X` toggles
acronym expansions, on every screen. A new key is added to that list in the same
change. A new question or screen starts at the top of the page, and a new
question puts focus on its first option (`renderApp`). On a PBQ, Enter
submits and then continues; on the click-to-place PBQs a letter holds a chip
and a digit places it in that position or bucket, with the letters and digits
drawn on the controls; a focused diagram host opens on Enter or Space. The ACL
grid and the wireless form are native controls reached by Tab, which is the
documented reason they carry no letter keys. New controls get a shortcut or a
documented reason not to.

**Motion.** 120-180ms, `--ease` only, and everything inside
`@media (prefers-reduced-motion: reduce)` is disabled. Motion signals state
change; it never decorates.

**Targets.** Anything hit repeatedly is at least 44px tall and full width in its
column. Answer options are 56px; nav rows, primary buttons, form controls and the
guess toggle are 44px (the guess toggle is in `css/drill.css` and measured 33px
when last checked: its owner fixes it, not this file).

Two documented exemptions, both deliberate, both re-checked when touched:
`.btn.small` (32px) for controls hit occasionally rather than every question, and
controls inside `table.grid` (34px), because the ACL rule table puts seven of them
on a row and eight rows on screen. Full-height controls there would push the rule
set past one screen, and seeing the whole ordering at once is the entire point of
that PBQ. Neither surface is tapped on a phone.

## Hierarchy rules

- One card system. Rank with weight, size and space, never by inventing a new
  card variant per screen.
- The mentor correction is the payoff of the whole app. It is visually distinct
  from ordinary cards and the rule of thumb is isolated inside it.
- Chrome recedes during a drill. The sidebar loses its panel and its labels drop
  to `--ink-faint`, and the column narrows and centres. Nothing competes with the
  question. Every section's column is centred in the space beside the sidebar.
- The sidebar informs and never scolds: no warning glyph or colour for a streak,
  a rest day or a date not yet set.
- Numbers that matter are mono and large. Numbers that do not are `.faint`.

## Before you ship a screen

1. Tab through it. Can you reach and operate everything, and can you see where
   you are?
2. Set `prefers-color-scheme: dark` and re-read it. Both themes are defined on
   tokens; nothing gets a one-off hex.
3. Shrink to 375px. Does the nav stay a row, does the table scroll inside
   `.scroll-x` rather than the page?
4. Turn on reduce-motion. Does anything still animate?
5. Read the longest string that can land in each slot. Does it truncate
   something the reader needed?

## Smells

- A new colour literal in a component. Use a token or add one.
- A `style=` attribute carrying colour or spacing. Use a class; an inline style
  may only set a custom property that carries data (`style="--w:42%"`), and
  the self test fails on anything else.
- A `<div>` with a click handler. Use a `<button>`.
- Text at `--t-xs` carrying meaning the user must read.
- A table wider than its container without `.scroll-x`.
- Any heading level skipped.
