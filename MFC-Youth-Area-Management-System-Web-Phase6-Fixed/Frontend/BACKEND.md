# Frontend ↔ Backend Routing

The production frontend calls relative `/api/...` URLs.

On Vercel, `Frontend/vercel.json` rewrites those requests directly to:

`https://mfc-youth-area-management-backend.vercel.app/api/:path*`

This keeps browser requests same-origin from the application's point of view while avoiding a separate Frontend serverless proxy function for every endpoint.

The Backend then dispatches all API paths through one Vercel Function (`Backend/api/router.js`). This keeps both projects within the Vercel Hobby function-count limit and reduces unnecessary proxy-function cold starts.

If the stable Backend production domain changes, update the destination in `Frontend/vercel.json`.
