# AmaZoom

A Chrome extension that re-ranks Amazon search results by how well-reviewed
each product really is. It's a 2026 revival of
[AmaZoom (2010)](https://mco.dev/a-better-way-to-search-amazon.com/).

Amazon's "sort by average customer review" puts a product with three 5-star
ratings above one with thousands of 4.7s. AmaZoom scores every product with a
Bayesian average instead: each product starts as if it had 25 ratings of 3.5★,
and real ratings pull it toward its true average. A few perfect ratings barely
move the score. Thousands of strong ratings do.

## What it does

On an amazon.com or amazon.co.uk search results page it adds:

- **A toolbar** with three sorts: Best reviewed (the AmaZoom score), Most
  ratings, and Amazon's order. It also has a **Hide sponsored** switch.
- **A badge on every product** showing its AmaZoom rank and score, its stars
  and rating count, and where Amazon had ranked it, with how far AmaZoom moved
  it (for example "Amazon #12 ▲9"). Hover a badge to see which results page it
  came from.
- **Scan 4 more pages**, which loads the next result pages one at a time, with
  a pause between them, and merges them in. The best product is often several
  pages deep. Scanning stops if Amazon shows a robot check.

Everything runs in your own browser, on the page you asked for. The extension
has no servers, analytics, or affiliate links. Your sort choice is saved locally.

## Try it

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and choose this folder.
3. Search on https://www.amazon.com or https://www.amazon.co.uk.

## Develop

- `src/score.js` contains the scoring and parsing helpers. It has no DOM code
  and is tested in node.
- `src/parse.js` reads product cards from Amazon's markup, with fallbacks for
  older and newer layouts.
- `src/content.js` builds the toolbar and badges, re-orders the cards, and
  scans more pages.
- `test/fixture.html` is a mock results page with both markup styles. Serve
  the folder over http and open it to see the UI without Amazon.

```bash
node --test test/*.mjs
```

Supported: amazon.com and amazon.co.uk. Both use English labels and
comma-separated numbers. Adding another English-language Amazon site such as
amazon.ca or amazon.com.au is just a line in `manifest.json`. Sites in other
languages need their "out of 5 stars", "ratings" and "Sponsored" wording
added to `src/parse.js`.
