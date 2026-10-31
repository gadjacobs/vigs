export const shareUrl = (code: string) => `https://www.sportybet.com/ng/?shareCode=${code}`;

// SportyBet's Android app, so an intent link opens the code in the app rather
// than the browser when it's installed (otherwise Chrome follows the fallback).
const ANDROID_APP = "com.sportybet.android";
export const androidAppUrl = (code: string) =>
  `intent://www.sportybet.com/ng/?shareCode=${code}#Intent;scheme=https;package=${ANDROID_APP};S.browser_fallback_url=${encodeURIComponent(shareUrl(code))};end`;
