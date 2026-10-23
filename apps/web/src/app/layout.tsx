import "~/styles/globals.css";

import { type Metadata } from "next";
import { Inter } from "next/font/google";
import { Providers } from "~/lib/trpc";

export const metadata: Metadata = {
  title: "Showtimes",
  description: "Theater schedule console with AI-reviewed partner imports.",
  icons: [{ rel: "icon", url: "/favicon.ico" }],
};

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-dvh font-sans text-[14px] leading-[1.5]">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
