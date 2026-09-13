# Dark-mode audit — September 2026

Follow-up requested after the light-mode PR was opened. Uses the same synthetic scenarios and 390px/1024px route set documented in [the light-mode audit](light-mode.md): public welcome/sign-in, populated hub, Pick'em overview, straight-up and ATS pick sheets, expanded settled All Picks, and Survivor standings.

## Findings

No additional application changes were warranted. Full-strength muted text measures approximately **7.61:1** on the dark page background (sRGB `(167,160,156)` on `(14,11,10)`). The removed 70% opacity would reduce that to approximately **4.22:1**, so the light-mode fix also corrects dark metadata contrast. Ink bands, warm page/card surfaces, selected controls and textual win/loss states remain distinguishable in the reviewed captures.

A temporary axe-core color-contrast scan reported no violations across the 16 dark route/width combinations. It was used as supplemental evidence, not as an exhaustive accessibility certification; screenshots and underlying colors were reviewed separately. Axe was not added as an application or test dependency.

## Judgment and limits

The deliberately dark subject bands could be made more prominent, but their type and spacing already establish hierarchy. That is a visual preference, not a demonstrated defect. Disabled submit controls intentionally remain faded. The audit does not cover every hover, focus, error or sport-specific future state.

The existing focused capture already includes dark mode. CI publishes the small affected ATS set in both themes, alongside the light All Picks comparison. See the PR for the captured commit, seven-day artifact link and expiry.
