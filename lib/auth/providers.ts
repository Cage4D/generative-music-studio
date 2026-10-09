export type SocialProvider = "github" | "google";

/**
 * Which social providers the app exposes. Comma-separated list, read on both
 * client and server so the sign-in UI and the better-auth config stay in sync.
 *
 * Defaults to "github,google". Set to "" (empty) if you want email/password
 * only, and to anything else you enable in auth.config.ts later.
 */
export const SOCIAL_PROVIDERS: SocialProvider[] = (
  process.env.NEXT_PUBLIC_AUTH_SOCIAL_PROVIDERS ?? "github,google"
)
  .split(",")
  .map((provider) => provider.trim())
  .filter((provider): provider is SocialProvider =>
    provider === "github" || provider === "google"
  );

export function isSocialProviderEnabled(provider: SocialProvider): boolean {
  return SOCIAL_PROVIDERS.includes(provider);
}