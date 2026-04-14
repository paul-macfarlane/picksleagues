import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
const siteDescription =
  "NFL Pick'Em leagues with friends. Make weekly picks, climb the leaderboard.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "PicksLeagues",
    template: "%s | PicksLeagues",
  },
  description: siteDescription,
  applicationName: "PicksLeagues",
  openGraph: {
    type: "website",
    siteName: "PicksLeagues",
    title: "PicksLeagues",
    description: siteDescription,
  },
  twitter: {
    card: "summary_large_image",
    title: "PicksLeagues",
    description: siteDescription,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
