---
name: fullstack-developer
description: Comprehensive full-stack developer skill covering FrontEnd (HTML5, CSS3, modern JS/TS, React/Next.js, Tailwind, state management), BackEnd (Node.js, Express, NestJS, Python, REST, GraphQL, WebSockets), DataBase (PostgreSQL, MySQL, MongoDB, Redis, Prisma, ORMs), DevOps (Git, GitHub Actions, Docker, Cloud Platforms), Tools (Testing with Jest/Cypress, Vite, ESLint), and Core Concepts (System Design, Web Security, Performance Optimization). Use when designing, building, testing, securing, deploying, or auditing full-stack applications.
---

# Full-Stack Developer Skill & Engineering Standards

This skill equips Antigravity with end-to-end full-stack engineering practices, architectural patterns, and execution runbooks spanning **FrontEnd**, **BackEnd**, **DataBase**, **DevOps**, **Tools**, and **Core Concepts**.

---

## 1. FrontEnd Engineering Standards

### 1.1 Fundamentals & Semantics
- **HTML5**: Always structure markup with semantic elements (`<main>`, `<header>`, `<nav>`, `<aside>`, `<footer>`, `<section>`, `<article>`). Enforce proper form accessibility with explicit `<label for="...">` associations and ARIA landmarks.
- **CSS3 & Modern Layouts**:
  - Build responsive layouts using CSS Grid and Flexbox with mobile-first media queries.
  - Implement scalable design systems using CSS Custom Properties (`var(--primary-color)`).
  - Scope expensive compositor properties (`will-change: transform`) strictly to active states (`:hover`, `:focus-visible`) to avoid GPU layer bloat.
- **JavaScript (ES6+)**:
  - Prefer immutable array/object operations (`map`, `filter`, `reduce`, object spread).
  - Use modern asynchronous patterns (`async/await`) with defensive `try/catch` error boundaries.
  - Ensure monotonic or cryptographically safe unique ID generation for client-side items.

### 1.2 Modern Frameworks & Component Architecture
- **React.js & Next.js**:
  - Design modular, single-responsibility components with clean prop interfaces.
  - Adhere to React Hook rules (`useState`, `useEffect`, `useMemo`, `useCallback`, custom hooks).
  - Manage application lifecycle and clean up subscriptions/event listeners on component unmount.
  - Support SSR/SSG/ISR workflows and App Router navigation patterns where applicable.
- **Styling Paradigms**:
  - **Tailwind CSS**: Utility-first styling with responsive prefixing (`sm:`, `md:`, `lg:`), arbitrary variants, and clean class composition.
  - **Sass / SCSS & Modules**: BEM methodology and CSS module scoping to prevent global namespace pollution.
- **State Management**:
  - **Local State**: `useState` and `useReducer` for self-contained UI components.
  - **Global / Shared State**: Choose Context API for low-frequency updates (e.g., auth, theme) or Zustand / Redux Toolkit for complex, high-frequency relational domain state.

---

## 2. BackEnd Engineering Standards

### 2.1 Architecture & Runtime
- **Node.js & Express / Serverless Functions**:
  - Decouple routing, controllers, business services, and database access layers.
  - Use a unified router pattern when constrained by platform function limits (e.g., Vercel Hobby plan limit of 12 functions).
  - Standardize error handling middleware with uniform JSON error envelopes: `{ ok: false, error: "Message", code: "CODE" }`.
- **Languages**:
  - Strict TypeScript or modern ES modules (`type: "module"`) with explicit imports.

### 2.2 APIs & Authorization
- **RESTful APIs**:
  - Correct HTTP verb usage: `GET` (idempotent retrieval), `POST` (create), `PATCH`/`PUT` (mutation), `DELETE` (removal).
  - Clean URL hierarchy with nested resource semantics (e.g., `/api/chapters/:id/members`).
  - Standardized HTTP status codes (`200 OK`, `201 Created`, `400 Bad Request`, `401 Unauthorized`, `403 Forbidden`, `404 Not Found`, `429 Too Many Requests`, `500 Internal Error`).
- **Authentication & Security**:
  - Stateless JSON Web Tokens (JWT) verified on every protected request.
  - Secure credential storage: never expose raw passwords; use industry-standard hashing (bcrypt/Argon2) or delegated identity (Supabase GoTrue).
  - Role-Based Access Control (RBAC) and tenant scoping (e.g. `area_id` filtering) enforced on the server, never trusted from client inputs.
  - Anti-enumeration safeguards on recovery and registration endpoints.
- **Real-Time Capabilities**:
  - WebSockets / Socket.io / Server-Sent Events (SSE) for live synchronization and event broadcasts.

---

## 3. DataBase Architecture & Modeling

### 3.1 Relational Databases (PostgreSQL, MySQL)
- **Data Modeling**:
  - 3NF normalization with selective denormalization for read-heavy aggregations.
  - Mandatory primary keys (UUIDv4 preferred for distributed/multi-tenant systems).
  - Explicit foreign key constraints with sensible cascading rules (`ON DELETE CASCADE` or `ON DELETE SET NULL`).
  - Check constraints for data integrity (`status IN ('Active', 'Inactive')`, `amount >= 0`).
- **Security & Multi-Tenancy**:
  - Enable Row Level Security (RLS) on all production tables.
  - Maintain tenant isolation by enforcing scoping (`area_id`) on all queries and mutations.
- **Performance**:
  - B-tree composite indexes on frequently filtered columns (`area_id`, `status`, `created_at`).
  - Use connection pooling (PgBouncer) for serverless backends to avoid connection exhaustion.

### 3.2 NoSQL & Caching (MongoDB, Redis, Firebase)
- **Redis / Cache Layer**: In-memory session stores, rate limiting, and cache invalidation strategies (Cache-Aside, Write-Through).
- **Document Stores**: Schema validation rules, embedded vs referenced document trade-offs.
- **ORM / Query Builders**: Type-safe queries via Prisma, TypeORM, Mongoose, or direct query builders.

---

## 4. DevOps, CI/CD & Deployment

### 4.1 Version Control & Workflow
- **Git & GitHub**:
  - Clean commit messages (Conventional Commits: `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`).
  - Branching strategy: `main` (production), feature branches (`feature/xxx`), and hotfix branches.
  - Strict `.gitignore` preventing leaks of `.env*`, build artifacts, and dependency trees.

### 4.2 CI/CD Automation
- **GitHub Actions**:
  - Automated pull request verification: linting (`eslint`), type-checking (`tsc`), and test execution.
  - Automated deployment triggers on merge to `main`.
- **Containerization**:
  - Multi-stage `Dockerfile` configurations separating build dependencies from lightweight production images.
  - `docker-compose.yml` for reproducible local development stacks.

### 4.3 Hosting Platforms & Infrastructure
- **Edge / Serverless**: Vercel, Netlify, Render, Railway, Supabase Cloud, AWS, GCP.
- **Security Headers**: HSTS, Content-Security-Policy (CSP), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`.
- **SSL / Custom Domains**: Automated HTTPS certificate lifecycle.

---

## 5. Tools & Developer Productivity

- **Development**: VS Code settings, Postman / Insomnia collections for API testing.
- **Testing Pyramid**:
  - **Unit Testing**: Jest, Vitest for isolated utility and business logic functions.
  - **Integration Testing**: Supertest for HTTP endpoint testing with mocked/staging databases.
  - **End-to-End (E2E) Testing**: Cypress or Playwright for critical user journeys (Auth, Add, Edit, Delete).
- **Build Tools & Bundlers**: Vite, Webpack, PostCSS, NPM/PNPM package management.
- **Code Quality**: ESLint, Prettier formatting, Git pre-commit hooks (Husky).

---

## 6. Core Concepts & Architectural Principles

1. **System Design & Scalability**:
   - Understand throughput, latency, vertical vs horizontal scaling, load balancing, and CAP theorem.
   - Cache-first optimistic rendering with background synchronization for fast perceived performance.
2. **Object-Oriented & Functional Design Patterns**:
   - SOLID principles, Singleton, Factory, Strategy, Observer, Repository patterns.
3. **Web Security**:
   - OWASP Top 10 mitigation: SQL injection prevention (parameterized queries), XSS sanitization, CSRF tokens, strict CORS, rate limiting.
4. **Performance Optimization**:
   - Core Web Vitals (LCP, INP, CLS), asset minification, code splitting, lazy loading, and sub-100ms link prefetching.
