"use client";
import { useState } from "react";
import { login } from "../actions";

export function LoginPanel({ google, passwords }: { google: boolean; passwords: boolean }) {
  const [adult, setAdult] = useState(false);
  const [usePassword, setUsePassword] = useState(!google);
  return (
    <div className="login-panel">
      <label className="login-adult">
        <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} />
        <span>I am 18 or older</span>
      </label>
      {google && (
        <a className={`button google-btn ${adult ? "" : "is-off"}`} href={adult ? "/api/auth/google?adult=on" : undefined}
          aria-disabled={!adult} onClick={(e) => { if (!adult) e.preventDefault(); }}>
          <svg viewBox="0 0 48 48" width="22" height="22" aria-hidden="true">
            <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/>
            <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
            <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/>
            <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/>
          </svg>
          Continue with Google
        </a>
      )}
      {passwords && google && !usePassword && (
        <button type="button" className="linkish" onClick={() => setUsePassword(true)}>Use a password instead</button>
      )}
      {passwords && usePassword && (
        <form action={login} className="login-password">
          <input type="hidden" name="adult" value={adult ? "on" : ""} />
          <label className="field" htmlFor="password">
            <span>Password</span>
            <input id="password" name="password" type="password" autoComplete="current-password" required />
          </label>
          <button className={google ? "" : "primary"} type="submit" disabled={!adult}>Sign in</button>
        </form>
      )}
      {!adult && <p className="hint">Tick the box to continue.</p>}
    </div>
  );
}
