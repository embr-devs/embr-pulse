import type { ReactNode } from "react";

export const metadata = {
  title: "embr-pulse",
  description: "Team feedback, managed by agents on Embr.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          margin: 0,
          background: "#0b0d10",
          color: "#e6e8eb",
          minHeight: "100vh",
        }}
      >
        <main style={{ maxWidth: 760, margin: "0 auto", padding: "2.5rem 1.25rem" }}>
          {children}
        </main>
      </body>
    </html>
  );
}
