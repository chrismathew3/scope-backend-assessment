---
name: Showtimes
description: Theater schedule console with AI-reviewed partner imports, set in one calm ruled column.
colors:
  ink: "#0b0b0c"
  ink-2: "#5f636a"
  ink-3: "#8b8f96"
  line: "#ececec"
  line-strong: "#dcdcdc"
  wash: "#f6f6f6"
  ground: "#ffffff"
  risk: "#a8640a"
  remove: "#c0322b"
  focus: "#2f5bd8"
  ink-hover: "#2a2a2c"
  ink-disabled: "#b9b9bb"
  checkbox-stroke: "#c4c4c4"
  selection: "#dfe6fb"
typography:
  display:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "34px"
    fontWeight: 700
    lineHeight: 1.12
    letterSpacing: "-0.03em"
  display-compact:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 700
    lineHeight: 1.12
    letterSpacing: "-0.03em"
  lede:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.625
  title:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "\"cv11\", \"ss01\""
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.5
  caption:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "12px"
spacing:
  row: "14px"
  gutter: "20px"
  gutter-wide: "32px"
  section: "40px"
  control: "36px"
  bar: "56px"
  column: "680px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.ground}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "36px"
  button-primary-hover:
    backgroundColor: "{colors.ink-hover}"
  button-primary-disabled:
    backgroundColor: "{colors.ink-disabled}"
  button-secondary:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "36px"
  button-secondary-hover:
    backgroundColor: "{colors.wash}"
  button-quiet:
    textColor: "{colors.ink-2}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0 10px"
    height: "36px"
  button-quiet-hover:
    backgroundColor: "{colors.wash}"
    textColor: "{colors.ink}"
  button-link:
    textColor: "{colors.ink-2}"
    typography: "{typography.label}"
  input-field:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "36px"
  checkbox:
    backgroundColor: "{colors.ground}"
    rounded: "{rounded.sm}"
    size: "16px"
  checkbox-checked:
    backgroundColor: "{colors.ink}"
  top-bar:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
    height: "56px"
  nav-link:
    textColor: "{colors.ink-2}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "6px 10px"
  nav-link-active:
    textColor: "{colors.ink}"
  review-row:
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    padding: "14px 0"
  toast:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.ground}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    padding: "10px 16px"
  toast-error:
    backgroundColor: "{colors.remove}"
    textColor: "{colors.ground}"
---

# Design System: Showtimes

## Overview

**Creative North Star: "The Ruled Page"**

The console reads like a single well-kept page: white ground, near-black ink, two greys and hairline rules. Every focused surface (import review, imports, upload, people, audit) sits in one centered 680px column; only the showtimes table is allowed to run wider. A screen should be legible in ten seconds, so each proposed change is one line of action plus one line of why, and the system spends its emphasis on type weight and position rather than on color, chrome or decoration.

The register is hyper-minimal, at the calibre of Linear, Vercel and Superhuman: practical, quiet, dense where daily work needs it, and calm. Color is a signal, never a theme. It appears only for risk (amber) and removal (red), as a word, a small dot or a 2px rule, and it is always paired with text so it is never the only signal.

Delight is saved for the import review: the title and lede settle into place, the keyboard drives the list, and rows open inline to show before/after and the raw CSV line. Everywhere else the system stays still.

**Key Characteristics:**
- One 680px reading column, hairline-ruled two-line rows, generous space above the list.
- Inter for every role; hierarchy comes from size (34 / 15 / 14 / 13) and weight (700 / 600 / 500).
- Black primary button, white secondary, grey quiet, underlined link. Nothing else.
- Color only for risk and removal, always with a word beside it.
- Flat surfaces; shadows exist only on things that float (menu, toast).
- Keyboard-first review with a sticky footer that always says what Enter will do.

## Colors

A monochrome ink-on-white palette with two narrow signal colors and one focus blue.

### Primary
- **Press Black** (`ink`): body text, headlines, the primary button fill, the checked checkbox, the active nav item. It is the only "brand" color the product has.

### Secondary
- **Caution Amber** (`risk`): low-confidence percentages, the 2px rule beside warnings, the "inactive" status dot, the confirm-low-confidence checkbox label. Means "look at this before you approve".
- **Removal Red** (`remove`): the word "Archive" in a review row, error text, the error toast, delete hover. Means "this takes something off the schedule".

### Tertiary
- **Focus Blue** (`focus`): the 2px focus-visible outline only. Never used for links, fills or decoration. Its pale partner (`selection`) tints text selection.

### Neutral
- **Slate Grey** (`ink-2`): secondary text, ledes, reasons under each row, table headers, quiet buttons and links (6.1:1 on white, safe for body copy).
- **Fog Grey** (`ink-3`): tertiary text, high-confidence percentages, placeholders, icons, quiet "nothing to do" rows. Large or non-essential text only.
- **Hairline** (`line`): every rule between rows, the top bar's bottom edge, dividers in menus.
- **Strong Hairline** (`line-strong`): borders on fields and secondary buttons, the "archived" status dot.
- **Wash** (`wash`): hover fill for quiet controls, skeleton blocks, the raw-CSV block. Never a card background.
- **Paper White** (`ground`): the page, the bars, menus. There is no off-white surface tier.

### Named Rules
**The Signal-Only Rule.** Color appears only for risk (amber) and removal (red), and always next to a word that says the same thing. Adds and updates are plain ink. If a screen has more than a handful of colored words, something is being over-signalled.

**The No-Third-Tint Rule.** There is one surface color (white) and one hover tint (wash). Don't invent tinted panels, colored rows, or status backgrounds.

## Typography

**Display Font:** Inter (with ui-sans-serif, system-ui)
**Body Font:** Inter
**Label/Mono Font:** Inter; a system monospace appears only inside the raw CSV block, because that text is data being quoted verbatim.

**Character:** One neo-grotesque doing every job, with tight negative tracking on headlines and the `cv11` / `ss01` alternates on for a cleaner, more neutral texture. Tabular numerals (`tnum`) on every time, count and percentage so columns line up.

### Hierarchy
- **Display** (700, 34px desktop / 28px phone, 1.12, −0.03em, balanced wrap): one page title per screen, e.g. "Review partner-drop.csv".
- **Lede** (400, 15px, 1.625, Slate Grey, pretty wrap): one sentence under the title saying what the page or the agent found.
- **Title** (600, 14px): the action + film line in each review row; the theater switcher in the top bar (with −0.01em).
- **Body** (400, 14px, 1.5): default text and table cells.
- **Label** (500 or 400, 13px): buttons, fields, nav, reasons under rows, footer hints, metadata.
- **Caption** (400, 12px, Slate Grey): table headers, the user's role line, "Line 12 as sent". Sentence case, never uppercase, never letter-spaced.

### Named Rules
**The One Family Rule.** Inter carries every role. No serif, no italic accent, no display face, no monospace for metadata.

**The Sentence-Case Rule.** Labels and headers are sentence case at normal tracking. Uppercase tracked micro-labels are banned.

## Layout

A single centered reading column: 680px max width with 20px side gutters on phones and 32px from `sm` up. The showtimes table uses a wider 1152px page; error and loading states use the same widths so nothing jumps. Pages start 32px under the 56px top bar, the list starts about 36–40px under the lede, and pages leave 96px at the bottom (160px when the review footer is expanded) so the sticky footer never covers the last row.

Rows are the unit of rhythm: 14px top and bottom, a 14px gap between checkbox and text, a hairline under each. Controls are 36px tall (the review's Apply button is 40px). The showtimes table becomes a ruled list below `md` (768px); the top bar's center nav moves into the user menu below `sm` (640px).

**Focus mode.** On an import review the top bar drops its center nav entirely, leaving only the theater on the left and the user on the right, so the review is the only thing on screen.

### Named Rules
**The One Column Rule.** Every focused page uses the 680px column. Only the showtimes table may run wider, because it is a table.

## Elevation & Depth

Flat by default. Depth is conveyed by hairline rules and by the sticky bars staying on top, not by layered cards. Two things float and only they cast shadows: the user menu and the toast. The sticky top bar and the review footer are 95% white (85% with a light backdrop blur where supported) so content scrolling beneath them stays faintly legible; that translucency is scoped to sticky chrome and is never a surface style.

### Shadow Vocabulary
- **Menu lift** (`box-shadow: 0 12px 32px rgba(0,0,0,0.10)`): the user menu dropdown, over a 1px hairline border.
- **Toast lift** (`box-shadow: 0 8px 24px rgba(0,0,0,0.12)`): the status toast at the bottom center.

### Named Rules
**The Only-Floating-Things Rule.** A shadow means "this is above the page and will go away". Rows, panels, tables and buttons never cast one.

## Shapes

Soft but small corners. 4px on checkboxes and the focus ring, 6px on every button, field and hover target, 8px on the floating menu and toast, 12px only on the upload dropzone and the import-progress panel (the two large bordered blocks in the product). The only fully round shape is the 6px status dot in the showtimes table. Borders are 1px hairlines; the exceptions are the 1.5px checkbox stroke, a dashed border on the dropzone, and the 2px left rule beside warnings and the temporary-password notice.

## Components

### Buttons
Restrained and solid; the primary is the only filled black thing on most screens.
- **Shape:** gently rounded (6px), 36px tall, 13px medium label.
- **Primary:** Press Black fill, white text, 16px side padding. Hover lifts to `#2a2a2c`; disabled goes flat grey `#b9b9bb`. One per screen.
- **Secondary:** white with a Strong Hairline border, ink text, 14px padding; hover fills with Wash. A secondary that represents an active filter takes an ink border.
- **Quiet:** no border, Slate Grey text, 10px padding; hover fills Wash and darkens to ink.
- **Link:** Slate Grey text that turns ink and underlines (4px offset) on hover. Used for "Discard", "Back", and sign-in alternates.
- **Focus:** every button shows the global 2px Focus Blue outline at 2px offset.

### Inputs / Fields
- **Style:** 36px, white, 1px Strong Hairline border, 6px radius, 13px text, Fog Grey placeholder.
- **Hover / Focus:** border darkens to `#c8c8c8` on hover; on focus the border turns ink and no glow is added.
- **Selects:** same field with a drawn 12px grey chevron on the right. Inside table rows a borderless inline select is used instead (transparent until hovered, 28px tall).
- **Error:** a 13px Removal Red sentence below the form; fields themselves do not turn red.

### Checkboxes (signature)
A drawn 16px box with a 1.5px `#c4c4c4` stroke and 4px corners. It fills with Press Black and shows a white rounded check when approved; hover darkens the stroke to Fog Grey. Disabled boxes fade to 45% (35% when checked). Background and border cross-fade over 120ms.

### Review row (signature)
The core of the product: a ruled two-line row in the 680px column.
- **Line one:** checkbox, then the action word and film in 14px semibold ("Archive" in Removal Red), the showtime in 13px tabular Slate Grey, and a right-aligned confidence percentage (Fog Grey when high, medium-weight Caution Amber when low), then a small chevron.
- **Line two:** one 13px Slate Grey sentence of why, clamped to two lines until opened.
- **Unapproved:** the text drops to 55% opacity; after apply, rejected rows are struck through.
- **Expanded:** the row tints to `#fbfbfb` and reveals a two-column definition list, a before/after table (old value struck through) and the raw CSV line in a Wash block.
- **Quiet rows:** unchanged and duplicate rows sit below in Fog Grey with a disabled, faded checkbox, so the operator sees them without having to act on them.
- **Keyboard:** j / k or arrows move, Space toggles, e expands, Enter applies.

### Review footer
A sticky bottom bar matching the top bar (hairline top edge, near-opaque white). Left: a 13px Fog Grey count and hint ("12 of 14 approved. Space to toggle, Enter to apply"), or an amber confirm checkbox when low-confidence rows are approved. Right: a 40px black "Apply N changes" and a plain "Discard" link.

### Navigation
- **Top bar:** 56px, white, hairline bottom. The theater switcher sits left as a borderless 14px semibold select with a grey chevron. Center nav is 13px Slate Grey text; the active item turns ink and medium weight with no underline, pill or background. Hidden on phones and on the review (focus mode).
- **User menu:** right-aligned name (13px medium) over role line (12px Slate Grey). Opens a 240px menu with 8px corners, hairline border and Menu lift, items 13px with Wash hover, separated by hairlines.

### Status toast
Centered 20px from the bottom, 8px corners, 13px white text on Press Black (Removal Red for errors), Toast lift. Enters with a 6px rise over 220ms.

### Motion
One easing for everything that moves: `cubic-bezier(0.16, 1, 0.3, 1)`. Page titles and ledes on the review settle in (4px rise and fade over 420ms) when the import status changes; the menu drops in over 160ms; color and opacity state changes run 120–150ms. Reduced-motion collapses every animation and transition to near-zero.

## Do's and Don'ts

### Do:
- **Do** put every focused page in the 680px column with a 34px bold title and one 15px grey lede sentence.
- **Do** separate items with 1px `line` hairlines and 14px row padding instead of cards or panels.
- **Do** use color only for risk (amber) and removal (red), always beside a word that says the same thing.
- **Do** use tabular numerals for every time, count and percentage.
- **Do** keep one black primary button per screen; everything else is secondary, quiet or a link.
- **Do** make every flow keyboard-operable with the 2px Focus Blue outline visible.
- **Do** reserve shadows for the menu and the toast.

### Don't:
- **Don't** use eyebrow or kicker labels above titles, or uppercase letter-spaced micro-labels anywhere.
- **Don't** use monospace for meta bylines, timestamps, IDs or labels. Monospace is only for quoting raw CSV data verbatim.
- **Don't** number rows or sections ("01", "02").
- **Don't** use decorative arrow glyphs (→, ↗) in links, buttons or headings. A functional chevron that opens or selects something is fine.
- **Don't** use gradients of any kind.
- **Don't** use glassmorphism: no frosted cards, panels or modals. The near-opaque blur on the two sticky bars is the only translucency.
- **Don't** pair a serif with an italic accent, or introduce any second typeface.
- **Don't** use decorative pill chips, badges or colored status pills. Status is a word or a 6px dot.
- **Don't** tint rows, panels or backgrounds with signal colors.
- **Don't** use color as the only signal for add, update or archive.
