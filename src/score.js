// AmaZoom scoring. Plain script (content scripts can't be modules); exposes
// globalThis.AmaZoom.score so the node tests can load it too.
(() => {
  const AZ = (globalThis.AmaZoom ??= {});

  // A Bayesian average: every product starts with PRIOR_WEIGHT imaginary
  // ratings of PRIOR_MEAN stars, and real ratings pull it toward the true
  // average. Three 5-star ratings barely move it; thousands of 4.6s do.
  // This is the 2010 idea (rating x count) without letting sheer volume
  // beat quality: 4.6 from 2,000 people outranks 4.2 from 50,000.
  const PRIOR_MEAN = 3.5;
  const PRIOR_WEIGHT = 25;

  function bayesian(rating, count) {
    if (!(rating > 0) || !(count > 0)) return null;
    return (PRIOR_MEAN * PRIOR_WEIGHT + rating * count) / (PRIOR_WEIGHT + count);
  }

  // Parse "12,345", "(12.3K)", "1.2M", "12K+" into a number.
  function parseCount(text) {
    if (!text) return null;
    const m = String(text).replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*([KkMm])?/);
    if (!m) return null;
    const mult = { k: 1e3, m: 1e6 }[(m[2] || '').toLowerCase()] || 1;
    return Math.round(parseFloat(m[1]) * mult);
  }

  // Parse "4.5 out of 5 stars" into 4.5.
  function parseRating(text) {
    const m = String(text || '').match(/(\d(?:[.,]\d)?)\s*out of\s*5/i);
    return m ? parseFloat(m[1].replace(',', '.')) : null;
  }

  const SORTS = {
    // Unscored products sink to the bottom, then fall back to Amazon's order.
    best: (a, b) => (b.score ?? -1) - (a.score ?? -1) || a.order - b.order,
    count: (a, b) => (b.count ?? -1) - (a.count ?? -1) || a.order - b.order,
    amazon: (a, b) => a.order - b.order,
  };

  function rank(items, mode) {
    return [...items].sort(SORTS[mode] || SORTS.best);
  }

  AZ.score = { bayesian, parseCount, parseRating, rank, PRIOR_MEAN, PRIOR_WEIGHT };
})();
