import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import type { BetterAuthOptions } from "better-auth";
import slugify from "slugify";

import type { Database } from "@/db";
import * as schema from "@/db/schema";
import { isSocialProviderEnabled } from "./providers";

export function getBaseUrl(): string {
  if (process.env.BETTER_AUTH_URL) return process.env.BETTER_AUTH_URL;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return "http://localhost:3000";
}

/**
 * Builds the better-auth instance for the given Drizzle database.
 *
 * Everything is driven by environment variables so the template works
 * out of the box:
 *  - email/password auth is on unless `AUTH_EMAIL_PASSWORD="false"`
 *  - a social provider is only enabled when it's listed in
 *    `NEXT_PUBLIC_AUTH_SOCIAL_PROVIDERS` AND its client id/secret are set
 */
export function createAuth(db: Database) {
  const socialProviders: NonNullable<BetterAuthOptions["socialProviders"]> = {};

  if (
    isSocialProviderEnabled("github") &&
    process.env.GITHUB_CLIENT_ID &&
    process.env.GITHUB_CLIENT_SECRET
  ) {
    socialProviders.github = {
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
    };
  }

  if (
    isSocialProviderEnabled("google") &&
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET
  ) {
    socialProviders.google = {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    };
  }

  return betterAuth({
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: getBaseUrl(),
    database: drizzleAdapter(db, {
      provider: "pg",
      schema,
    }),
    emailAndPassword: {
      enabled: process.env.AUTH_EMAIL_PASSWORD !== "false",
    },
    socialProviders,
    user: {
      additionalFields: {
        username: { type: "string", required: false, unique: true },
        bio: { type: "string", required: false },
        location: { type: "string", required: false },
        portfolio: { type: "string", required: false },
      },
    },
    databaseHooks: {
      user: {
        create: {
          // Give social sign-ups (and anyone missing one) a username.
          before: async (user) => {
            if (user.username) {
              return { data: user };
            }
            const base = slugify(user.name || user.email.split("@")[0], {
              lower: true,
              strict: true,
            });
            return {
              data: {
                ...user,
                username: `${base}-${Math.floor(1000 + Math.random() * 9000)}`,
              },
            };
          },
        },
      },
    },
    plugins: [nextCookies()],
  });
}