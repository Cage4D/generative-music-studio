"use client";

import * as React from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import {
  Controller,
  useForm,
  type DefaultValues,
  type FieldValues,
  type Path,
  type SubmitHandler,
} from "react-hook-form";
import { toast } from "sonner";
import type { ZodType } from "zod";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import ROUTES from "@/constants/routes";

interface AuthFormProps<T extends FieldValues> {
  schema: ZodType<T, T>;
  defaultValues: T;
  onSubmit: (data: T) => Promise<{
    success: boolean;
    error?: { message: string };
  }>;
  formType: "SIGN_IN" | "SIGN_UP";
}

export default function AuthForm<T extends FieldValues>({
  schema,
  defaultValues,
  formType,
  onSubmit,
}: AuthFormProps<T>) {
  const form = useForm<T>({
    resolver: zodResolver(schema),
    defaultValues: defaultValues as DefaultValues<T>,
  });

  const isSignIn = formType === "SIGN_IN";

  const handleFormSubmit: SubmitHandler<T> = async (data) => {
    const result = await onSubmit(data);

    if (result.success) {
      toast.success(isSignIn ? "Signed in successfully." : "Account created successfully.");
    } else {
      toast.error(result.error?.message ?? "Something went wrong. Please try again.");
    }
  };

  return (
    <Card className="border-none bg-transparent shadow-none">
      <CardHeader className="px-0">
        <CardTitle>{isSignIn ? "Welcome back" : "Create an account"}</CardTitle>
        <CardDescription>
          {isSignIn
            ? "Sign in to your account to continue."
            : "Fill in your details to get started."}
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        <form id="auth-form" onSubmit={form.handleSubmit(handleFormSubmit)}>
          <FieldGroup>
            {Object.keys(defaultValues).map((fieldName) => (
              <Controller
                key={fieldName}
                name={fieldName as Path<T>}
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor={fieldName} className="capitalize">
                      {fieldName === "email" ? "Email address" : fieldName}
                    </FieldLabel>
                    <Input
                      {...field}
                      id={fieldName}
                      type={fieldName.toLowerCase().includes("password") ? "password" : "text"}
                      aria-invalid={fieldState.invalid}
                      autoComplete="off"
                    />
                    {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                  </Field>
                )}
              />
            ))}
          </FieldGroup>
        </form>
      </CardContent>
      <CardFooter className="flex-col gap-4 px-0">
        <Button
          type="submit"
          form="auth-form"
          className="primary-gradient min-h-12 w-full"
          disabled={form.formState.isSubmitting}
        >
          {form.formState.isSubmitting
            ? isSignIn
              ? "Signing in..."
              : "Signing up..."
            : isSignIn
              ? "Sign in"
              : "Sign up"}
        </Button>
        {isSignIn ? (
          <p className="body-regular text-dark500_light400">
            Don&apos;t have an account?{" "}
            <Link href={ROUTES.SIGN_UP} className="primary-text-gradient paragraph-semibold">
              Sign up
            </Link>
          </p>
        ) : (
          <p className="body-regular text-dark500_light400">
            Already have an account?{" "}
            <Link href={ROUTES.SIGN_IN} className="primary-text-gradient paragraph-semibold">
              Sign in
            </Link>
          </p>
        )}
      </CardFooter>
    </Card>
  );
}