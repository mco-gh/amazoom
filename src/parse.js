// Reads product cards out of an Amazon search results document (the live page
// or a fetched later page). Amazon's markup changes often, so every field has
// fallbacks and a card with no rating is kept, just unscored.
(() => {
  const AZ = (globalThis.AmaZoom ??= {});
  const { parseCount, parseRating, bayesian } = AZ.score;

  const CARD = 'div[data-component-type="s-search-result"][data-asin]';

  function findSlot(doc) {
    return doc.querySelector('.s-main-slot') || doc.querySelector(CARD)?.parentElement || null;
  }

  function cardsIn(doc) {
    return [...doc.querySelectorAll(CARD)].filter((el) => el.dataset.asin);
  }

  function readRating(card) {
    for (const el of card.querySelectorAll('.a-icon-alt, [aria-label*="out of 5"]')) {
      const r = parseRating(el.getAttribute('aria-label') || el.textContent);
      if (r != null) return r;
    }
    return null;
  }

  function readCount(card) {
    // Newer markup: <a aria-label="12,345 ratings" href="...#customerReviews">(12.3K)</a>
    for (const el of card.querySelectorAll('[aria-label]')) {
      const label = el.getAttribute('aria-label');
      if (/out of 5/i.test(label)) continue;
      if (/^\s*[\d,.]+[KkMm]?\+?\s*(ratings?|reviews?)?\s*$/i.test(label)) return parseCount(label);
    }
    const link = card.querySelector('a[href*="#customerReviews"], a[href*="customerReviews"]');
    if (link) {
      const n = parseCount(link.textContent);
      if (n != null) return n;
    }
    const u = card.querySelector('[data-cy="reviews-block"] .s-underline-text');
    return u ? parseCount(u.textContent) : null;
  }

  function isSponsored(card) {
    if (card.classList.contains('AdHolder')) return true;
    if (card.querySelector('.puis-sponsored-label-text, .s-sponsored-label-text, [aria-label*="Sponsored"]'))
      return true;
    return [...card.querySelectorAll('.a-color-secondary, .a-size-mini')].some(
      (el) => el.textContent.trim() === 'Sponsored',
    );
  }

  function readTitle(card) {
    const el = card.querySelector('h2 span, h2 a, [data-cy="title-recipe"] span');
    return el ? el.textContent.trim() : '';
  }

  // Returns plain records; `el` is the card element (in whatever document).
  function parseCards(doc, page) {
    return cardsIn(doc).map((el, i) => {
      const rating = readRating(el);
      const count = readCount(el);
      return {
        el,
        asin: el.dataset.asin,
        title: readTitle(el),
        rating,
        count,
        score: bayesian(rating, count),
        sponsored: isSponsored(el),
        page,
        pos: i + 1,
      };
    });
  }

  // Amazon serves a robot check instead of results when it gets suspicious.
  function isRobotCheck(doc) {
    return !!doc.querySelector('form[action*="validateCaptcha"], #captchacharacters');
  }

  AZ.parse = { CARD, findSlot, cardsIn, parseCards, isRobotCheck };
})();
