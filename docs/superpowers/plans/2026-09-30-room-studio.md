# Room Studio implementation plan

Goal: Turn the existing bedroom model into an interactive lighting studio.
Architecture: Preserve room geometry and authenticated control API. Add a browser-only preview state, fixture groups, curated palettes, and named local scenes. Physical commands require explicit Live mode; opening or previewing never sends commands.
Tech stack: Vanilla JavaScript, vendored Three.js, existing Python server.

- [x] Extend room.html and room.css with studio toolbar, preview/live switch, group selector, mood cards, saved looks, and night/day rendering controls.
- [x] Extend room.js with explicit preview state, per-fixture palette commands, offline handling and partial-failure reporting. Persist custom scenes locally by fixture key; use textContent for names.
- [x] Improve point-light visibility with night ambient lighting and selected fixture halo; preserve geometry and camera controls.
- [x] Verify Python regressions, JS syntax, and browser interaction (preview, group controls, saved scenes and layout). Capture screenshot. Do not send physical test commands.

Verification: 15 Python tests passed; node --check passed. Browser verified four connected fixtures, Aurora palette, group selection, saved look persistence across reload and recall, and 3D rendering. No physical test commands sent.
