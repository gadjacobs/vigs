// Shown instantly while a page's data (odds, model, record) loads.
export default function Loading() {
  return (
    <main aria-busy="true" aria-live="polite">
      <p className="sr-only">Loading…</p>
      <div className="skel skel-title" />
      <div className="skel skel-line" />
      <div className="skel skel-line short" />
      <div className="skel skel-panel" />
      {[0, 1, 2].map((i) => <div key={i} className="skel skel-card" />)}
    </main>
  );
}
