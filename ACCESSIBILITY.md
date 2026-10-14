# Accessibility

Rusty Buns aims to be usable by everyone, including people who use screen readers, a keyboard alone, magnification or a dyslexia-friendly font. We aim to meet [WCAG 2.2](https://www.w3.org/TR/WCAG22/) level AA, which is the standard the ADA is generally measured against for the web. Accessibility is a release requirement, not a polish pass.

## On this docs site

- **Reading settings** (the book icon in the header): pick Atkinson Hyperlegible or OpenDyslexic, your own system font, larger text, and wider letter, word and line spacing. The fonts ship with the site, nothing is fetched from a third party, and your choice is saved only in your browser.
- **Keyboard**: every control is reachable with Tab, there is a "Skip to content" link, focus is always visible, and code blocks and wide tables can be focused to scroll them.
- **Screen readers**: pages use landmarks (header, navigation, main), one `h1` per page, labelled controls, and announce when "Copy for agent" has copied.
- **Motion**: the site has no animation, and the day/night toggle respects `prefers-reduced-motion`.
- **Colour**: day and night themes follow your system, text meets AA contrast, and `prefers-contrast: more` strengthens it. Links are underlined, never colour alone.
- **Agents**: the reading settings and theme are also WebMCP tools (`set_reading_settings`, `set_color_theme`) in browsers that support `navigator.modelContext`, and every page has a plain markdown twin plus `llms.txt`.

## In the apps

Controls in the example apps are expected to be operable by keyboard and to expose WebMCP tools for the same actions a pointer can do, which is also what makes them usable with assistive tech. When you build an app:

- Use real buttons, links and form fields, and give icon-only controls an accessible name.
- Never convey state by colour alone, and keep text at 4.5:1 contrast or better.
- Respect `prefers-reduced-motion` and don't flash content.
- Offer a non-pointer way to do anything a drag or a game control does.

## Tell us about a barrier

If something here doesn't work for you, [open an issue](https://github.com/QuinnsCode/RustyBuns/issues/new) and say what you were using and what got in the way. Accessibility reports are treated as bugs.
