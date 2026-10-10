"use client";
import Link from "next/link";
import { useEffect } from "react";

// Shown inside the app (header and tabs stay) when a page fails to load.
export default function PageError({ error, retry, reset }: { error: Error & { digest?: string }; retry?: () => void; reset?: () => void }) {
  useEffect(() => console.error(error), [error]);
  const again = retry ?? reset ?? (() => location.reload());
  return (
    <main className="oops">
      <h1>That didn&apos;t load</h1>
      <p className="lede">Usually SportyBet or the data took too long to answer. Trying again normally works.</p>
      <div className="row">
        <button className="primary" type="button" onClick={() => again()}>Try again</button>
        <Link className="button" href="/">Tonight</Link>
        <Link className="button" href="/codes">Codes</Link>
      </div>
      {error.digest && <p className="status">Reference {error.digest}</p>}
    </main>
  );
}
