import type { Metadata, Viewport } from "next";
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

const savedTheme = async () => {
  const saved = (await cookies()).get("vig_theme")?.value;
  return saved === "light" || saved === "dark" ? saved : undefined;
};

// Declaring the scheme stops Android browsers (Samsung Internet, Chrome's forced
// dark) from repainting the page with their own dark colours.
export async function generateViewport(): Promise<Viewport> {
  const theme = await savedTheme();
  return {
    colorScheme: theme === "light" ? "only light" : theme === "dark" ? "dark" : "light dark",
    themeColor: theme
      ? theme === "light" ? "#fbfbf6" : "#133629"
      : [
          { media: "(prefers-color-scheme: light)", color: "#fbfbf6" },
          { media: "(prefers-color-scheme: dark)", color: "#133629" },
        ],
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = await savedTheme();
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
