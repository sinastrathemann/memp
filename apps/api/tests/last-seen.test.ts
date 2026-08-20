import { describe, expect, it } from "vitest";
import { LAST_SEEN_THROTTLE_MS, shouldTouchLastSeen } from "../src/routes/_last-seen.js";

const NOW = Date.parse("2026-08-20T12:00:00.000Z");

describe("shouldTouchLastSeen", () => {
  it("schreibt, wenn noch nie gesehen", () => {
    expect(shouldTouchLastSeen(undefined, NOW)).toBe(true);
  });

  it("schreibt bei unlesbarem Zeitstempel", () => {
    expect(shouldTouchLastSeen("kein-datum", NOW)).toBe(true);
  });

  it("schreibt nicht innerhalb des Fensters", () => {
    const vorFuenfMinuten = new Date(NOW - 5 * 60 * 1000).toISOString();
    expect(shouldTouchLastSeen(vorFuenfMinuten, NOW)).toBe(false);
  });

  it("schreibt nach Ablauf des Fensters", () => {
    const abgelaufen = new Date(NOW - LAST_SEEN_THROTTLE_MS - 1).toISOString();
    expect(shouldTouchLastSeen(abgelaufen, NOW)).toBe(true);
  });

  it("schreibt genau auf der Grenze", () => {
    const grenze = new Date(NOW - LAST_SEEN_THROTTLE_MS).toISOString();
    expect(shouldTouchLastSeen(grenze, NOW)).toBe(true);
  });

  it("schreibt bei Zeitstempel aus der Zukunft nicht", () => {
    const zukunft = new Date(NOW + 60_000).toISOString();
    expect(shouldTouchLastSeen(zukunft, NOW)).toBe(false);
  });
});
