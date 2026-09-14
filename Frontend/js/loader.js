(() => {
  const LOADER_ID = 'mfcPageLoader';
  const NAV_DELAY_MS = 0;
  const PREFETCH_DELAY_MS = 80;
  const NAVIGATION_TIMEOUT_MS = 12000;
  let navigating = false;
  let navigationTimer = null;

  function destinationLabel(url) {
    try {
      const path = new URL(url, window.location.href).pathname.replace(/\/$/, '');
      const labels = {
        '': 'Welcome',
        '/': 'Welcome',
        '/dashboard': 'Dashboard',
        '/member': 'Member portal',
        '/chapters': 'Chapters',
        '/events': 'Events',
        '/members': 'Members',
        '/reports': 'Reports',
        '/services': 'Services',
        '/register': 'Account access',
        '/change-password': 'Security settings'
      };
      return labels[path] || 'Your next page';
    } catch {
      return 'Your next page';
    }
  }

  function ensureLoader() {
    if (document.getElementById(LOADER_ID) || !document.body) return;

    const overlay = document.createElement('div');
    overlay.id = LOADER_ID;
    overlay.className = 'page-loader';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = `
      <div class="page-loader__content" role="status" aria-live="polite" aria-label="Loading page">
        <div class="page-loader__mark" aria-hidden="true">
          <span class="page-loader__mark-ring"></span>
          <img class="page-loader__logo" src="/img/logo-2.png" alt="" decoding="async" fetchpriority="high">
        </div>
        <div class="page-loader__copy">
          <span class="page-loader__overline">MFC Youth</span>
          <strong class="page-loader__label">Getting things ready</strong>
          <span class="page-loader__destination"></span>
        </div>
        <div class="page-loader__progress" aria-hidden="true"><span></span></div>
      </div>
    `;

    document.body.appendChild(overlay);
  }

  function show() {
    ensureLoader();
    const overlay = document.getElementById(LOADER_ID);
    if (!overlay) return;

    const destination = overlay.querySelector('.page-loader__destination');
    if (destination) destination.textContent = 'Loading your workspace';
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
    const destination = overlay?.querySelector('.page-loader__destination');
    if (destination) destination.textContent = `Opening ${destinationLabel(url)}`;

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

  const prefetched = new Set();

  function prefetchUrl(rawUrl) {
    try {
      const target = new URL(rawUrl, window.location.href);
      if (target.origin !== window.location.origin) return;
      if (target.pathname === window.location.pathname) return;
      const key = `${target.pathname}${target.search}`;
      if (prefetched.has(key)) return;
      prefetched.add(key);

      const link = document.createElement('link');
      link.rel = 'prefetch';
      link.href = target.href;
      link.as = 'document';
      document.head.appendChild(link);
    } catch {}
  }

  function warmVisibleNavigation() {
    const links = [...document.querySelectorAll('a[href]')]
      .filter(anchor => {
        try {
          const target = new URL(anchor.href, window.location.href);
          return target.origin === window.location.origin && target.pathname !== window.location.pathname;
        } catch {
          return false;
        }
      })
      .slice(0, 12);

    const run = () => links.forEach(anchor => prefetchUrl(anchor.href));
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(run, { timeout: 1200 });
    } else {
      window.setTimeout(run, 350);
    }
  }

  ensureLoader();
  warmVisibleNavigation();

  document.addEventListener('pointerover', event => {
    const anchor = event.target.closest?.('a[href]');
    if (!anchor) return;
    window.setTimeout(() => prefetchUrl(anchor.href), PREFETCH_DELAY_MS);
  }, { passive: true });

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
