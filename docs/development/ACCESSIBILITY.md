# Accessibility Standard and Audit

[Documentation Index](../README.md)

## 1. Target

VoxMesh Web Console targets WCAG 2.2 Level AA.

Accessibility is a functional requirement and applies to:

- first-run setup
- authentication
- Browser History routing
- Dashboard
- Chat
- Conversations
- Logs
- Settings
- English and Simplified Chinese
- Light, Dark, and System appearance
- desktop and responsive layouts

The mandatory engineering rules are defined in
[Development Rules](../DEVELOPMENT_RULES.md).

## 2. Required Contrast

- Normal text: at least 4.5:1
- Large text: at least 3:1
- Required control boundaries and meaningful graphics: at least 3:1
- Visible focus indicators: at least 3:1 against adjacent colors

Semantic CSS tokens in `apps/web/src/styles.css` are the source of truth for Light and Dark colors.

## 3. Automated Gates

### Static analysis

`eslint-plugin-jsx-a11y` runs as part of:

```bash
pnpm lint
```

Accessibility lint failures must not be disabled without explicit approval and tracking.

### Component tests

React Testing Library tests use role, label, and accessible-name queries. This makes missing labels, roles, headings, and control names visible as test failures.

```bash
pnpm test:unit
```

### Browser audit

Playwright uses `@axe-core/playwright` with WCAG A and AA tags.

The current end-to-end audit covers:

- English Dark setup
- English Dark Dashboard
- Simplified Chinese Dark Settings
- English Light Settings
- English Dark not-found route

It also verifies:

- route headings receive focus
- a keyboard-accessible skip link is available
- direct routes and authentication redirects work
- responsive content does not create horizontal overflow at a narrow viewport
- Browser History back and forward navigation works

```bash
pnpm test:e2e
```

## 4. Issues Found and Fixed

### Light-theme accent contrast

The original Light accent color did not provide a strong enough margin for small accent text and buttons. The Light accent token was changed from `#0891b2` to the darker `#0e7490`.

### Missing consistent focus indicators

Interactive controls now use a three-pixel semantic focus outline with an offset in both Light and Dark themes.

### Missing skip navigation

The authenticated shell now provides a skip link that becomes visible on focus and targets the main content landmark.

### Route-change focus

TanStack Router route changes now focus the route heading. The heading is programmatically focusable without entering the normal tab order.

### Route announcements

The root route provides a polite atomic live region that announces the localized route title.

### Async status and error semantics

- errors use `role="alert"`
- successful asynchronous settings updates use `role="status"`
- loading status uses `role="status"`

### Form error relationships

Password and LLM configuration controls reference their active error message through `aria-describedby`.

### Navigation semantics

Sidebar navigation uses real links with Browser History rather than buttons that only changed runtime component state.

## 5. Manual Review Checklist

Automated tools do not prove complete accessibility. Significant UI changes require manual review:

1. Navigate every action using only the keyboard.
2. Confirm focus is always visible and ordered logically.
3. Confirm route transitions move focus to the new page heading.
4. Test VoiceOver on macOS and NVDA or Narrator on Windows when release qualification begins.
5. Verify English and Simplified Chinese at 200% browser zoom.
6. Verify narrow layouts without clipped labels, controls, or horizontal page scrolling.
7. Verify Light and Dark themes with system brightness changes.
8. Verify Windows forced-colors or high-contrast mode during Windows qualification.
9. Verify errors and success messages are announced by a screen reader.
10. Verify future audio controls and visualizations have accessible names and text alternatives.

## 6. Adding or Changing UI

For each component change:

1. Use native semantic HTML.
2. Add a visible label and accessible name for every control.
3. Preserve heading and landmark hierarchy.
4. Use semantic design tokens rather than new hard-coded colors.
5. Check contrast in Light and Dark themes.
6. Add component tests using accessible queries.
7. Add or update representative axe coverage.
8. Test keyboard interaction and focus behavior.
9. Test English and Simplified Chinese.
10. Update this document when the accessibility architecture or audit scope changes.

## 7. Current Audit Status

The automated accessibility checks for the currently implemented routes pass with zero axe violations in the tested locale and theme combinations.

Full release qualification still requires the manual screen-reader, zoom, forced-colors, and hardware/audio-control review described above.
