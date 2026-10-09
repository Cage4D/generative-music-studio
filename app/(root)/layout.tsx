import Link from "next/link";

import Navbar from "@/components/navigation/navbar";
import ROUTES from "@/constants/routes";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="background-light850_dark100 flex min-h-screen flex-col">
      <Navbar />
      <section className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
        {children}
      </section>
      <footer className="border-t py-6">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6">
          <p className="small-regular text-dark500_light400">
            Next.js Template — build something good.
          </p>
          <div className="flex items-center gap-4">
            <Link href={ROUTES.SIGN_IN} className="small-medium text-dark400_light900 hover:underline">
              Sign in
            </Link>
            <Link href={ROUTES.DASHBOARD} className="small-medium text-dark400_light900 hover:underline">
              Dashboard
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}