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

`dist/index.html` is the complete, self-contained app: all JavaScript, GLSL, styles, and color-map data are embedded. Open it directly in a WebGL 2 browser, or copy it anywhere and use it offline. `npm run build` also copies all favicon sizes to `dist` and creates `dist/Cymatics.art.html`. The in-app Download button includes the current configuration in its offline copy and names it `Cymatics.art_<version>.html`, using the version from `package.json`.

## Deploy to Cloudflare

The repository supports the **Workers → Create application → Connect a repository** flow using Workers Static Assets. `wrangler.jsonc` points Cloudflare at the Parcel output in `dist`; no server-side Worker script is needed.

Push the configuration and package changes to the repository, then use these Cloudflare Workers build settings:

| Setting | Value |
| --- | --- |
| Worker name | `cymatics-art` (matches `wrangler.jsonc`) |
| Root directory | Repository root |
| Build command | `npm run build` |
| Deploy command | `npm run deploy` |
| Node.js | 22 or newer |

For local validation without publishing:

```sh
npm ci
npm run build
npm run deploy:check
```

For a manual deployment after building, use `npm run deploy` and authenticate with Cloudflare when prompted. Configure the `cymatics.art` custom domain in Cloudflare after deployment.

Cloudflare **Pages** is a separate setup flow. For Pages Git integration, select framework preset **None**, build command `npm run build`, and build output directory `dist`. The Workers configuration in this repository is intended for the Workers setup screen.

Official references: [Workers Static Assets configuration](https://developers.cloudflare.com/workers/static-assets/binding/) and [Pages Git integration](https://developers.cloudflare.com/pages/get-started/git-integration/).

## Favicon artwork

`images/favicon_wb.png` is the source image. Each build regenerates 16, 32, and 48 px PNG favicons, the 180 px Apple touch icon, 192 and 512 px Android/Chrome icons, and a multi-size ICO (16, 24, 32, 48, 64, 128, 256). The generated icon links are embedded into the HTML so offline copies retain their icons. `scripts/package-assets.cjs` also copies the icon files to the deployment root and `dist/images`.

## Controls

- **Resonators:** Basic mode distributes up to 32 sources uniformly around the origin. One source sits at the origin. Advanced mode provides Add, Edit, and Remove, including per-source position, waveform, and phase settings. Switching modes preserves the list; changing a Basic resonator control regenerates it. Resonator Rotation rotates the layout around the origin in both modes while retaining the original source X/Y values.
- **Boundary:** None, Circle, Binary Split, regular polygons with 3–12 sides, Rectangle with independent Width and Height, or Custom with 3–128 sides. Radius measures center to vertices. Binary Split means parallel infinite walls at x = ±radius. Boundary Rotation rotates the walls around the origin independently of the sources and camera. The position preview shows the rotated walls and sources and marks sources outside them in red.
- **Phase:** Starts playing by default. The canvas Play/Pause button selects Animated/Fixed and stays synchronized with the sidebar. Fixed radians in [0, 2π], or discrete animation with `steps` evenly spaced phases and speed in steps per second. Source phase is `phase * phase_multiplier + phase_offset`. Dialogs and hidden tabs pause animation.
- **View:** Drag to pan, scroll/pinch to zoom, Home to fit, Go to for precise coordinates and height. Rotation is in degrees. Fuzzy Level uses FuzzyGraph's power transfer on the absolute combined wave; zero highlights near-zero values. Min Override defaults to zero and remains enabled when other settings change. Max Override defaults to 1. Max Override stays at the selected value when settings, phase, or the view change, including window resizing. Turn it off manually to use the current frame’s sampled maximum.
- **Color:** Background Color controls the area outside the boundary in both the canvas and saved PNGs. Original FuzzyGraph color maps, reverse/invert, entry offset, cycles, hue, saturation, and luminosity adjustments.
- **Files:** The existing Save dialog offers Image (PNG) and Video. Video controls include resolution presets/custom dimensions, FPS (1–60), and phase cycles. Cycle duration follows Phase Steps / Speed, rounded to whole output frames. MP4 recording is preferred; supported WebM encoders are tried as fallback. Export uses a separate canvas without changing the main view. Frame-by-frame encoding uses exactly `framesPerCycle × cycles` frames, with phase `startPhase + 2π × (frame % framesPerCycle) / framesPerCycle` and timestamp `frame / FPS`. This keeps the phase increment and playback timing uniform across the seam, even if Phase Steps does not divide the output frame count or rendering is slow. The 2π endpoint is not duplicated. Progress/cancellation are available; keep the tab visible. Older browsers without WebCodecs retain a sequential live-recording fallback. Videos include source metadata (`SOURCE=cymatics.art` and a comment linking to `https://cymatics.art`), including the live-recording fallback; fallback packets are copied without re-encoding. Videos use Background Color outside cropped shapes and do not include restorable settings. Exports are limited to five minutes and 512 MB. Save a PNG with full settings embedded in an uncompressed iTXt chunk (`cymaticsconfig`), or export JSON. Crop to boundary is checked when a closed boundary is fully visible; it links export dimensions to the camera-oriented boundary bounds and makes pixels outside the shape transparent for PNG. For cropped images and videos, Margin defaults to 0 and specifies whole pixels on each side inside the selected output dimensions. The margin is transparent for PNG images and filled with Background Color for videos. Linked dimensions preserve the boundary aspect ratio after subtracting the margin. Binary Split and None have no finite crop. Open restores either. Share encodes all settings, including the view and `resonators_list`, in URL parameters.

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
- `src/js/video.js`: uniform phase sampling, timestamped MP4/WebM encoding using WebCodecs and [Mediabunny](https://mediabunny.dev/) (MPL-2.0), live-recording fallback, cancellation, and resource cleanup.
- `tests/cymatics.test.mjs`: geometry, waveform, phase, schema validation, and PNG round-trip tests.
- `tests/video.test.mjs`: format preference and fallback, video timing, phase cycles, limits, and recorder cleanup.
- `tests/video.cjs`: optional Playwright checks for actual MP4/WebM downloads, cancellation, preserved settings, and mobile controls. Set `FFPROBE_PATH` to also validate exact decoded frame counts, dimensions, timestamps, and duration; `FFMPEG_PATH` checks decoded frame content. Covers mismatched phase-step/FPS counts and deliberately slow rendering.
- `tests/crop-margin.cjs`: optional Playwright checks for transparent PNG and decoded MP4/WebM pixel margins, aspect ratios, invalid inputs, Rectangle field order, and versioned downloads. Set `FFPROBE_PATH` and `FFMPEG_PATH` for file inspection.
- `tests/export-controls.cjs`: optional Playwright checks for override defaults and persistence, links, rectangle exports, aspect-ratio locking, and transparent boundary crops.
- `tests/dialogs-icons.cjs`: optional Playwright checks for embedded favicons, the white title link, and text-selection drags that cross modal boundaries.
- `tests/browser.cjs`: optional Playwright integration checks for actual GPU/CPU parity, editor, animation, share links, PNG restore, offline download, and mobile layout.

Run `npm test` for the core tests and `node scripts/check-build.cjs` after building to verify the single-file output. To run browser checks with an existing Playwright installation:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright APP_URL=http://127.0.0.1:8000 node tests/browser.cjs
```

Optionally set `CHROMIUM_PATH` to an installed Chromium executable. Browser tests write screenshots and downloads to a temporary directory.

≈ Built by [Caleb Madrigal](https://gods.art) ≈
