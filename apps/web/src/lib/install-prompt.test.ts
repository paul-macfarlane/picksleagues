import { describe, expect, it } from "vitest";
import { detectInstallPlatform } from "./install-prompt";

// Each row is a device the card must instruct correctly (MOB-8); the
// iPad-as-Mac row pins the touch-point disambiguation specifically, since a
// UA change there silently reroutes iPad members to the wrong instructions.
describe("detectInstallPlatform", () => {
  it.each([
    [
      "iPhone Safari",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
      5,
      "ios",
    ],
    [
      "iPadOS masquerading as a Mac",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
      5,
      "ios",
    ],
    [
      "actual Mac desktop Safari",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
      0,
      "other",
    ],
    [
      "Android Chrome",
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
      5,
      "android",
    ],
    [
      "Android Firefox",
      "Mozilla/5.0 (Android 14; Mobile; rv:127.0) Gecko/127.0 Firefox/127.0",
      5,
      "android",
    ],
    [
      "Windows desktop Chrome",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      0,
      "other",
    ],
  ])("%s → %s", (_label, ua, maxTouchPoints, expected) => {
    expect(detectInstallPlatform(ua, maxTouchPoints)).toBe(expected);
  });
});
