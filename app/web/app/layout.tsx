import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const manrope = localFont({
  src: "./fonts/Manrope-latin.woff2",
  variable: "--font-manrope",
  weight: "200 800",
  display: "swap",
});

const jetbrainsMono = localFont({
  src: "./fonts/JetBrainsMono-latin.woff2",
  variable: "--font-jetbrains-mono",
  weight: "100 800",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  ),
  title: "Generative Music Studio",
  description:
    "Deterministic procedural music. Same settings, same seed, same music.",
  openGraph: {
    type: "website",
    siteName: "Generative Music Studio",
    title: "Generative Music Studio",
    description:
      "Deterministic procedural music. Same settings, same seed, same music.",
  },
  twitter: {
    card: "summary",
    title: "Generative Music Studio",
    description:
      "Deterministic procedural music. Same settings, same seed, same music.",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${manrope.variable} ${jetbrainsMono.variable}`}
    >
      <body>
        <a className="skip" href="#main">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
