"use client";

import Image from "next/image";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import ROUTES from "@/constants/routes";
import { authClient } from "@/lib/auth/client";
import {
  SOCIAL_PROVIDERS,
  type SocialProvider,
} from "@/lib/auth/providers";

const providerMeta: Record<SocialProvider, { name: string; icon: string }> = {
  github: { name: "GitHub", icon: "/icons/github.svg" },
  google: { name: "Google", icon: "/icons/google.svg" },
};

export default function SocialAuthForm() {
  const handleSignIn = async (provider: SocialProvider) => {
    try {
      await authClient.signIn.social({
        provider,
        callbackURL: ROUTES.HOME,
      });
    } catch (err) {
      toast.warning(
        err instanceof Error ? err.message : "An error occurred during sign-in",
      );
    }
  };

  if (SOCIAL_PROVIDERS.length === 0) {
    return null;
  }

  return (
    <div className="flex w-full flex-col gap-2.5">
      {SOCIAL_PROVIDERS.map((provider) => {
        const meta = providerMeta[provider];
        return (
          <Button
            key={provider}
            type="button"
            variant="outline"
            className="h-11 w-full gap-3"
            onClick={() => handleSignIn(provider)}
          >
            <Image
              src={meta.icon}
              alt={`${meta.name} logo`}
              width={20}
              height={20}
              className="invert-colors object-contain"
            />
            Continue with {meta.name}
          </Button>
        );
      })}
    </div>
  );
}