"use server";
import { DEFAULT_STAKE } from "@/lib/profile";
import { myProfile } from "@/lib/profile";
import { shareData } from "@/lib/shareinfo";
import type { ShareData } from "@/lib/sharetext";

export async function getShare(code: string): Promise<ShareData | null> {
  if (!/^[A-Z0-9]{4,12}$/.test(code)) return null;
  const { profile } = await myProfile();
  return shareData(code, profile?.prefs?.stake ?? DEFAULT_STAKE).catch(() => null);
}
