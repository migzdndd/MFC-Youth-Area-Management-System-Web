# Application Contingency & Incident Response Plan

This document outlines the standard operating procedures for handling failures, outages, and unexpected errors within the MFC Youth Area Management System.

## 1. Automated Fallbacks & Error Handling
The application has been designed with built-in fault tolerance:
- **Frontend Error Boundaries:** Uncaught exceptions in the UI are intercepted by global error handlers (`window.onerror` and `unhandledrejection`). This prevents the application from showing a blank screen and instead presents a user-friendly error message or toast notification.
- **Backend Graceful Degradation:** All Vercel serverless functions are wrapped in global `try/catch` blocks. If an endpoint encounters an internal error or fails to reach the database, it returns a standardized HTTP 500 response (`{ error: "Internal Server Error", details: "..." }`) rather than crashing silently. 

## 2. Incident Scenarios

### A. Database (Supabase) Outage
**Symptoms:** Users cannot log in, load profiles, or fetch lists. Network tabs show `500 Internal Server Error` or timeout responses for data-heavy endpoints.
**Contingency Steps:**
1. Check the [Supabase Status Page](https://status.supabase.com/) for ongoing incidents.
2. If it is a known outage, display a global maintenance banner on the frontend using Vercel Edge Config (if available) or by deploying a quick temporary commit to `index.html`.
3. Inform stakeholders that data input is temporarily paused. Provide paper/spreadsheet fallback forms for any ongoing live events (e.g., Youth Camps).

### B. Vercel Function Errors (Timeouts/Limits)
**Symptoms:** Specific actions (like exporting a large CSV report) fail repeatedly with `504 Gateway Timeout` or `429 Too Many Requests`.
**Contingency Steps:**
1. Review Vercel Function Logs to identify the bottleneck.
2. If a query is too slow, optimize the Supabase index or reduce the payload size (e.g., limit date ranges on reports).
3. For immediate relief, instruct users to chunk their requests (e.g., download reports month-by-month instead of year-to-date).

### C. Frontend Deployment Issues
**Symptoms:** Users see a blank white screen, or buttons do not respond after a recent deployment.
**Contingency Steps:**
1. Navigate to the Vercel Dashboard and find the previous successful deployment.
2. Click **"Promote to Production"** on the previous healthy deployment to instantly rollback the breaking changes.
3. Once stable, debug the breaking commit locally by checking the browser console for uncaught syntax errors or missing dependencies.

## 3. Communication Protocol
In the event of a critical outage lasting more than 15 minutes:
- **Notify:** The Lead Developer or System Administrator must immediately notify the National Coordinators.
- **Update:** Post an announcement in the official servant leaders' group chat or communication channel.
- **Post-Mortem:** After resolution, update this document with the root cause and steps taken to prevent recurrence.
