import type { Metadata } from "next";
import { Atkinson_Hyperlegible_Next, Big_Shoulders } from "next/font/google";
import { cookies } from "next/headers";
import { Nav } from "./nav";
import { ThemeToggle } from "./theme-toggle";
import "./globals.css";

const text = Atkinson_Hyperlegible_Next({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-text" });
const num = Big_Shoulders({ subsets: ["latin"], weight: ["700", "800"], variable: "--font-num" });

export const metadata: Metadata = {
  title: "Vig",
  description: "History-backed vFootball selections. Personal tool, 18+.",
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const saved = (await cookies()).get("vig_theme")?.value;
  const theme = saved === "light" || saved === "dark" ? saved : undefined;
  return (
    <html lang="en" className={`${text.variable} ${num.variable}`} data-theme={theme}>
      <body>
        <header className="topbar">
          <a className="wordmark" href="/">Vig</a>
          <Nav />
          <ThemeToggle initial={theme ?? "system"} />
        </header>
        {children}
      </body>
    </html>
  );
}
