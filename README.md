# Toolbox

A dependency-free, client-side toolbox. There is no install step, build process, backend, or account system.

## Serve locally

From the repository root, start a static HTTP server:

```sh
python3 -m http.server 8000
```

Then open <http://localhost:8000/>. Stop the server with `Ctrl+C`. Any static file server can be used; the site does not need a build step.

## Deploy to Cloudflare Workers

Cloudflare Workers serves this site as static assets; there is no Worker script or server-side image processing. The `dist/` directory is generated for deployment and contains only the public site files, not repository documentation or configuration.

To deploy manually, install Node.js, sign in to your Cloudflare account, then run from the repository root:

```sh
sh scripts/prepare-assets.sh
npx wrangler@latest login
npx wrangler@latest deploy
```

The site will be available at the `*.workers.dev` URL printed by Wrangler. If `toolbox` is already used as a Worker name in your account, change `name` in `wrangler.jsonc` before deploying. After subsequent site changes, rerun the preparation script before deploying; do not commit `dist/`.

For automatic deployments from GitHub, push the repository to GitHub, then in Cloudflare **Workers & Pages** connect that repository using **Workers Builds**. Select your production branch and the repository root, and configure:

- **Build command:** `sh scripts/prepare-assets.sh`
- **Deploy command:** `npx wrangler@latest deploy`

The Cloudflare Git integration handles deployment authentication; no Cloudflare API token needs to be committed. Once deployed, check `/`, `/tools/stitch-split-img/`, and that styles, scripts, and image downloads work. Missing paths should return 404 rather than the home page.

## Stitch Split Img

Open **Stitch Split Img**, then choose or drop at least two image slices. The tool decodes images and computes their order in the browser. **Files never leave your browser**; source images and intermediate canvases remain in memory for the current page session and are not saved.

The tool is intended for one-dimensional sequences of slices with clean, abutting cuts: no gaps, overlaps, or perspective correction. Horizontal stitching requires equal image heights and joins slices side by side; vertical stitching requires equal widths and joins them top to bottom. Images are not resized. EXIF orientation is applied when supported by the browser's image decoder.

### Options and output

- **Axis:** Horizontal or Vertical compares that direction only. Auto evaluates each dimensionally valid direction and selects the lower normalized (per-seam) cost; it does not infer or correct image geometry.
- **Strip width K:** Positive integer number of edge pixels to compare; defaults to 3. If K is larger than the narrowest relevant image dimension, it is clamped and the report notes the change.
- **Verbose cost matrix:** Shows the directed pairwise seam costs in canonical filename order. The matrix can be scrolled horizontally and vertically.
- **Preview only:** Computes and reports the order and draws a scaled preview without allocating the full-resolution joined canvas or enabling downloads. Feature extraction still uses memory proportional to all input pixels.
- **Downloads:** Normal mode creates a full-resolution canvas and offers JPEG (quality 0.92) and PNG. Download dimensions and axis are included in the filename.

Use image formats your browser can decode (commonly JPEG, PNG, WebP, GIF, or BMP; exact support varies). Animated images use the decoded frame. Unsupported formats, corrupt images, unequal dimensions, and canvas allocation/encoding limits are reported in the page.

### Practical limits

- Two or more images are required. Exact ordering is practical for **10 or fewer** slices; 11–12 are allowed with a warning, while more than 12 are refused.
- Large images need substantial RAM. A 1446×4096 slice uses about **135 MiB of typed-array feature data** during matching. Four such slices need roughly 542 MiB for features alone, in addition to decoded source canvases, temporary pixel buffers, and (outside preview-only mode) the full-resolution output canvas. Browser/device memory limits vary; large jobs may be slow or fail, especially on mobile. Preview-only avoids the full output canvas but not feature data.
- The calculation runs on the main thread; there is no Web Worker. Large jobs can temporarily make the page less responsive.
- The tool uses `createImageBitmap` where available. If it falls back to an image element/canvas decoder, EXIF rotation may not be applied. Browser support for image formats and maximum canvas dimensions also varies.
- The intended baseline is a recent evergreen Chromium, Firefox, or Safari browser with Canvas 2D and `createImageBitmap`; the image-element fallback handles browsers without that API but has the EXIF limitation above.
- The JS/canvas pipeline aims for order-equivalence and visual continuity, not byte-identical pixels to the Python implementation. Decoder, floating-point, alpha-compositing, and JPEG encoder differences can change pixel values and reported costs slightly.
- This is a light-only page. There is no persistence, dark mode, or server-side processing.

## Image Resizer & Converter

Open **Image Resizer & Converter** and select or drop one browser-supported image. Set the crop's left/top coordinates and width/height in original, orientation-corrected pixels; the source preview outlines the retained region. **Use full image** resets both crop and output dimensions. Changing the crop resets output dimensions to the crop size.

Set output dimensions; **Keep aspect ratio** links width and height to the crop's aspect ratio, rounded to whole pixels. Uncheck it to stretch the image. Choose PNG, JPEG, or WebP, then **Create image** to preview and download the encoded result with a file-size comparison. Quality (1–100%, default 92%) applies to JPEG and WebP only. JPEG composites transparency onto white; PNG and WebP retain transparency. Changes to inputs invalidate the previous download.

Processing uses `createImageBitmap` with EXIF orientation and Canvas 2D; a recent evergreen browser is required. Animated inputs use a single decoded frame. Output is limited to 16,384 pixels per side and 32 million pixels total to bound canvas allocation; browser/device limits may be lower. Large source images still require substantial decoding memory. Unsupported inputs, canvas/encoding failures, and unsupported output formats are reported. Re-encoding does not preserve source EXIF or other metadata and is not a lossless round-trip guarantee.

## File Hash Calculator

Open **File Hash Calculator**, select or drop one file of any type, and click **Calculate SHA-256**. Empty files are supported. Copy the lowercase hexadecimal checksum or paste an expected checksum to compare. Comparison ignores hexadecimal case and surrounding whitespace; the expected value must otherwise be exactly 64 hexadecimal characters. A matching checksum verifies content against the expected hash, not file safety or source authenticity.

Hashing uses the browser's Web Crypto API and requires **HTTPS or localhost**. The whole file is read into memory; there is no streaming hash implementation. The always-visible memory warning and explicit calculation action allow users to assess large files before reading them. Files, hashes, and expected checksums are not uploaded or persisted. Clipboard access may require permission; if unavailable, the checksum is selected for manual copying.

## Decision Wheel

Open **Decision Wheel** and enter 2–50 choices, one per line. Use `Choice | 2` for an optional weight; weights are positive whole numbers up to 1,000,000 and labels are limited to 80 characters. Blank lines are ignored. Each slice and the odds list reflect its share of the total weight. Duplicate labels remain separate entries.

Each independent spin samples browser randomness with `crypto.getRandomValues`, selects a weighted outcome, and animates the wheel to that slice. Editing is disabled during a spin. Reduced-motion preferences skip the animation. Very small slices may omit canvas labels; the full accessible choices/odds list and announced result remain available. Inputs and results only live in the current page session.

## Probability Simulator

Choose a fair coin, fair six-sided die, or Monty Hall experiment. Run 1–1,000,000 trials at a time, up to 10,000,000 accumulated trials. Results update in batches with an observed-frequency bar chart, exact counts, theoretical probabilities, and differences in percentage points. **Stop** retains completed trials; **Reset results** or changing the experiment cancels pending work and clears the sample.

Monty Hall uses the standard assumptions: one prize behind three doors; a knowledgeable host always reveals an unchosen goat and offers a switch. Each trial compares both strategies on the same game. By symmetry the initial door is fixed, so staying wins exactly when the random prize is behind it (1/3), and switching wins otherwise (2/3). Trials use `Math.random` for education, not secure randomness. Small timer-scheduled batches keep controls responsive without adding a worker or dependency.

## Timezone Meeting Planner

Add up to six distinct IANA timezones (or UTC), with local working hours and either Monday–Friday or every-day availability. The defaults are New York and London, 09:00–17:00 on weekdays. City suggestions use `Intl.supportedValuesOf` when available; valid browser-recognized IANA names can also be entered directly. Equivalent timezone aliases are deduplicated.

Choose a **UTC reference date** from 2000–2100 and a duration of 30, 60, 90, or 120 minutes. The comparison table covers 48 possible start times on that UTC day at half-hour intervals, showing each city's local date, time, and offset. Using a UTC reference avoids ambiguity during repeated or nonexistent local hours. `Intl.DateTimeFormat` applies the browser's timezone/DST rules for each instant; future rule changes require up-to-date browser timezone data.

A slot fits only when every minute of the entire meeting is inside all participants' working hours. Minute-level checks handle fractional-hour offsets, midnight, and DST changes; prefix sums keep duration checks inexpensive. Working hours are same-local-day intervals; overnight schedules and public holidays are not supported. Filter to shared slots, select a start time, and copy the local meeting ranges. The selected slot can also be outside working hours, with a warning in the shared text. No calendar integrations, network lookups, or saved preferences are used.

## Tests

Timezone logic tests use only Node.js:

```sh
node --test scripts/test-timezone-planner.mjs
```

They cover seasonal/DST offsets, different DST transition dates, repeated/skipped hours, fractional-hour offsets, local-day rollover, full-duration availability, and input validation.

### Browser smoke tests

With the site served at `http://127.0.0.1:8000` and Playwright CLI available, run:

```sh
playwright-cli open http://127.0.0.1:8000/
playwright-cli run-code --filename=scripts/test-file-tools.js
playwright-cli run-code --filename=scripts/test-interactive-tools.js
playwright-cli close
```

The file-tool tests cover crop pixels, aspect-ratio controls, image formats/transparency, downloads, validation, failure handling, asynchronous stale-result protection, SHA-256 known vectors, comparison, clipboard/fallback, file drops, and mobile overflow. The interactive-tool tests cover weighted selections, simulation outcomes and cancellation, planner controls and meeting summaries, and mobile layouts. The CLI is a development-only test tool; the deployed app has no runtime dependencies or build requirement.

## Project conventions

- Keep the app static and client-side: no framework, package manager, build step, or backend.
- Keep the app stateless: do not add accounts, persistence, or storage. Tool inputs and processing stay in the browser.
- Shared styles live in `assets/css/`; tool metadata lives in `assets/js/tool-registry.js`.
