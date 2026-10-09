# Next.js Starter Template

A production-ready base for new Next.js projects: **auth that actually scales
down**, PostgreSQL via Drizzle, a consistent server-action contract, and a
themeable shadcn/base-ui component kit. Fork it, rename it, ship.

## Stack

| What | Which |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack) |
| Language | TypeScript |
| Database | PostgreSQL via Drizzle ORM + `postgres` |
| Auth | better-auth (email/password + GitHub + Google) |
| Validation | zod + react-hook-form |
| Styling | Tailwind CSS v4 + shadcn/base-ui primitives |
| Theme | next-themes (light / dark / system) |
| Extras | sonner toasts, pino logging |

## Getting started

### 1. Node

Requires Node.js 20+. The repo pins `npm@12.0.1` via `packageManager`.

### 2. Environment

Copy `.env.example` → `.env` and fill it in. At minimum:

```env
DATABASE_URL="postgres://postgres:postgres@localhost:5432/nextjs_template"
BETTER_AUTH_SECRET="<openssl rand -base64 32>"
BETTER_AUTH_URL="http://localhost:3000"
```

Everything else is opt-in:
- `AUTH_EMAIL_PASSWORD` — set to `"false"` to drop email/password auth.
- `NEXT_PUBLIC_AUTH_SOCIAL_PROVIDERS` — `"github,google"` by default; set to
  `""` for email/password only. A provider only appears/applies when its
  `*_CLIENT_ID` + `*_CLIENT_SECRET` are populated too.

### 3. Database

```bash
npm install
npm run db:generate   # build initial SQL from db/schema/
npm run db:migrate    # apply it
npm run dev
```

Open http://localhost:3000, create an account, and land on `/dashboard`.

### Useful commands

```bash
npm run dev          # dev server
npm run build        # production build + type check
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit
npm run db:generate  # new migration from schema changes
npm run db:migrate   # apply migrations
npm run db:push      # push schema without migrations (dev-only shortcut)
npm run db:studio    # Drizzle Studio UI
```

## How it's wired

### Auth (the "better auth" part)

`lib/auth/` owns everything:
- `providers.ts` — the single source of truth for which social providers exist.
  Shared by the server config and the client sign-in UI so they can't drift.
- `config.ts` — `createAuth(db)` builds better-auth. Providers and methods are
  **conditionally enabled** from env vars; nothing crashes because a key is
  missing, and the `databaseHooks` auto-generate a username for OAuth sign-ups.
- `index.ts` — `getAuth()`, a lazy Node-global singleton (the Postgres client
  and auth are created on first use, so pages render before you ever configure
  a DB).
- `client.ts` — `authClient` for use from `"use client"` components.

Flow: `proxy.ts` guards routes by session cookie → pages/actions verify the
session auth.full. Capabilities are re-checked on the server, never trusted
from the client.

### Data layer

- `db/schema/auth.ts` — the better-auth tables (user, session, account,
  verification) as Drizzle `pgTable`s, plus custom user fields
  (`username`, `bio`, `location`, `portfolio`). Add new models in own files under
  `db/schema/` and export from `db/schema/index.ts`.
- `db/index.ts` — a cached `postgres` client + Drizzle instance.
- `drizzle.config.ts` — points drizzle-kit at the schema and `db/migrations/`.

### Server actions

Every action lives in `lib/actions/` and follows the same rhythm:

1. `action({ params, schema, authorize })` validates with zod and, when asked,
   resolves the session.
2. Business logic talks to the DB through `getDb()`.
3. Success and failure always return `{ success, data? }` / `{ success: false,
   error: { message, details? } }` (see `types/global.d.ts`).

`auth.action.ts` comes with `signUpWithCredentials`, `signInWithCredentials`,
`signOut`, and `getCurrentUser` — copy the shape for your own actions.

### Routing

- `(root)` — the app shell (navbar + footer). `/` is a landing page,
  `/dashboard` is the auth demo.
- `(auth)` — centered auth pages for `/sign-in` and `/sign-up`.
- `app/api/auth/[...all]/route.ts` — the better-auth handler.

## Tailoring the template

- **Don't need social auth?** Set `NEXT_PUBLIC_AUTH_SOCIAL_PROVIDERS=""` and
  leave the client secrets blank.
- **Don't need auth at all?** Remove `proxy.ts`, the `(auth)` group, the
  `lib/actions/auth.action.ts` exports you aren't using, the `components/forms/*`,
  and the `user`/`session`/`account`/`verification` rows in `db/schema/`. Keep
  `db/index.ts` and the action/error contract — they're auth-free.
- **Add a model:** new `pgTable` in `db/schema/`, export it, then
  `npm run db:generate && npm run db:migrate`.
- **Protect new routes:** extend the matcher in `proxy.ts`.
- **More UI bits:** `npx shadcn add button card input ...` (compatible with the
  base-nova kit already configured in `components.json`).

## Gotchas

1. **`.env` changes need a dev-server restart** — Next caches env at boot.
2. **Schema changes need migration steps** (`db:generate` + `db:migrate`);
   hot reload does not update Postgres.
3. The `user` table is owned by better-auth. App-level data should reference
   it by `userId` (`text`) rather than denormalizing the whole user.
4. Files are UTF-8/LF on this template (unlike the legacy repo it was lifted
   from — no CRLF surprises).