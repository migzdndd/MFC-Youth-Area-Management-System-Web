# Backend connection

The real backend is stored in the sibling folder:

```text
Web-Source/
├── Backend/
└── Frontend/
```

The `Frontend/api/` files are only lightweight proxy routes. They do not contain backend business logic.
They forward the existing public `/api/*` URLs to the separately deployed Backend project using the
`BACKEND_URL` environment variable.

Example:

```text
Frontend request
POST /api/auth/login
        ↓
Frontend/api/auth/login.js
        ↓
BACKEND_URL/api/auth/login
        ↓
Backend/api/auth/login.js
```

## Vercel setup

1. Create/deploy a Vercel project with **Root Directory = `Backend`**.
2. Add these Backend environment variables:
   - `SUPABASE_URL`
   - `SUPABASE_PUBLISHABLE_KEY`
   - `SUPABASE_SECRET_KEY`
   - `ADMIN_REGISTRATION_CODE` (Backend only)
3. Create/deploy the existing frontend Vercel project with **Root Directory = `Frontend`**.
4. In the Frontend project, set:
   - `BACKEND_URL=https://your-backend-project.vercel.app`
5. Redeploy the Frontend project.

The browser can continue using `/api/...`; the Frontend proxy sends those requests to the Backend project.
