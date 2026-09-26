# Toolbox

A dependency-free, static toolbox. There is no install step or build process.

## Serve locally

From the repository root, run:

```sh
python3 -m http.server 8000
```

Then open <http://localhost:8000/>. Stop the server with `Ctrl+C`.

## Project rules

- Keep the app static and client-side: no framework, package manager, build step, or backend.
- Keep the app stateless: do not add accounts, persistence, or storage. Tool inputs and processing are intended to remain in the browser.
- Shared styles live in `assets/css/`; tool metadata lives in `assets/js/tool-registry.js`.
