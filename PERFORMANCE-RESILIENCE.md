# Performance & Resilience Update

## Page loading
- Management pages render immediately from cached/browser data instead of waiting for the cloud member sync.
- Supabase/member synchronization now runs in the background after the initial render.
- Page-specific skeleton loaders are injected before `app.js` executes and mirror dashboard cards, toolbars, tables, service cards, events, reports, and the Member Portal.
- Internal links are prefetched during idle time and on hover.
- Navigation no longer has an artificial delay.

## Crash/error handling
- Backend API calls now have an 8-second client timeout with friendly network/timeout errors.
- Page rendering is wrapped in a crash boundary that shows a recoverable Try Again card instead of leaving a blank page.
- Background cloud synchronization failures do not wipe or block cached content.
- Loader/prefetch/navigation operations use defensive try/catch handling.
- Unhandled browser and promise errors are logged for debugging.

## Security note
Real `.env.local` files are intentionally excluded from distribution. Configure secrets locally or in Vercel environment variables only.
