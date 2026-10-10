"use client";
import { useEffect, useState } from "react";
import { getShare } from "./share-actions";
import { instagram, plain, statusCaption, whatsapp, xPost, type ShareData } from "@/lib/sharetext";

/** A Share button that opens a bottom sheet: card preview, then one tap per app. */
export function ShareButton({ code, className = "" }: { code: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>Share</button>
      {open && <ShareSheet code={code} onClose={() => setOpen(false)} />}
    </>
  );
}

async function imageFile(code: string, story: boolean) {
  const res = await fetch(`/api/share/${code}${story ? "?f=story" : ""}`);
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

function ShareSheet({ code, onClose }: { code: string; onClose: () => void }) {
  const [d, setD] = useState<ShareData | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    getShare(code).then(setD).catch(() => setMsg("Could not load this code."));
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", esc);
    document.body.style.overflow = "hidden";
    return () => { removeEventListener("keydown", esc); document.body.style.overflow = ""; };
  }, [code, onClose]);

  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); setMsg(`${what} copied.`); } catch { setMsg("Copy did not work on this browser."); }
  };
  /** Share an image (and text) through the phone's share sheet; download where that is not possible. */
  const shareImage = async (story: boolean, text: string, note: string) => {
    setBusy(true);
    try {
      const f = await imageFile(code, story);
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
        <img className="sheet-preview" src={`/api/share/${code}`} alt={`Share card for code ${code}`} />
        {!d ? <p className="status">{msg || "Preparing…"}</p> : (
          <div className="sheet-grid">
            <button type="button" disabled={busy} onClick={() => shareImage(false, plain(d), "Shared.")}>Share image…</button>
            <button type="button" onClick={() => open(`https://wa.me/?text=${encodeURIComponent(whatsapp(d))}`)}>WhatsApp message</button>
            <button type="button" disabled={busy} onClick={() => shareImage(true, statusCaption(d), "Pick WhatsApp, then My status.")}>WhatsApp status</button>
            <button type="button" onClick={() => open(`https://x.com/intent/post?text=${encodeURIComponent(xPost(d))}`)}>Post on X</button>
            <button type="button" onClick={async () => { await copy(plain(d), "Message"); open("https://x.com/messages"); }}>X message</button>
            <button type="button" disabled={busy} onClick={() => shareImage(true, instagram(d), "Pick Instagram; the caption is copied too.")}>Instagram</button>
            <button type="button" onClick={() => copy(plain(d), "Text")}>Copy text</button>
            <button type="button" disabled={busy} onClick={async () => { setBusy(true); try { download(await imageFile(code, false)); setMsg("Image saved."); } catch { setMsg("Could not save the image."); } finally { setBusy(false); } }}>Save image</button>
          </div>
        )}
        <p className="status" role="status" aria-live="polite">{d ? msg : ""}</p>
        <p className="hint">X posts open with the text; attach the saved image if you want it. Instagram takes the story image from the share sheet.</p>
      </div>
    </div>
  );
}
