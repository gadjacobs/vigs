"use client";
import { useLinkStatus } from "next/link";

/** Put inside a tab's Link: while its page loads, the tab pulses, a bar runs under the top bar and the content below dims. */
export function TabPending() {
  const { pending } = useLinkStatus();
  return <span aria-hidden="true" className={`tabpending ${pending ? "on" : ""}`} />;
}
