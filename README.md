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

## Project conventions

- Keep the app static and client-side: no framework, package manager, build step, or backend.
- Keep the app stateless: do not add accounts, persistence, or storage. Tool inputs and processing stay in the browser.
- Shared styles live in `assets/css/`; tool metadata lives in `assets/js/tool-registry.js`.
