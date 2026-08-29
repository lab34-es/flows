# browser

A browser example that runs entirely on your own machine. It serves a small
sign-in page on localhost and drives it with [Playwright](https://playwright.dev),
so it needs no internet and no account anywhere.

It does need the browsers, which are a separate download:

```bash
npx playwright install chromium
```

## What you can practice with it

- **Driving a browser** — `goto`, `waitForSelector` and a page that behaves
  like a real single-page app.
- **Getting values out of a browser** — the three methods that bring
  something back, side by side in one script.
- **Keeping what you found** — a browser step remembers nothing on its own;
  the flow's `memory` mapping decides.

| Method | Reads | Example |
|-|-|-|
| `scrape` | What is on the page | The heading |
| `cookies` | The cookie jar of the context | `demo_session` |
| `storage` | Local or session storage of the origin | `access_token` |

The page is built so that only the heading is visible: the session cookie and
the bearer token are exactly the kind of value that cannot be scraped, which
is why the other two methods exist.

## Methods

| Method | Description |
|-|-|
| `signIn` | Signs in and brings back the page, the cookie and the token. |
| `whoami` | Answers whether a token is the one the browser was given. |

`whoami` is what makes the example a proof rather than a demonstration: it
compares the token it is passed with the one the site issued, so it only
answers `200` if the value really travelled out of local storage, into the
flow memory and back out into a later step's parameters.

## The flow

`flows/examples/04-browser-and-scraping.md` runs both, end to end.
