import Link from "next/link";

export default function NotFound() {
  return (
    <main className="oops">
      <h1>Nothing here</h1>
      <p className="lede">That page doesn&apos;t exist, or a slip has been recooked for a newer round.</p>
      <div className="row">
        <Link className="button primary" href="/">Tonight</Link>
        <Link className="button" href="/picks">Our picks</Link>
        <Link className="button" href="/codes">Codes</Link>
      </div>
    </main>
  );
}
