import { Separator } from "@/components/ui/separator";
import SocialAuthForm from "@/components/forms/SocialAuthForm";
import { SOCIAL_PROVIDERS } from "@/lib/auth/providers";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="background-light850_dark100 flex min-h-screen items-center justify-center px-4 py-10">
      <section className="light-border background-light900_dark200 shadow-light100_dark100 w-full rounded-xl border px-4 py-10 shadow-md sm:max-w-md sm:px-8">
        <div className="space-y-2">
          <h1 className="h2-bold text-dark100_light900">Welcome</h1>
          <p className="paragraph-regular text-dark500_light400">
            Sign in or create an account to continue.
          </p>
        </div>

        <div className="mt-6">{children}</div>

        {SOCIAL_PROVIDERS.length > 0 && (
          <div className="mt-8 space-y-4">
            <Separator />
            <SocialAuthForm />
          </div>
        )}
      </section>
    </main>
  );
}