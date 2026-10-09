import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { Toaster } from "sonner";

import ThemeProvider from "@/context/Theme";
import { cn } from "@/lib/utils";

import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: {
    default: "Next.js Template",
    template: "%s | Next.js Template",
  },
  description:
    "A production-ready Next.js starter with Drizzle, PostgreSQL, better-auth, Tailwind CSS and a shadcn/base-ui component kit.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={cn("h-full antialiased font-sans", geist.variable)}
      suppressHydrationWarning
    >
      <body className="min-h-full">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
        <Toaster />
      </body>
    </html>
  );
}