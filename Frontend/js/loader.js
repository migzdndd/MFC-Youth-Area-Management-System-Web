(() => {
  const LOADER_ID = 'mfcPageLoader';
  const PREFETCH_DELAY_MS = 40;
  const NAVIGATION_TIMEOUT_MS = 5000;
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

  function skeletonHeader(withAction = true) {
    return `
      <header class="page-header skeleton-page-header" aria-hidden="true">
        <div>
          <span class="skeleton-line skeleton-title"></span>
          <span class="skeleton-line skeleton-subtitle"></span>
        </div>
        ${withAction ? '<span class="skeleton-block skeleton-action"></span>' : ''}
      </header>
    `;
  }

  function tableSkeleton(rows = 5, columns = 6) {
    const header = Array.from({ length: columns }, () => '<span class="skeleton-line skeleton-table-head"></span>').join('');
    const body = Array.from({ length: rows }, () => `
      <div class="skeleton-table-row">
        ${Array.from({ length: columns }, () => '<span class="skeleton-line skeleton-table-cell"></span>').join('')}
      </div>
    `).join('');

    return `
      <div class="skeleton-table card" aria-hidden="true">
        <div class="skeleton-table-row skeleton-table-header">${header}</div>
        ${body}
      </div>
    `;
  }

  function cardsSkeleton(count = 4) {
    return `
      <div class="skeleton-card-grid" aria-hidden="true">
        ${Array.from({ length: count }, () => `
          <article class="card skeleton-card">
            <span class="skeleton-line skeleton-card-title"></span>
            <span class="skeleton-line skeleton-card-number"></span>
            <span class="skeleton-line skeleton-card-copy"></span>
          </article>
        `).join('')}
      </div>
    `;
  }

  function toolbarSkeleton() {
    return `
      <div class="toolbar skeleton-toolbar" aria-hidden="true">
        <span class="skeleton-block skeleton-search"></span>
        <span class="skeleton-block skeleton-filter"></span>
        <span class="skeleton-block skeleton-filter"></span>
      </div>
    `;
  }

  function pageSkeleton(page) {
    switch (page) {
      case 'dashboard':
        return `
          ${skeletonHeader(false)}
          <section class="skeleton-section" aria-hidden="true">
            <div class="skeleton-section-heading">
              <span class="skeleton-line skeleton-heading"></span>
              <span class="skeleton-line skeleton-copy"></span>
            </div>
            ${cardsSkeleton(5)}
          </section>
          <section class="skeleton-two-column" aria-hidden="true">
            <article class="card skeleton-panel">${tableSkeleton(3, 2)}</article>
            <article class="card skeleton-panel">${tableSkeleton(3, 2)}</article>
          </section>
        `;
      case 'services':
        return `${skeletonHeader(false)}${cardsSkeleton(7)}`;
      case 'members':
        return `${skeletonHeader(true)}${toolbarSkeleton()}${tableSkeleton(6, 7)}`;
      case 'chapters':
        return `${skeletonHeader(true)}${toolbarSkeleton()}${cardsSkeleton(4)}`;
      case 'reports':
        return `${skeletonHeader(true)}${cardsSkeleton(4)}${toolbarSkeleton()}${tableSkeleton(5, 6)}`;
      case 'events':
        return `${skeletonHeader(true)}${toolbarSkeleton()}${cardsSkeleton(4)}`;
      default:
        return `${skeletonHeader(false)}${cardsSkeleton(3)}`;
    }
  }

  function showPageSkeleton() {
    try {
      const root = document.getElementById('pageContent') || document.getElementById('memberPortalContent');
      if (!root || root.childElementCount > 0 || root.dataset.skeletonReady === '1') return;

      const isMemberPortal = root.id === 'memberPortalContent';
      root.dataset.skeletonReady = '1';
      root.setAttribute('aria-busy', 'true');

      const markup = isMemberPortal
        ? `
          <div class="page-skeleton member-portal-skeleton" data-page-skeleton>
            <section class="member-welcome-card skeleton-member-hero" aria-hidden="true">
              <div>
                <span class="skeleton-line skeleton-copy"></span>
                <span class="skeleton-line skeleton-title"></span>
                <span class="skeleton-line skeleton-subtitle"></span>
              </div>
              <span class="skeleton-block skeleton-member-badge"></span>
            </section>
            ${cardsSkeleton(4)}
            <section class="skeleton-member-stack" aria-hidden="true">
              ${Array.from({ length: 3 }, () => '<article class="card skeleton-member-event"><span class="skeleton-block skeleton-member-date"></span><div><span class="skeleton-line skeleton-card-title"></span><span class="skeleton-line skeleton-card-copy"></span></div></article>').join('')}
            </section>
          </div>
        `
        : `<div class="page-skeleton" data-page-skeleton>${pageSkeleton(document.body?.dataset?.page || '')}</div>`;

      root.innerHTML = markup;
    } catch (error) {
      console.warn('Skeleton loader skipped:', error?.message || error);
    }
  }

  function clearPageSkeleton() {
    try {
      const roots = [
        document.getElementById('pageContent'),
        document.getElementById('memberPortalContent')
      ].filter(Boolean);

      roots.forEach(root => {
        root.removeAttribute('aria-busy');
        root.querySelector('[data-page-skeleton]')?.remove();
      });
    } catch (error) {
      console.warn('Skeleton cleanup skipped:', error?.message || error);
    }
  }

  function ensureLoader() {
    try {
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
            <strong class="page-loader__label">Opening page</strong>
            <span class="page-loader__destination"></span>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);
    } catch (error) {
      console.warn('Page loader setup skipped:', error?.message || error);
    }
  }

  function show() {
    try {
      ensureLoader();
      const overlay = document.getElementById(LOADER_ID);
      if (!overlay) return;
      const destination = overlay.querySelector('.page-loader__destination');
      if (destination) destination.textContent = 'Loading workspace';
      overlay.classList.add('is-active');
      overlay.setAttribute('aria-hidden', 'false');
    } catch (error) {
      console.warn('Page loader show skipped:', error?.message || error);
    }
  }

  function hide() {
    try {
      const overlay = document.getElementById(LOADER_ID);
      navigating = false;
      if (navigationTimer) {
        window.clearTimeout(navigationTimer);
        navigationTimer = null;
      }
      if (!overlay) return;
      overlay.classList.remove('is-active');
      overlay.setAttribute('aria-hidden', 'true');
    } catch (error) {
      console.warn('Page loader hide skipped:', error?.message || error);
    }
  }

  function navigate(url, options = {}) {
    try {
      if (!url || navigating) return;
      navigating = true;
      show();

      const overlay = document.getElementById(LOADER_ID);
      const destination = overlay?.querySelector('.page-loader__destination');
      if (destination) destination.textContent = `Opening ${destinationLabel(url)}`;

      // No artificial delay. Navigation starts immediately.
      if (options.replace) {
        window.location.replace(url);
      } else {
        window.location.assign(url);
      }

      navigationTimer = window.setTimeout(() => {
        if (navigating) hide();
      }, NAVIGATION_TIMEOUT_MS);
    } catch (error) {
      navigating = false;
      hide();
      console.error('Navigation failed:', error);
      try {
        window.location.href = url;
      } catch {}
    }
  }

  function shouldHandleLink(anchor, event) {
    try {
      if (!anchor || event.defaultPrevented) return false;
      if (event.button !== 0) return false;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
      if (anchor.hasAttribute('download')) return false;
      if (anchor.target && anchor.target.toLowerCase() !== '_self') return false;

      const rawHref = anchor.getAttribute('href');
      if (!rawHref || rawHref.startsWith('#')) return false;
      if (/^(mailto:|tel:|javascript:)/i.test(rawHref)) return false;

      const target = new URL(anchor.href, window.location.href);
      if (target.origin !== window.location.origin) return false;

      const current = new URL(window.location.href);
      const sameDocument = target.pathname === current.pathname && target.search === current.search && target.hash;
      return !sameDocument;
    } catch {
      return false;
    }
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
    try {
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
        window.requestIdleCallback(run, { timeout: 500 });
      } else {
        window.setTimeout(run, 120);
      }
    } catch (error) {
      console.warn('Page prefetch skipped:', error?.message || error);
    }
  }

  ensureLoader();
  showPageSkeleton();
  warmVisibleNavigation();

  document.addEventListener('pointerover', event => {
    try {
      const anchor = event.target.closest?.('a[href]');
      if (!anchor) return;
      window.setTimeout(() => prefetchUrl(anchor.href), PREFETCH_DELAY_MS);
    } catch {}
  }, { passive: true });

  document.addEventListener('click', event => {
    try {
      const navButton = event.target.closest?.('[data-nav]');
      if (navButton) {
        const target = navButton.getAttribute('data-nav');
        if (target) {
          event.preventDefault();
          navigate(target);
          return;
        }
      }

      const anchor = event.target.closest?.('a[href]');
      if (!shouldHandleLink(anchor, event)) return;
      event.preventDefault();
      navigate(anchor.href);
    } catch (error) {
      console.error('Navigation click handler failed:', error);
    }
  }, true);

  window.addEventListener('pageshow', () => {
    hide();
    showPageSkeleton();
  });

  window.MFCPageLoader = { show, hide, navigate };
  window.MFCPageSkeleton = { show: showPageSkeleton, clear: clearPageSkeleton };
  window.navigateWithLoader = (url, replace = false) => navigate(url, { replace });
})();
