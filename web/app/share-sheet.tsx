"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getShare } from "./share-actions";
import { instagram, plain, statusCaption, whatsapp, xPost, type ShareData } from "@/lib/sharetext";

const SHORT: Record<string, string> = { won: "w", lost: "l", playing: "p", waiting: "x", unknown: "u" };

/** What this device already knows about a code, for when SportyBet no longer returns it. */
export function snapOf(d: ShareData): string {
  const s = JSON.stringify({ s: d.state, o: d.odds, c: d.chance, l: d.legs.map((l) => [SHORT[l.status] ?? "x", Math.round(l.kickoff / 60000)]) });
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A Share button that opens a bottom sheet: card preview, then one tap per app. */
export function ShareButton({ code, className = "", fallback }: { code: string; className?: string; fallback?: ShareData }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>Share</button>
      {/* In a portal: inside a card or a button row the sheet would inherit their layout. */}
      {open && createPortal(<ShareSheet code={code} fallback={fallback} onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

const imageUrl = (code: string, story: boolean, snap?: string) =>
  `/api/share/${code}?${new URLSearchParams({ ...(story ? { f: "story" } : {}), ...(snap ? { s: snap } : {}) })}`;

async function imageFile(code: string, story: boolean, snap?: string) {
  const res = await fetch(imageUrl(code, story, snap));
  if (!res.ok) throw new Error("image");
  return new File([await res.blob()], `vig-${code}${story ? "-story" : ""}.png`, { type: "image/png" });
}

function download(f: File) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(f);
  a.download = f.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export function ShareSheet({ code, onClose, fallback }: { code: string; onClose: () => void; fallback?: ShareData }) {
  const first = useRef({ fallback, onClose });
  const [d, setD] = useState<ShareData | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    // Read once per open: the parent re-renders every few seconds while legs play.
    const fb = first.current.fallback;
    getShare(code).then((x) => setD(x ?? fb ?? null)).catch(() => fb ? setD(fb) : setMsg("Could not load this code."));
    const esc = (e: KeyboardEvent) => e.key === "Escape" && first.current.onClose();
    addEventListener("keydown", esc);
    document.body.style.overflow = "hidden";
    return () => { removeEventListener("keydown", esc); document.body.style.overflow = ""; };
  }, [code]);
  const [snap] = useState(() => (fallback ? snapOf(fallback) : undefined));

  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); setMsg(`${what} copied.`); } catch { setMsg("Copy did not work on this browser."); }
  };
  /** Share an image (and text) through the phone's share sheet; download where that is not possible. */
  const shareImage = async (story: boolean, text: string, note: string) => {
    setBusy(true);
    try {
      const f = await imageFile(code, story, snap);
      if (navigator.canShare?.({ files: [f] })) await navigator.share({ files: [f], text });
      else { download(f); await copy(text, "Caption"); }
      setMsg(note);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setMsg("Could not share the image here; use Save image.");
    } finally { setBusy(false); }
  };
  const open = (url: string) => window.open(url, "_blank", "noopener");

  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="share-title" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" aria-hidden="true" />
        <div className="sheet-head">
          <h2 id="share-title">Share {code}</h2>
          <button type="button" className="x" onClick={onClose} aria-label="Close">×</button>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="sheet-preview" src={imageUrl(code, false, snap)} alt={`Share card for code ${code}`} />
        {!d ? <p className="status">{msg || "Preparing…"}</p> : (
          <div className="sheet-grid">
            <button type="button" className="primary span2" disabled={busy} onClick={() => shareImage(false, plain(d), "Shared.")}>Share image…</button>
            <button type="button" onClick={() => open(`https://wa.me/?text=${encodeURIComponent(whatsapp(d))}`)}>WhatsApp message</button>
            <button type="button" disabled={busy} onClick={() => shareImage(true, statusCaption(d), "Pick WhatsApp, then My status.")}>WhatsApp status</button>
            <button type="button" onClick={() => open(`https://x.com/intent/post?text=${encodeURIComponent(xPost(d))}`)}>Post on X</button>
            <button type="button" onClick={async () => { await copy(plain(d), "Message"); open("https://x.com/messages"); }}>X message</button>
            <button type="button" disabled={busy} onClick={() => shareImage(true, instagram(d), "Pick Instagram; the caption is copied too.")}>Instagram</button>
            <button type="button" disabled={busy} onClick={async () => {
              // The clipboard takes a promise of the image, so the copy still counts as part of the tap.
              setBusy(true);
              try {
                const blob = imageFile(code, false, snap).then((f) => f as Blob);
                await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
                setMsg("Image copied. Paste it in any chat.");
              } catch { setMsg("This browser can't copy images; use Save image."); } finally { setBusy(false); }
            }}>Copy image</button>
            <button type="button" onClick={() => copy(plain(d), "Text")}>Copy text</button>
            <button type="button" disabled={busy} onClick={async () => { setBusy(true); try { download(await imageFile(code, false, snap)); setMsg("Image saved."); } catch { setMsg("Could not save the image."); } finally { setBusy(false); } }}>Save image</button>
          </div>
        )}
        <p className="status" role="status" aria-live="polite">{d ? msg : ""}</p>
        <p className="hint">X posts open with the text; attach the saved image if you want it. Instagram takes the story image from the share sheet.</p>
      </div>
    </div>
  );
}
