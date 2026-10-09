<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This template uses Next.js 16, which has breaking changes — APIs, conventions,
and file structure may differ from older training data. Before writing Next.js
code, read the relevant guide in `node_modules/next/dist/docs/`. Heed
deprecation notices.

# Conventions

- Postgres + Drizzle. Tables live in `db/schema/`, re-exported from `db/schema/index.ts`.
  Never hand-edit generated migrations in `db/migrations/`.
- Auth is better-auth. Server-side code imports `getAuth()` from `@/auth`
  (never constructs a second instance). Client uses `authClient` from `@/lib/auth/client`.
- Server actions live in `lib/actions/`. Use the `action()` handler from
  `lib/handlers/action.ts` for zod validation + session authorization, and keep
  the `{ success, data? | error? }` response contract.
- Route protection: extend the matcher in `proxy.ts`.
- Errors: throw/return `RequestError` subclasses from `lib/http-errors.ts` and
  normalize with `handleError` in `lib/handlers/error.ts`.
- Log with `logger` from `lib/logger`, not `console.*`.
- UI: shadcn/base-ui primitives in `components/ui/`. Add more with `npx shadcn add`.
- Database schema changes: run `npm run db:generate && npm run db:migrate`,
  and remember `.env` changes need a dev-server restart.
<!-- END:nextjs-agent-rules -->