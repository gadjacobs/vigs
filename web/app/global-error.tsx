"use client";

// Last resort when the app shell itself fails: styled like Vig, no browser page.
export default function GlobalError({ error, retry, reset }: { error: Error & { digest?: string }; retry?: () => void; reset?: () => void }) {
  const again = retry ?? reset ?? (() => location.reload());
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100vh", background: "#0c2a20", color: "#eef3ea", fontFamily: "system-ui, sans-serif",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <main style={{ maxWidth: 420 }}>
          <p style={{ fontWeight: 800, fontSize: 32, margin: "0 0 8px", color: "#f6c945" }}>Vig</p>
          <h1 style={{ fontSize: 28, margin: "0 0 8px" }}>That didn&apos;t load</h1>
          <p style={{ color: "#a8bdb0", margin: "0 0 20px", lineHeight: 1.5 }}>
            Usually SportyBet or the data took too long to answer. Trying again normally works.
          </p>
          <div style={{ display: "flex", gap: 12 }}>
            <button type="button" onClick={() => again()} style={{ minHeight: 44, padding: "10px 18px", borderRadius: 3, border: 0,
              background: "#f6c945", color: "#0c2a20", fontWeight: 700, fontSize: 16 }}>Try again</button>
            <a href="/" style={{ minHeight: 44, padding: "10px 18px", borderRadius: 3, border: "1px solid #6f8f80", color: "#eef3ea",
              fontWeight: 700, textDecoration: "none", display: "inline-flex", alignItems: "center" }}>Home</a>
          </div>
          {error.digest && <p style={{ color: "#a8bdb0", fontSize: 13, marginTop: 20 }}>Reference {error.digest}</p>}
        </main>
      </body>
    </html>
  );
}
