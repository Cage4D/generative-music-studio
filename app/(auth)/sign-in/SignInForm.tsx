"use client";

import { useRouter, useSearchParams } from "next/navigation";

import AuthForm from "@/components/forms/AuthForm";
import ROUTES from "@/constants/routes";
import { signInWithCredentials } from "@/lib/actions/auth.action";
import { SignInSchema } from "@/lib/validations";

export default function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? ROUTES.HOME;

  return (
    <AuthForm
      formType="SIGN_IN"
      schema={SignInSchema}
      defaultValues={{ email: "", password: "" }}
      onSubmit={async (data) => {
        const result = await signInWithCredentials(data);
        if (result.success) {
          router.push(callbackUrl);
          router.refresh();
        }
        return result;
      }}
    />
  );
}