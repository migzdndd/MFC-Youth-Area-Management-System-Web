(() => {
  const LOADER_ID = 'mfcPageLoader';
  const NAV_DELAY_MS = 140;
  const NAVIGATION_TIMEOUT_MS = 12000;
  let navigating = false;
  let navigationTimer = null;

  function ensureLoader() {
    if (document.getElementById(LOADER_ID) || !document.body) return;

    const overlay = document.createElement('div');
    overlay.id = LOADER_ID;
    overlay.className = 'page-loader';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = `
      <div class="spinner" role="status" aria-live="polite" aria-label="Loading page">
        <div></div>
        <div></div>
        <div></div>
        <div></div>
        <div></div>
        <div></div>
        <div></div>
        <div></div>
        <div></div>
        <div></div>
      </div>
    `;

    document.body.appendChild(overlay);
  }

  function show() {
    ensureLoader();
    const overlay = document.getElementById(LOADER_ID);
    if (!overlay) return;

    overlay.classList.add('is-active');
    overlay.setAttribute('aria-hidden', 'false');
    document.documentElement.classList.add('page-is-loading');
  }

  function hide() {
    const overlay = document.getElementById(LOADER_ID);
    if (!overlay) return;

    navigating = false;
    if (navigationTimer) {
      window.clearTimeout(navigationTimer);
      navigationTimer = null;
    }
    overlay.classList.remove('is-active');
    overlay.setAttribute('aria-hidden', 'true');
    document.documentElement.classList.remove('page-is-loading');
  }

  function navigate(url, options = {}) {
    if (!url || navigating) return;
    navigating = true;
    show();

    const overlay = document.getElementById(LOADER_ID);
    navigationTimer = window.setTimeout(() => {
      if (options.replace) {
        window.location.replace(url);
      } else {
        window.location.assign(url);
      }
    }, NAV_DELAY_MS);

    window.setTimeout(() => {
      if (navigating) hide();
    }, NAVIGATION_TIMEOUT_MS);
  }

  function shouldHandleLink(anchor, event) {
    if (!anchor || event.defaultPrevented) return false;
    if (event.button !== 0) return false;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
    if (anchor.hasAttribute('download')) return false;
    if (anchor.target && anchor.target.toLowerCase() !== '_self') return false;

    const rawHref = anchor.getAttribute('href');
    if (!rawHref || rawHref.startsWith('#')) return false;
    if (/^(mailto:|tel:|javascript:)/i.test(rawHref)) return false;

    let target;
    try {
      target = new URL(anchor.href, window.location.href);
    } catch {
      return false;
    }

    if (target.origin !== window.location.origin) return false;

    const current = new URL(window.location.href);
    const sameDocument =
      target.pathname === current.pathname &&
      target.search === current.search &&
      target.hash;

    return !sameDocument;
  }

  ensureLoader();

  document.addEventListener('click', event => {
    const anchor = event.target.closest?.('a[href]');
    if (!shouldHandleLink(anchor, event)) return;

    event.preventDefault();
    navigate(anchor.href);
  }, true);

  window.addEventListener('pageshow', hide);
  window.addEventListener('pagehide', () => {
    if (navigating) show();
  });

  // Expose a small global API so programmatic redirects use the same transition.
  window.MFCPageLoader = { show, hide, navigate };
  window.navigateWithLoader = (url, replace = false) => navigate(url, { replace });
})();
