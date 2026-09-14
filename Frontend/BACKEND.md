# Backend connection

The repository has separate Vercel projects:

```text
MFC-Youth-Area-Management-System-Web/
├── Backend/
└── Frontend/
```

The Frontend `api/` routes are lightweight proxies. They forward `/api/*` requests to the Backend using `BACKEND_URL`.

```text
Browser
   ↓
Frontend /api/auth/login
   ↓
BACKEND_URL/api/auth/login
   ↓
Backend
   ↓
Neon PostgreSQL
```

The proxy also forwards the Backend's secure `HttpOnly` authentication cookie back to the browser, so database/session secrets are not stored in browser JavaScript.

## Vercel setup

### Backend project

Root Directory: `Backend`

Environment variables:

- `DATABASE_URL` — supplied by the Neon integration
- `ADMIN_REGISTRATION_CODE` — server-only
- `FRONTEND_ORIGIN=https://your-frontend-domain.vercel.app` — recommended

### Frontend project

Root Directory: `Frontend`

Environment variable:

- `BACKEND_URL=https://your-backend-project.vercel.app`

Redeploy both projects after changing environment variables or backend code.
