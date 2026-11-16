# Frontend

React + TypeScript SPA (Vite) for the Enterprise AI Agent Platform. Deploys to Azure Static Web Apps via `.github/workflows/frontend-cd.yml`.

## Stack

- React 19 + TypeScript
- Vite 6
- Tailwind CSS 4 (`@tailwindcss/vite`)
- React Router
- ESLint + TypeScript ESLint
- Lightweight shadcn-style `Button` (`class-variance-authority` + `tailwind-merge`)

Requires Node.js 26+.

## Scripts

| Command             | Purpose                                         |
| ------------------- | ----------------------------------------------- |
| `npm run dev`       | Local Vite dev server (`http://localhost:5173`) |
| `npm test`          | Vitest                                          |
| `npm run lint`      | ESLint (flat config)                            |
| `npm run typecheck` | `tsc -b`                                        |
| `npm run build`     | Typecheck + production build → `dist/`          |
| `npm run preview`   | Preview production build                        |

## Setup

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

Set `VITE_API_BASE_URL` to the FastAPI origin (local or Container App URL). Demo builds read these GitHub repository variables: `VITE_API_BASE_URL`, `VITE_AUTH0_DOMAIN`, `VITE_AUTH0_CLIENT_ID`, and `VITE_AUTH0_AUDIENCE`. The Auth0 values are the public SPA settings. Optional `VITE_LANGSMITH_PROJECT_URL` is an absolute `http://` or `https://` project URL. The management page shows each execution's `langsmith_run_id` as a copyable correlation id and, when that variable is a valid http(s) URL, a link to the project. It does not build a per-trace URL, and any other scheme is ignored.

## Sign-in

The chat workspace uses the existing Auth0 **EAP Web** SPA (Authorization Code + PKCE). Copy the three `VITE_AUTH0_*` values from `.env.example` into `.env`. `VITE_AUTH0_DOMAIN` is the tenant hostname only. `VITE_AUTH0_AUDIENCE` is `https://api.agent-platform`. The browser requests an access token for that audience; there is no client secret in the frontend.

In the Auth0 application, allow these callback, logout, and web-origin URLs:

- `http://localhost:5173`
- the deployed Static Web App origin (`staticWebAppUrl` from the infra deployment)

If any Auth0 setting is missing, the app shows a configuration screen and does not call protected routes. `/health` stays public. A 401 returns the user to sign-in. An agent listed by `GET /agents` can be viewed without being executable; a 403 leaves the open transcript in place.

## Notes

- Path alias: `@/*` → `src/*`
- SWA SPA fallback: `public/staticwebapp.config.json` (copied into `dist/`)
- Keep secrets out of the browser. `VITE_*` values are public: the API origin and the Auth0 SPA settings.
