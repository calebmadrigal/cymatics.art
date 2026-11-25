# cymatics.art

Cymatics.art - digital cymatics


A Single-File Web App inspired by [FuzzyGraph](https://fuzzygraph.com), with reflecting boundaries, individual resonators, phase animation, and GLSL rendering. The canonical share URL is https://cymatics.art.

## Build and run

Use Node.js 22 or newer and npm. The build uses the same Parcel + Tailwind pipeline as FuzzyGraph.

```sh
./do_build.sh
# Or, after npm ci:
npm test
npm run build
npm run serve
```

Open http://localhost:8000 after `npm run serve`. `./build_and_serve.sh` builds and serves in one step. For live development, use `npm run dev` (port 1234).

`dist/index.html` is the complete, self-contained app: all JavaScript, GLSL, styles, and color-map data are embedded. Open it directly in a WebGL 2 browser, or copy it anywhere and use it offline. `do_build.sh` also creates `dist/Cymatics.art.html`. The in-app Download button includes the current configuration in its offline copy.

## Controls

- **Resonators:** Basic mode distributes up to 32 sources uniformly around the origin. One source sits at the origin. Advanced mode provides Add, Edit, and Remove, including per-source position, waveform, and phase settings. Switching modes preserves the list; changing a Basic resonator control regenerates it. Resonator Rotation rotates the layout around the origin in both modes while retaining the original source X/Y values.
- **Boundary:** None, Circle, Binary Split, regular polygons with 3–12 sides, Rectangle with independent Width and Height, or Custom with 3–128 sides. Radius measures center to vertices. Binary Split means parallel infinite walls at x = ±radius. Boundary Rotation rotates the walls around the origin independently of the sources and camera. The position preview shows the rotated walls and sources and marks sources outside them in red.
- **Phase:** Starts playing by default. The canvas Play/Pause button selects Animated/Fixed and stays synchronized with the sidebar. Fixed radians in [0, 2π], or discrete animation with `steps` evenly spaced phases and speed in steps per second. Source phase is `phase * phase_multiplier + phase_offset`. Dialogs and hidden tabs pause animation.
- **View:** Drag to pan, scroll/pinch to zoom, Home to fit, Go to for precise coordinates and height. Rotation is in degrees. Fuzzy Level uses FuzzyGraph's power transfer on the absolute combined wave; zero highlights near-zero values. Min Override defaults to zero and remains enabled when other settings change. Max Override defaults to 1. Changing wave, geometry, phase-step, camera settings, or a fixed phase clears Max Override so the current frame’s sampled maximum is used. Automatic phase animation, Play/Pause, timing speed, and color changes preserve a manually set maximum.
- **Color:** Background Color controls the area outside the boundary in both the canvas and saved PNGs. Original FuzzyGraph color maps, reverse/invert, entry offset, cycles, hue, saturation, and luminosity adjustments.
- **Files:** Save a PNG with full settings embedded in an uncompressed iTXt chunk (`cymaticsconfig`), or export JSON. Crop to boundary is checked when a closed boundary is fully visible; it links export dimensions to the camera-oriented boundary bounds and makes pixels outside the shape transparent. Binary Split and None have no finite crop. Open restores either. Share encodes all settings, including the view and `resonators_list`, in URL parameters.

Each source is stored exactly as a JSON object in `resonators_list`:

```json
{"x": 1.2, "y": 1.2, "amplitude": 7.5, "frequency": 2.5, "phase_multiplier": 0, "phase_offset": 1.571, "waveform": "sinc"}
```

Waveforms: sinc, sine, square, sawtooth, triangle. Frequency is cycles per graph unit. Sinc follows FuzzyGraph's phased radial sine divided by radial distance, with a finite source core. Other waveforms do not decay with distance.

## Reflection model

Reflected waves use specular image sources: mirroring a source across a wall gives the reflected path length. Each candidate path must intersect the finite wall segment; two-bounce paths must intersect unfolded wall segments in the correct order. Named polygons and custom polygons through 12 sides include up to two reflections. The circle uses 64 facets and one reflection; larger custom polygons also use one reflection. None has no image sources or clipping.

The direct wave and valid reflections are folded left with the chosen `+`, `-`, `*`, or `/`, in resonator-list order, with each source's direct contribution followed by its reflections. Reflections retain the source's waveform, amplitude, and phase. Near-zero divisors and extreme products are bounded so rendering remains finite. A source should be placed inside the boundary for an enclosed-source pattern.

This is a finite geometric wave-interference model for art, rather than a full vibrating-plate, diffraction, or infinite-reverberation solver. See the [Princeton image-source discussion](https://www.cs.princeton.edu/techreports/2009/853.pdf) for the geometric reflection method.

## Source layout and checks

- `src/index.html`: interface, modal markup, inline styles, and the Parcel entry module.
- `src/js/app.js`: nanostores configuration and DOM interactions, file flows, and animation.
- `src/js/cymatics.js`: source JSON validation, geometry, reflections, wave math, and CPU reference evaluation.
- `src/js/cymatics_glsl.js`: WebGL 2 field rendering using source textures and a color-map texture.
- `src/js/ga_color.js`: FuzzyGraph color data and adjustments, retained from the reference project.
- `src/js/png.js`: PNG settings metadata read/write.
- `tests/cymatics.test.mjs`: geometry, waveform, phase, schema validation, and PNG round-trip tests.
- `tests/export-controls.cjs`: optional Playwright checks for override defaults and invalidation, links, rectangle exports, aspect-ratio locking, and transparent boundary crops.
- `tests/browser.cjs`: optional Playwright integration checks for actual GPU/CPU parity, editor, animation, share links, PNG restore, offline download, and mobile layout.

Run `npm test` for the core tests and `node scripts/check-build.cjs` after building to verify the single-file output. To run browser checks with an existing Playwright installation:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright APP_URL=http://127.0.0.1:8000 node tests/browser.cjs
```

Optionally set `CHROMIUM_PATH` to an installed Chromium executable. Browser tests write screenshots and downloads to a temporary directory.

≈ Built by [Caleb Madrigal](https://gods.art) ≈
