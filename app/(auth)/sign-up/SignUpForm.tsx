"use client";

import { useRouter } from "next/navigation";

import AuthForm from "@/components/forms/AuthForm";
import ROUTES from "@/constants/routes";
import { signUpWithCredentials } from "@/lib/actions/auth.action";
import { SignUpSchema } from "@/lib/validations";

export default function SignUpForm() {
  const router = useRouter();

  return (
    <AuthForm
      formType="SIGN_UP"
      schema={SignUpSchema}
      defaultValues={{ username: "", name: "", email: "", password: "" }}
      onSubmit={async (data) => {
        const result = await signUpWithCredentials(data);
        if (result.success) {
          router.push(ROUTES.HOME);
          router.refresh();
        }
        return result;
      }}
    />
  );
}