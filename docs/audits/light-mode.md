# Light-mode audit — September 2026

Base: staging `9220ac0`. Task: [Audit light mode in PicksLeagues and Paulitakes](https://app.notion.com/p/3d7c4dbb621781e5986cf6219d43782f).

## Objective findings

The 390px capture of the against-the-spread pick sheet showed visibly faint odds attribution. The page uses `oklch(0.99 0.003 75)` and muted text uses `oklch(0.52 0.015 55)`. Chromium's sRGB canvas resolves these to `(253,251,250)` and `(112,103,97)`. Applying the component's 70% text opacity gives approximately **2.92:1**, below the [4.5:1 minimum for ordinary text](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html). The same text at full token opacity is **5.35:1**. Ratios use linearized sRGB relative luminance, not antialiased screenshot pixels.

Removed the extra opacity from odds attribution, game freshness, member season summaries, and the hub's pick-status placeholder. The existing shared token and layout remain appropriate. The disabled submit button is intentionally faded; inactive controls are exempt from the text contrast requirement.

## Visual judgment

Reviewed public welcome/sign-in, populated hub, Pick'em overview/standings, open straight-up and ATS pick sheets, expanded settled All Picks, and settled Survivor standings at 390px and 1024px. The warm background, ink subject band, hairline rows, semantic outcomes and orange actions retain a clear hierarchy. A stronger border, brighter page, or darker global muted token would be preference rather than a demonstrated fix. Dark captures accompany the same routes to review the opacity change in both themes.

This is a bounded representative audit, not an exhaustive WCAG certification. Chart and form surfaces in this application were inspected in source; the captured primary journeys contain form controls, tables and state labels.

## Reproduce

Use a provisioned local `.env` as documented in `.env.example`, with synthetic OAuth/job values and `APP_ENV=local`, `SIM_ENABLED=true`. Never copy live secret files. Set `E2E_DATABASE_URL` to a dedicated localhost database (this audit used `picksleagues_light_audit` on port 5433); Playwright creates and migrates it. Do not run concurrently with another simulator test suite.

```sh
LIGHT_CAPTURE=1 corepack pnpm test:e2e e2e/capture-vis.sim.spec.ts --project simulated --no-deps
```

This selects eight representative routes, both widths and themes. The full `VIS_CAPTURE=1` route sweep remains available. Captures go to ignored `test-results/review-screenshots/vis-8/`. The `light-mode-audit` PR label opts into the existing CI capture/upload step; artifacts expire after seven days. Review images never enter Git.

## Validation

- Focused synthetic capture: passed before and after the fix.
- `corepack pnpm typecheck`: passed.
- `corepack pnpm lint`: passed.
- `corepack pnpm test`: 627 passed.
- `corepack pnpm --filter @picksleagues/web build`: passed, including public-route prerender checks.
- `corepack pnpm test:e2e`: 24 passed; two opt-in capture specs skipped as intended.
