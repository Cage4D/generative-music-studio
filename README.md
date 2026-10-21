# Generative Music Studio

Deterministic procedural music: pick a generator, tweak the parameters, pick a
seed, and the same seed always produces the same music. Patterns can be saved
to the API, shared as a link, and remixed.

- `app/web` — Next.js front end (studio UI, pattern preview, share pages).
- `app/api` — NestJS API (save, fetch, remix, gallery) on Prisma + Postgres.
- `app/packages/shared` — shared Zod schemas and types (`@gms/shared`).
- `docs/` — design notes and the working brief.

The pnpm workspace root is `app/`, so every command below runs from there
unless stated otherwise.

---

## Local run

### 1. Postgres

Any Postgres 14+ works. With Docker:

```bash
docker run --name gms-postgres \
  -e POSTGRES_USER=music_studio_user \
  -e POSTGRES_PASSWORD=music_studio_user \
  -e POSTGRES_DB=generative_music_studio \
  -p 5432:5432 -d postgres:16
```

### 2. Environment files

```bash
cp app/api/.env.example app/api/.env   # DATABASE_URL, PORT, CORS_ORIGINS, ...
cp app/web/.env.example app/web/.env   # NEXT_PUBLIC_API_URL, NEXT_PUBLIC_SITE_URL
```

`.env` files are git-ignored; only the `.env.example` files are committed.

### 3. Install and prepare the database

```bash
cd app
pnpm install
pnpm run build:shared        # builds @gms/shared (needed by both apps)
pnpm run prisma:generate     # generates the Prisma client
pnpm run prisma:migrate      # creates/applies migrations (dev only)
```

### 4. Run

```bash
cd app
pnpm run dev:api             # http://localhost:4000  (PORT comes from app/api/.env)
pnpm run dev:web             # http://localhost:3000
```

### 5. Checks

```bash
cd app
pnpm test                    # API (vitest) + web (vitest, including component tests)
pnpm run lint                # oxlint for the API, eslint for the web
pnpm run build               # shared -> prisma generate -> API -> web
cd api && pnpm run test:e2e  # e2e suite; needs Postgres, uses generative_music_studio_test
```

---

## Deploy

Three services: Postgres (Neon), API (Render), web (Vercel). No secrets belong
in this repository — every secret is set in the hosting dashboard.

### 1. Postgres — Neon

1. Create a Neon project and copy its connection string.
2. Use the direct (not pooled) connection string for migrations:
   `postgresql://USER:PASSWORD@HOST/neondb?sslmode=require`
   The API strips `channel_binding` from the URL if Neon adds it, because the
   `pg` driver does not understand that flag.
3. Apply the migrations once (any machine with the URL and Node 22+):

   ```bash
   cd app
   DATABASE_URL="postgresql://..." pnpm run prisma:deploy
   ```

   Migrations live in `app/api/prisma/migrations/` and are committed. The API
   also runs `prisma migrate deploy` on boot, so this step can be skipped if
   the database is created first.

### 2. API — Render

`render.yaml` in the repo root describes the service, so Render can pick it up
as a Blueprint:

1. Render → New → Blueprint → select this repository.
2. Set the two secret environment variables in the dashboard:
   - `DATABASE_URL` — the Neon connection string.
   - `CORS_ORIGINS` — comma separated browser origins, e.g.
     `https://your-app.vercel.app`. A wildcard (`*`) is rejected when
     `NODE_ENV=production`.
3. Deploy. Render injects `PORT` itself; the API listens on `0.0.0.0:$PORT`.
4. Check `https://<api-host>/health` returns `{"status":"ok"}`.

Non-secret variables (already in `render.yaml`): `NODE_VERSION=24`,
`NODE_ENV=production`, `TRUST_PROXY=1`, `RATE_LIMIT_MAX=120`,
`RATE_LIMIT_WINDOW_MS=60000`.

Build and start commands:

```
build: cd app && pnpm install --frozen-lockfile --prod=false && pnpm run build:api
start: cd app && pnpm --filter api run prisma:deploy && pnpm --filter api run start:prod
```

### 3. Web — Vercel

1. Vercel → New Project → import this repository.
2. Project settings:
   - **Root Directory**: `app/web`
   - **Framework Preset**: Next.js (auto-detected)
   - **Install Command**: `cd app 2>/dev/null || true; pnpm install --frozen-lockfile --prod=false`
     (the `cd app` prefix lets the command work whether the shell starts in
     the repository root or in `app/web`; `--prod=false` keeps the dev
     dependencies that the build needs)
   - **Build Command**: `pnpm run build`
   - **Include source files outside of the Root Directory in the Build Step**:
     **on** — the pnpm workspace lives in `app/`, so the workspace root and
     `app/packages/shared` must be present in the build context.
   `app/web/vercel.json` already contains the install/build commands.
3. Environment variables (set them for **both** Build and Production; the
   `NEXT_PUBLIC_` values are inlined into the client bundle at build time, so
   changing them later requires a new build):
   - `NEXT_PUBLIC_API_URL` — the API base URL, e.g. `https://<api-host>`
     (no trailing slash).
   - `NEXT_PUBLIC_SITE_URL` — the public URL of this app, e.g.
     `https://your-app.vercel.app`. Used for Open Graph/metadata; optional.
4. Deploy, then set `CORS_ORIGINS` on Render to the Vercel URL and redeploy
   the API.

### Environment variables at a glance

| Service | Variable | Required | Notes |
| --- | --- | --- | --- |
| API | `DATABASE_URL` | yes | Postgres connection string. Only DB configuration. |
| API | `PORT` | no | Defaults to `3000`; Render injects its own. |
| API | `CORS_ORIGINS` | yes in prod | Comma separated origins. No wildcard in production. |
| API | `TRUST_PROXY` | no | Proxy hops to trust for the client IP. Default `1`. |
| API | `RATE_LIMIT_MAX` | no | Requests per IP per window. `0` disables. Default `120`. |
| API | `RATE_LIMIT_WINDOW_MS` | no | Limiter window. Default `60000`. |
| Web | `NEXT_PUBLIC_API_URL` | yes | API base URL, inlined at build time. |
| Web | `NEXT_PUBLIC_SITE_URL` | no | Public site URL for metadata. Defaults to `http://localhost:3000`. |

### Notes

- The rate limiter keys on the real client IP, so the API trusts one proxy hop
  (`TRUST_PROXY=1`). If you put a CDN in front of Render, raise it to `2`.
- `/track/[slug]` fetches the pattern server-side for its title with a 2.5 s
  timeout and no retries, so a sleeping or unreachable API degrades to a
  fallback title instead of breaking the page.
- Free-tier hosts sleep when idle; the first request after a sleep can take
  tens of seconds. The studio client retries and shows a retry button.
