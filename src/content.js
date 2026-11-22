// AmaZoom content script: runs on Amazon search result pages, scores every
// product card, adds a toolbar and per-card badges, and re-orders the cards.
// Everything happens in the user's own browser, on the page they asked for.
(() => {
  const AZ = globalThis.AmaZoom;
  const { rank, PRIOR_MEAN, PRIOR_WEIGHT } = AZ.score;
  const { findSlot, parseCards, isRobotCheck } = AZ.parse;

  const DEFAULTS = { mode: 'best', hideSponsored: false };
  const SCAN_PAGES = 4; // extra pages fetched per click of "Scan more pages"
  const SCAN_DELAY_MS = 1200; // be gentle: one page at a time, with a pause
  const MAX_PAGE = 20; // Amazon rarely serves more than this

  const store = {
    async get() {
      try {
        return await chrome.storage.local.get(DEFAULTS);
      } catch {
        return { ...DEFAULTS };
      }
    },
    async set(values) {
      try {
        await chrome.storage.local.set(values);
      } catch {
        /* not running as an extension (e.g. the test fixture) */
      }
    },
  };

  const fmt = (n) => n.toLocaleString('en-US');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const state = {
    settings: { ...DEFAULTS },
    items: [],
    asins: new Set(),
    lastPage: 1,
    scanning: false,
    done: false, // no more pages to scan
    message: '',
  };

  let slot, anchor, ui;

  function pageOf(url) {
    return Number(new URL(url).searchParams.get('page')) || 1;
  }

  function addItems(items) {
    let added = 0;
    for (const item of items) {
      if (state.asins.has(item.asin)) continue; // the same product can recur across pages
      state.asins.add(item.asin);
      item.order = item.page * 1000 + item.pos;
      item.el.classList.add('amz-z-card');
      item.badge = makeBadge(item);
      (item.el.querySelector('.puis-card-container, .s-card-container') || item.el).prepend(item.badge);
      state.items.push(item);
      added++;
    }
    return added;
  }

  function makeBadge(item) {
    const b = document.createElement('div');
    b.className = 'amz-z-badge';
    const where = `Amazon had it at page ${item.page}, #${item.pos}`;
    if (item.score == null) {
      b.classList.add('amz-z-unrated');
      b.innerHTML = `<span class="amz-z-rank"></span><span class="amz-z-detail">No ratings yet</span>`;
      b.title = where;
    } else {
      b.innerHTML =
        `<span class="amz-z-rank"></span>` +
        `<span class="amz-z-score">${item.score.toFixed(2)}</span>` +
        `<span class="amz-z-detail">${item.rating.toFixed(1)}★ from ${fmt(item.count)}</span>`;
      b.title = `AmaZoom score ${item.score.toFixed(2)}: ${item.rating}★ from ${fmt(item.count)} ratings. ${where}.`;
    }
    if (item.sponsored) b.insertAdjacentHTML('beforeend', '<span class="amz-z-ad">Ad</span>');
    b.insertAdjacentHTML('beforeend', '<span class="amz-z-was"></span>');
    return b;
  }

  // "Amazon #12 ▲9": where Amazon ranked it among the products shown, and
  // how far AmaZoom moved it. Hidden in Amazon's own order, where it's moot.
  function renderMove(item, now, was, mode) {
    const el = item.badge.querySelector('.amz-z-was');
    if (!now || mode === 'amazon') {
      el.hidden = true;
      return;
    }
    const delta = was - now;
    el.hidden = false;
    el.dataset.dir = delta > 0 ? 'up' : delta < 0 ? 'down' : 'same';
    el.textContent = `Amazon #${was} ` + (delta > 0 ? `▲${delta}` : delta < 0 ? `▼${-delta}` : '=');
    el.title =
      delta > 0 ? `Up ${delta} from Amazon's order` : delta < 0 ? `Down ${-delta} from Amazon's order` : "Same as Amazon's order";
  }

  // Re-order the cards in one DOM write, right after our anchor in the
  // results grid. Other widgets (carousels, pagination) end up after them.
  function render() {
    const { mode, hideSponsored } = state.settings;
    const isHidden = (item) => hideSponsored && item.sponsored;
    // Amazon's rank among the same visible products, so the moves add up.
    const was = new Map(rank(state.items.filter((i) => !isHidden(i)), 'amazon').map((item, i) => [item, i + 1]));
    const ranked = rank(state.items, mode);
    const frag = document.createDocumentFragment();
    let n = 0;
    for (const item of ranked) {
      const hidden = isHidden(item);
      const now = hidden ? 0 : ++n;
      item.el.classList.toggle('amz-z-hidden', hidden);
      item.badge.querySelector('.amz-z-rank').textContent = now ? `#${now}` : '';
      renderMove(item, now, was.get(item), mode);
      frag.append(item.el);
    }
    anchor.after(frag);
    renderBar();
  }

  function renderBar() {
    const { mode, hideSponsored } = state.settings;
    for (const btn of ui.querySelectorAll('[data-mode]')) btn.setAttribute('aria-pressed', btn.dataset.mode === mode);
    ui.querySelector('#hide').checked = hideSponsored;

    const scan = ui.querySelector('#scan');
    scan.disabled = state.scanning || state.done;
    scan.textContent = state.scanning ? 'Scanning…' : state.done ? 'All pages scanned' : `Scan ${SCAN_PAGES} more pages`;

    const rated = state.items.filter((i) => i.score != null).length;
    const pages = state.lastPage - pageOf(location.href) + 1;
    ui.querySelector('#status').textContent =
      `${fmt(state.items.length)} products from ${pages} page${pages > 1 ? 's' : ''} (${fmt(rated)} rated)` +
      (state.message ? ` · ${state.message}` : '');
  }

  async function scanMore() {
    if (state.scanning || state.done) return;
    state.scanning = true;
    state.message = '';
    renderBar();
    try {
      for (let i = 0; i < SCAN_PAGES; i++) {
        const page = state.lastPage + 1;
        if (page > MAX_PAGE) {
          state.done = true;
          break;
        }
        if (i > 0) await sleep(SCAN_DELAY_MS);
        const url = new URL(location.href);
        url.searchParams.set('page', page);
        const res = await fetch(url, { credentials: 'include' });
        if (!res.ok) {
          state.message = `Amazon returned ${res.status}; stopped`;
          break;
        }
        const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
        if (isRobotCheck(doc)) {
          state.message = 'Amazon asked for a robot check; stopped. Try again later.';
          break;
        }
        const items = parseCards(doc, page);
        if (!items.length) {
          state.done = true;
          break;
        }
        for (const item of items) item.el = document.importNode(item.el, true);
        if (!addItems(items)) {
          state.done = true; // Amazon repeated a page we already have
          break;
        }
        state.lastPage = page;
        render();
      }
    } catch (err) {
      state.message = `Couldn't load more pages (${err.message})`;
    } finally {
      state.scanning = false;
      render();
    }
  }

  function buildBar() {
    const host = document.createElement('div');
    host.id = 'amz-z-bar';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        :host { all: initial; display: block; margin: 0 0 12px; font: 14px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; }
        .bar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 16px; padding: 10px 14px;
               background: #f0f7ff; border: 1px solid #b9d7f5; border-radius: 10px; color: #0f1111; }
        .logo { font-weight: 700; font-size: 16px; color: #0b5cad; letter-spacing: -0.01em; }
        .seg { display: inline-flex; border: 1px solid #8fb8e3; border-radius: 8px; overflow: hidden; }
        .seg button { font: inherit; border: 0; background: #fff; color: #0f1111; padding: 5px 11px; cursor: pointer; }
        .seg button + button { border-left: 1px solid #8fb8e3; }
        .seg button[aria-pressed="true"] { background: #0b5cad; color: #fff; }
        .seg button:focus-visible, #scan:focus-visible { outline: 2px solid #0b5cad; outline-offset: 2px; }
        label { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
        #scan { font: inherit; padding: 5px 12px; border-radius: 8px; border: 1px solid #0b5cad;
                background: #fff; color: #0b5cad; cursor: pointer; }
        #scan:disabled { opacity: .55; cursor: default; }
        #status { color: #565959; }
        .how { color: #565959; font-size: 12px; flex-basis: 100%; margin: 0; }
      </style>
      <div class="bar" role="region" aria-label="AmaZoom">
        <span class="logo">🔍 AmaZoom</span>
        <span class="seg" role="group" aria-label="Sort by">
          <button data-mode="best" title="Star rating weighted by how many people rated it">Best reviewed</button>
          <button data-mode="count">Most ratings</button>
          <button data-mode="amazon">Amazon's order</button>
        </span>
        <label><input type="checkbox" id="hide"> Hide sponsored</label>
        <button id="scan"></button>
        <span id="status" aria-live="polite"></span>
        <p class="how">Score = average stars, with every product starting as if it had ${PRIOR_WEIGHT} ratings of
          ${PRIOR_MEAN}★. A handful of 5-star ratings can't beat thousands of 4.7s.</p>
      </div>`;

    root.addEventListener('click', async (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      if (btn.dataset.mode) {
        state.settings.mode = btn.dataset.mode;
        store.set({ mode: state.settings.mode });
        render();
      } else if (btn.id === 'scan') {
        scanMore();
      }
    });
    root.querySelector('#hide').addEventListener('change', (e) => {
      state.settings.hideSponsored = e.target.checked;
      store.set({ hideSponsored: e.target.checked });
      render();
    });
    return { host, root };
  }

  async function init() {
    slot = findSlot(document);
    if (!slot || document.getElementById('amz-z-bar')) return;
    const page = pageOf(location.href);
    const items = parseCards(document, page);
    if (!items.length) return;

    state.settings = await store.get();
    state.lastPage = page;

    anchor = document.createElement('div');
    anchor.className = 'amz-z-anchor';
    items[0].el.before(anchor);

    const bar = buildBar();
    ui = bar.root;
    slot.before(bar.host);

    addItems(items);
    render();
  }

  init();
})();
