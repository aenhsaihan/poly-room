import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import UserProvider from "./components/UserProvider";
import Nav from "./components/Nav";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Poly Trader",
  description: "Paper trading on Polymarket predictions",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full`}>
      <body className="min-h-full bg-zinc-950 text-white antialiased">
        <UserProvider>
          <Nav />
          {children}
        </UserProvider>
      </body>
    </html>
  );
}
