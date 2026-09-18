/**
 * ============================================================================
 * MFC Youth Area Management System - Page Loader & Skeleton Transitions
 * ============================================================================
 * Purpose:
 * Provides smooth, instantaneous page transitions across the application.
 * - Displays contextual skeleton screens while content renders.
 * - Displays a branded loader overlay on page navigation.
 * - Prefetches target pages on link hover/idle to maximize responsiveness.
 * - Exposes MFCPageLoader, MFCPageSkeleton, and navigateWithLoader to the window.
 * ============================================================================
 */

(() => {
  // --------------------------------------------------------------------------
  // 1. Constants & Navigation State
  // --------------------------------------------------------------------------
  const LOADER_ID = 'mfcPageLoader';
  const PREFETCH_DELAY_MS = 40;
  const NAVIGATION_TIMEOUT_MS = 5000;
  let navigating = false;
  let navigationTimer = null;

  // --------------------------------------------------------------------------
  // 2. Destination Route Label Resolver
  // Returns human-friendly text for the loader overlay based on destination URL.
  // --------------------------------------------------------------------------
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
        '/change-password': 'Security settings',
        '/forgot-password': 'Password recovery',
        '/reset-password': 'Reset password'
      };
      return labels[path] || 'Your next page';
    } catch {
      return 'Your next page';
    }
  }

  // --------------------------------------------------------------------------
  // 3. Skeleton UI Generators
  // Builds placeholder UI elements to eliminate layout shift while fetching data.
  // --------------------------------------------------------------------------

  /** Generates header skeleton with optional right-aligned action button */
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

  /** Generates table skeleton with simulated rows and columns */
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

  /** Generates a grid of placeholder metric/data cards */
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

  /** Generates toolbar placeholder containing search and filter controls */
  function toolbarSkeleton() {
    return `
      <div class="toolbar skeleton-toolbar" aria-hidden="true">
        <span class="skeleton-block skeleton-search"></span>
        <span class="skeleton-block skeleton-filter"></span>
        <span class="skeleton-block skeleton-filter"></span>
      </div>
    `;
  }

  /** Maps current page identifier to appropriate skeleton layout */
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

  // --------------------------------------------------------------------------
  // 4. Skeleton DOM Insertion & Lifecycle
  // Mounts skeleton into target container before rendering actual application content.
  // --------------------------------------------------------------------------
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

  /** Cleans up skeleton placeholders once live application data is rendered */
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

  // --------------------------------------------------------------------------
  // 5. Fullscreen Animated Page Loader
  // Creates and controls branded overlay during navigation.
  // --------------------------------------------------------------------------
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

  /** Activates the full-page loading animation overlay */
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

  /** Dismisses the loading animation overlay */
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

  // --------------------------------------------------------------------------
  // 6. Navigation Trigger
  // Initiates navigation with loader overlay and fallback timeout.
  // --------------------------------------------------------------------------
  function navigate(url, options = {}) {
    try {
      if (!url || navigating) return;
      navigating = true;
      show();

      const overlay = document.getElementById(LOADER_ID);
      const destination = overlay?.querySelector('.page-loader__destination');
      if (destination) destination.textContent = `Opening ${destinationLabel(url)}`;

      // Immediate browser navigation
      if (options.replace) {
        window.location.replace(url);
      } else {
        window.location.assign(url);
      }

      // Safety timeout: ensure loader clears if navigation is interrupted
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

  // --------------------------------------------------------------------------
  // 7. Link Click & Prefetch Evaluation
  // Determines if an anchor should be intercepted for enhanced SPA-like loading.
  // --------------------------------------------------------------------------
  function shouldHandleLink(anchor, event) {
    try {
      if (!anchor || event.defaultPrevented) return false;
      if (event.button !== 0) return false; // Left click only
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false; // Ignore modified clicks
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

  /** Injects prefetch link tags for visited or hovered internal links */
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

  /** Preheats navigation for all visible in-viewport links during browser idle time */
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

  // --------------------------------------------------------------------------
  // 8. Event Listeners & Initialization
  // --------------------------------------------------------------------------
  ensureLoader();
  showPageSkeleton();
  warmVisibleNavigation();

  // Prefetch page on hover / pointer-over
  document.addEventListener('pointerover', event => {
    try {
      const anchor = event.target.closest?.('a[href]');
      if (!anchor) return;
      window.setTimeout(() => prefetchUrl(anchor.href), PREFETCH_DELAY_MS);
    } catch {}
  }, { passive: true });

  // Intercept valid internal navigation clicks
  document.addEventListener('click', event => {
    try {
      const anchor = event.target.closest?.('a[href]');
      if (!shouldHandleLink(anchor, event)) return;
      event.preventDefault();
      navigate(anchor.href);
    } catch (error) {
      console.error('Navigation click handler failed:', error);
    }
  }, true);

  // Handle browser back/forward history cache restores
  window.addEventListener('pageshow', () => {
    hide();
    showPageSkeleton();
  });

  // --------------------------------------------------------------------------
  // 9. Global Access Guide Modal
  // --------------------------------------------------------------------------
  function ensureAccessGuideUI() {
    if (document.getElementById('mfcGuideFab')) return;

    const fab = document.createElement('button');
    fab.id = 'mfcGuideFab';
    fab.className = 'mfc-guide-fab';
    fab.setAttribute('aria-label', 'Help & Access Guide');
    fab.setAttribute('title', 'Help & Access Guide');
    fab.innerHTML = '?';

    const modal = document.createElement('div');
    modal.id = 'mfcGuideModal';
    modal.className = 'mfc-guide-modal';
    
    modal.innerHTML = `
      <div class="mfc-guide-modal-content">
        <button class="mfc-guide-close" id="mfcGuideClose" aria-label="Close Guide">&times;</button>
        <h1>Welcome to the MFC Youth System</h1>
        <h2>How to Access and Use the Portal</h2>
        <p>Welcome! This quick guide will help you understand how to log in, what to expect when you access your account, and where you'll find your tools based on your role in MFC Youth.</p>
        <hr>
        <h3>1. Logging In</h3>
        <p>To access your account, simply head to the main login page:</p>
        <ol>
          <li>Enter the <strong>Email Address</strong> associated with your MFC Youth profile.</li>
          <li>Enter your <strong>Password</strong>.</li>
          <li>(Optional) Check the <strong>"Remember Me"</strong> box if you are using a personal, trusted device.</li>
          <li>Click <strong>Sign In</strong>.</li>
        </ol>
        <p><strong>Forgot your password?</strong> Don't worry! Click the "Forgot Password" link on the login page to securely reset it via email.</p>
        <hr>
        <h3>2. First-Time Setup & Security</h3>
        <p>If this is your very first time logging in, or if an administrator recently reset your account, the system may ask you to update your security settings before you can proceed:</p>
        <ul>
          <li><strong>Change Password:</strong> You will be redirected to a secure page to choose a new, private password.</li>
          <li><strong>Area Setup:</strong> If your local area profile isn't fully configured yet, you'll be asked to provide some quick details before jumping into the dashboard.</li>
        </ul>
        <hr>
        <h3>3. Where You'll Go (Based on Your Role)</h3>
        <p>The MFC Youth Area Management System automatically customizes your experience depending on your current service role. Once you log in, you will be taken to the portal that fits your responsibilities:</p>
        <h4>👤 General Members</h4>
        <ul>
          <li>Here, you can view your personal profile.</li>
          <li>See upcoming MFC Youth events in your area.</li>
          <li>Stay updated with recent announcements.</li>
        </ul>
        <h4>🏘️ Chapter Servants</h4>
        <ul>
          <li>From here, you can manage your chapter’s member list.</li>
          <li>Keep track of chapter-specific activities and reports.</li>
        </ul>
        <h4>👑 Area Admins, Coordinators & Other Servant Leaders</h4>
        <ul>
          <li>This is your high-level control center.</li>
          <li>You’ll have access to area-wide analytics, activity reports, and cross-chapter member directories.</li>
        </ul>
        <hr>
        <h3>Need Help?</h3>
        <p>If you ever get lost, you can safely log out by clicking the <strong>"Logout"</strong> button located at the bottom of your sidebar navigation (or the top right in the Member Portal).</p>
        <p>If you believe your account has the wrong role or you cannot access the features you need, please contact your immediate Area Administrator or Couple Coordinator for assistance.</p>
      </div>
    `;

    document.body.appendChild(fab);
    document.body.appendChild(modal);

    const closeModal = () => modal.classList.remove('active');
    
    fab.addEventListener('click', () => modal.classList.add('active'));
    document.getElementById('mfcGuideClose').addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });
  }

  // Ensure access guide UI is built when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureAccessGuideUI);
  } else {
    ensureAccessGuideUI();
  }

  // --------------------------------------------------------------------------
  // 10. Global Exports
  // --------------------------------------------------------------------------
  window.MFCPageLoader = { show, hide, navigate };
  window.MFCPageSkeleton = { show: showPageSkeleton, clear: clearPageSkeleton };
  window.navigateWithLoader = (url, replace = false) => navigate(url, { replace });
})();
