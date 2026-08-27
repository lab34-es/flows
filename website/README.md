# lab34/flows website

The documentation website for [lab34-flows](https://github.com/lab34-es/flows),
published at **https://flows.lab34.es/**.

- Built with [Astro](https://astro.build). The look is the editorial
  lab34/flows theme: a bone ground (`#F3F2F2`) with ink type, a single brass
  accent (`#B68235`) applied as stroke — borders, rules and underlines, never
  as a fill — IBM Plex Sans for prose and IBM Plex Mono for anything that is
  machinery (kickers, paths, code, metadata). Every color, size and rule comes
  from the tokens at the top of `src/styles/global.css`; both themes are
  defined there (`:root` and `.dark`).
- The home page carries the example flow document: pressing **Run** replays a
  pre-recorded execution, including the MQTT retry, straight in the page.
- The **Docs** section is generated at build time from the app's own Help
  section (`frontend/src/components/help/helpContent.ts`). Edit the
  in-app help and the website follows — there is no second copy.
- Deployed automatically by `.github/workflows/deploy-website.yml` on every
  push to `master` that touches `website/` or the help content. One-time setup
  in **Settings → Pages**: set **Source** to **GitHub Actions**, set the
  **custom domain** to `flows.lab34.es` and enable **Enforce HTTPS**. In DNS,
  point `flows.lab34.es` with a `CNAME` record to `lab34-es.github.io`.

This folder is completely independent from the CLI package: it is excluded
from the npm publish via the root `.npmignore`, and nothing in `src/` or
`frontend/` depends on it.

## Development

```bash
cd website
npm install
npm run dev       # http://localhost:4321
npm run build     # static site in website/dist
npm run preview
```
