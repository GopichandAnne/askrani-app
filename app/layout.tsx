import type { Metadata } from "next";
import { DM_Sans, Playfair_Display } from "next/font/google";
import "./globals.css";

// DM Sans — all UI / body / data
const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-dm-sans",
  display: "swap",
});

// Playfair Display (italic 800) — display / headings / key numbers (used with restraint)
const playfair = Playfair_Display({
  subsets: ["latin"],
  weight: ["800"],
  style: ["italic", "normal"],
  variable: "--font-playfair",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Ask Rani — Control Panel",
  description: "Staff & owner control panel for the Ask Rani AI shopping assistant.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${dmSans.variable} ${playfair.variable}`} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
