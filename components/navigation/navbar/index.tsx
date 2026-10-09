import { Zap } from "lucide-react";
import Link from "next/link";
import { headers } from "next/headers";
import { getSessionCookie } from "better-auth/cookies";

import { Button } from "@/components/ui/button";
import ROUTES from "@/constants/routes";
import type { User } from "@/auth";
import { getCurrentUser } from "@/lib/actions/auth.action";

import ThemeToggle from "./ThemeToggle";
import UserDropdown from "./UserDropdown";

export default async function Navbar() {
  // Cheap cookie-only check first: anonymous visitors skip the DB call.
  const sessionCookie = getSessionCookie(await headers());

  let user: User | null = null;
  if (sessionCookie) {
    const result = await getCurrentUser();
    if (result.success && result.data) {
      user = result.data;
    }
  }

  return (
    <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur">
      <nav className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-6">
        <Link
          href={ROUTES.HOME}
          className="flex items-center gap-2 text-sm font-semibold tracking-tight"
        >
          <Zap className="primary-text-gradient size-5" />
          Next.js Template
        </Link>

        <div className="flex items-center gap-2">
          {user ? (
            <>
              <Button
                variant="ghost"
                render={<Link href={ROUTES.DASHBOARD} />}
                nativeButton={false}
              >
                Dashboard
              </Button>
              <UserDropdown user={user} />
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                render={<Link href={ROUTES.SIGN_IN} />}
                nativeButton={false}
              >
                Sign in
              </Button>
              <Button
                className="primary-gradient text-light-900!"
                render={<Link href={ROUTES.SIGN_UP} />}
                nativeButton={false}
              >
                Get started
              </Button>
            </>
          )}
          <ThemeToggle />
        </div>
      </nav>
    </header>
  );
}