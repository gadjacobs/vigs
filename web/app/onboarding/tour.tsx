"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { finishOnboarding } from "../profile-actions";
import { keyBytes } from "../alerts/alerts-panel";
import { subscribePush } from "../push-actions";
import { SHOTS, TOUR, type TourSlide } from "@/lib/tour";
import type { View } from "@/lib/view";

const STAKES = [200, 500, 1000, 2000, 5000];
// The bubble on each screen, and whether a finger shows the tap (only on things you press).
const TIPS: Record<TourSlide["id"], [string, boolean]> = {
  tonight: ["Build slip", true], picks: ["Copy this code", true], codes: ["Chance it lands", false],
  bell: ["Alerts for this code", false], record: ["Every result", false],
};
type Step = "hello" | "view" | "stake" | TourSlide["id"] | "alerts" | "done";
const STEPS: Step[] = ["hello", "view", "stake", ...TOUR.map((t) => t.id), "alerts", "done"];
type Push = "idle" | "working" | "on" | "denied" | "ios-install" | "unsupported" | "error";

export function Onboarding({ name, view: v0, stake: s0, vapidKey, home }:
  { name: string; view: View; stake: number; vapidKey: string | null; home: string }) {
  const router = useRouter();
  const [i, setI] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const [view, setView] = useState<View>(v0);
  const [stake, setStake] = useState(s0);
  const [push, setPush] = useState<Push>("idle");
  const [leaving, start] = useTransition();
  const touch = useRef<number | null>(null);
  const step = STEPS[i];
  const last = STEPS.length - 1;

  const go = (n: number) => {
    const to = Math.max(0, Math.min(last, n));
    if (to === i) return;
    setDir(to > i ? 1 : -1);
    setI(to);
  };
  const finish = () => start(async () => {
    document.cookie = `vig_view=${view}; path=/; max-age=31536000; samesite=lax`;
    document.cookie = "vig_onb=1; path=/; max-age=31536000; samesite=lax";
    await finishOnboarding({ view, stake }).catch(() => false);
    router.replace(home);
    router.refresh();
  });

  useEffect(() => {
    // Warm the screens so each slide appears at once.
    for (const t of TOUR) { const im = new Image(); im.src = SHOTS[t.id].src; }
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(i + 1);
      else if (e.key === "ArrowLeft") go(i - 1);
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  });

  const enablePush = async () => {
    if (!vapidKey) return setPush("unsupported");
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const standalone = matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone;
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window))
      return setPush(ios && !standalone ? "ios-install" : "unsupported");
    setPush("working");
    try {
      await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
      if ((await Notification.requestPermission()) !== "granted") return setPush("denied");
      const reg = await navigator.serviceWorker.ready;
      const s = (await reg.pushManager.getSubscription())
        ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(vapidKey) });
      const res = await subscribePush(s.toJSON() as never, { results: true, swings: true, codeDefault: "default", tips: [] });
      setPush(res.ok ? "on" : "error");
    } catch {
      setPush("error");
    }
  };

  const slide = TOUR.find((t) => t.id === step);
  const nextLabel = step === "hello" ? "Show me" : step === "alerts" ? (push === "on" ? "Next" : "Maybe later") : "Next";

  return (
    <div className="onb" role="dialog" aria-modal="true" aria-labelledby="onb-title"
      onTouchStart={(e) => { touch.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => {
        if (touch.current === null) return;
        const dx = e.changedTouches[0].clientX - touch.current;
        touch.current = null;
        if (Math.abs(dx) > 60 && step !== "done") go(i + (dx < 0 ? 1 : -1));
      }}>
      <header className="onb-top">
        <ol className="onb-progress" aria-label={`Step ${i + 1} of ${STEPS.length}`}>
          {STEPS.map((s, k) => <li key={s} className={k < i ? "done" : k === i ? "now" : ""} />)}
        </ol>
        {step !== "done" && <button type="button" className="onb-skip" onClick={finish} disabled={leaving}>Skip</button>}
      </header>

      <section key={step} className={`onb-step ${dir > 0 ? "fwd" : "back"}`} aria-live="polite">
        {step === "hello" && (
          <div className="onb-hello">
            <span className="onb-mark" aria-hidden="true">V</span>
            <h1 id="onb-title">{name ? `Hi ${name}.` : "Welcome to Vig."}</h1>
            <p className="onb-lead">Vig checks each vFootball pick against a year of real results, so you see the chance it lands before you stake.</p>
            <ul className="onb-points">
              <li><b>Chance first.</b> Every leg and every slip shows how often it lands.</li>
              <li><b>Live.</b> Follow your codes as they play.</li>
              <li><b>Honest.</b> Every pick is logged, wins and losses.</li>
            </ul>
            <p className="onb-fine">About a minute. You can change everything later in Settings.</p>
          </div>
        )}

        {step === "view" && (
          <div>
            <h1 id="onb-title">How much detail?</h1>
            <p className="onb-lead">Most people only need the chance. Pick Rich if you want the bookmaker&apos;s side too.</p>
            <div className="viewpick onb-viewpick" role="radiogroup" aria-label="How much detail">
              <button type="button" role="radio" aria-checked={view === "simple"} onClick={() => setView("simple")}>
                <span className="vp-mock" aria-hidden="true"><b className="num">76%</b><i>chance</i><em className="num">1.28</em></span>
                <strong>Simple</strong>
                <small>The chance, the odds and what it pays.</small>
              </button>
              <button type="button" role="radio" aria-checked={view === "detailed"} onClick={() => setView("detailed")}>
                <span className="vp-mock rich" aria-hidden="true">
                  <b className="num">76%</b><i>range 71–80</i><em className="num">1.28</em>
                  <span className="vp-bar"><span /><i /></span>
                </span>
                <strong>Rich</strong>
                <small>Adds break-even, the bookmaker&apos;s chance, range, edge and grade.</small>
              </button>
            </div>
          </div>
        )}

        {step === "stake" && (
          <div>
            <h1 id="onb-title">Your usual stake</h1>
            <p className="onb-lead">Slips show what this returns if every leg lands. It is only for the maths; Vig never places bets.</p>
            <div className="stakepick onb-stake" role="group" aria-label="Usual stake">
              {STAKES.map((x) => (
                <button key={x} type="button" aria-pressed={stake === x} onClick={() => setStake(x)}>₦{x.toLocaleString("en-NG")}</button>
              ))}
            </div>
            <p className="onb-example">
              A slip at odds <b className="num">5.00</b> pays <b className="num">₦{(stake * 5).toLocaleString("en-NG")}</b> if it lands.
            </p>
          </div>
        )}

        {slide && <TourStep slide={slide} />}

        {step === "alerts" && (
          <div>
            <h1 id="onb-title">Know when it lands</h1>
            <p className="onb-lead">Get a notification when a code you follow wins or loses, and for big moments while it plays. Each code&apos;s bell changes this.</p>
            <div className="onb-bell" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="56" height="56" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 16V11a6 6 0 1112 0v5l2 2H4zM10 20a2 2 0 004 0" />
              </svg>
            </div>
            {push === "on" ? <p className="onb-ok" role="status">Notifications are on for this device.</p> : (
              <button type="button" className="primary onb-cta" onClick={enablePush} disabled={push === "working"}>
                {push === "working" ? "Asking your browser…" : "Turn on notifications"}
              </button>
            )}
            {push === "denied" && <p className="note">Notifications are blocked for this site. Allow them in your browser&apos;s site settings, then try again from Settings.</p>}
            {push === "ios-install" && <p className="note">On iPhone, add Vig to your Home Screen first (Share, then Add to Home Screen), open it from there and turn notifications on in Settings.</p>}
            {push === "unsupported" && <p className="note">This browser can&apos;t receive notifications. Chrome on Android or Vig on an iPhone Home Screen can.</p>}
            {push === "error" && <p className="note">That didn&apos;t work this time. You can try again from Settings.</p>}
          </div>
        )}

        {step === "done" && (
          <div className="onb-hello">
            <svg className="onb-check" viewBox="0 0 52 52" width="88" height="88" aria-hidden="true">
              <circle cx="26" cy="26" r="24" fill="none" />
              <path d="M15 27l7 7 15-16" fill="none" />
            </svg>
            <h1 id="onb-title">You&apos;re set</h1>
            <p className="onb-lead">
              {view === "simple" ? "Simple view" : "Rich view"}, ₦{stake.toLocaleString("en-NG")} stake
              {push === "on" ? ", notifications on" : ""}. Play within your means: virtual matches run every few minutes, all day.
            </p>
            <button type="button" className="primary onb-cta" onClick={finish} disabled={leaving}>{leaving ? "Opening…" : "Open Vig"}</button>
          </div>
        )}
      </section>

      {step !== "done" && (
        <footer className="onb-foot">
          {i > 0 && <button type="button" className="onb-back" onClick={() => go(i - 1)}>Back</button>}
          <button type="button" className="primary" onClick={() => go(i + 1)}>{nextLabel}</button>
        </footer>
      )}
    </div>
  );
}

/** One real screen, dimmed except for the spot it points at. */
function TourStep({ slide }: { slide: TourSlide }) {
  const s = SHOTS[slide.id];
  const b = s.spot;
  const [tip, tap] = TIPS[slide.id];
  const below = b.y + b.h / 2 < 55; // put the bubble on the roomier side
  return (
    <div className="onb-tour">
      <p className="onb-tab">{slide.tab}</p>
      <h1 id="onb-title">{slide.title}</h1>
      <figure className="onb-phone" style={{ aspectRatio: `${s.w} / ${s.h}` }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={s.src} alt={`The ${slide.tab} screen`} width={s.w} height={s.h} />
        <span className="onb-spot" style={{ left: `${b.x}%`, top: `${b.y}%`, width: `${b.w}%`, height: `${b.h}%` }} />
        {tap && <span className="onb-tap" style={{ left: `${b.x + b.w / 2}%`, top: `${b.y + b.h / 2}%` }} aria-hidden="true" />}
        <span className={`onb-bubble ${below ? "below" : "above"}`} aria-hidden="true"
          style={{ left: `${Math.min(70, Math.max(30, b.x + b.w / 2))}%`, top: `${below ? b.y + b.h : b.y}%` }}>
          {tip}
        </span>
      </figure>
      <p className="onb-fine onb-real">A real screen. Yours shows the matches on now.</p>
      <p className="onb-lead">{slide.body}</p>
    </div>
  );
}
