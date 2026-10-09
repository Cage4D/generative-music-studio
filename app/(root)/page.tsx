import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import ROUTES from "@/constants/routes";

const features = [
  {
    title: "better-auth",
    description:
      "Email/password + social sign-in wired to PostgreSQL via Drizzle, with session-aware routes and server actions.",
  },
  {
    title: "Drizzle + Postgres",
    description:
      "Type-safe schema in db/schema, migrations via drizzle-kit, and a cached Postgres client that connects on first query.",
  },
  {
    title: "Server action pattern",
    description:
      "Validate with zod, authorize against the session, then talk to your data - all in one consistent shape.",
  },
  {
    title: "shadcn/base-ui kit",
    description:
      "Type-safe primitives (Button, Card, Field, Dropdown, ...) styled with Tailwind CSS v4 and ready to extend.",
  },
  {
    title: "Themeable",
    description:
      "Light/dark/system via next-themes, custom utilities in globals.css, Toaster out of the box.",
  },
  {
    title: "Logger + error contract",
    description:
      "pino logging and a shared { success, error } response shape across server actions and APIs.",
  },
];

export default function Home() {
  return (
    <>
      <section className="flex flex-col items-start gap-6 py-10">
        <Badge variant="secondary">Next.js 16 · Drizzle · better-auth</Badge>
        <h1 className="h1-bold text-dark100_light900 max-w-2xl">
          Ship your next idea from a solid base.
        </h1>
        <p className="paragraph-regular text-dark500_light700 max-w-2xl">
          This template already wires up authentication, a PostgreSQL data layer,
          a consistent server-action contract, and a component kit - so you can
          jump straight to the part that makes your project unique.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            className="primary-gradient min-h-11.5 rounded-2 px-5 py-3 text-light-900!"
            render={<Link href={ROUTES.SIGN_UP} />}
            nativeButton={false}
          >
            Get started
          </Button>
          <Button
            variant="outline"
            className="min-h-11.5 rounded-2 px-5 py-3"
            render={<Link href={ROUTES.SIGN_IN} />}
            nativeButton={false}
          >
            Sign in
          </Button>
        </div>
      </section>

      <section className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((feature) => (
          <div
            key={feature.title}
            className="light-border background-light900_dark200 shadow-light100_dark100 rounded-xl border p-5"
          >
            <h3 className="base-semibold text-dark200_light900">{feature.title}</h3>
            <p className="body-regular text-dark500_light700 mt-2">
              {feature.description}
            </p>
          </div>
        ))}
      </section>
    </>
  );
}