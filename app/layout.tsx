import type { ReactNode } from "react";

export const metadata = {
  title: "embr-pulse",
  description: "Team feedback, managed by agents on Embr.",
};

// Runs before React hydrates to avoid a flash of wrong theme.
// Reads the persisted preference from localStorage; falls back to
// prefers-color-scheme on first visit; always writes data-theme on <html>.
const themeScript = [
  "(function(){",
  "try{",
  "var stored=localStorage.getItem('embr-pulse-theme');",
  "var preferred=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';",
  "document.documentElement.setAttribute('data-theme',stored||preferred);",
  "}catch(e){}",
  "})();",
].join("");

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <style>{`
          :root, [data-theme="dark"] {
            --color-bg: #0b0d10;
            --color-card: #11141a;
            --color-card-border: #2a2f36;
            --color-text: #e6e8eb;
            --color-muted: #8a93a0;
            --color-accent: #7aa2ff;
          }
          [data-theme="light"] {
            --color-bg: #f5f7fa;
            --color-card: #ffffff;
            --color-card-border: #dde1e7;
            --color-text: #1c2028;
            --color-muted: #5c6370;
            --color-accent: #2563eb;
          }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            margin: 0;
            background: var(--color-bg);
            color: var(--color-text);
            min-height: 100vh;
          }
        `}</style>
      </head>
      <body>
        <main style={{ maxWidth: 760, margin: "0 auto", padding: "2.5rem 1.25rem" }}>
          {children}
        </main>
      </body>
    </html>
  );
}
