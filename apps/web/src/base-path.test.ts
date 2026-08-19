import { describe, expect, it } from "vitest";
import { computeBasePath } from "./base-path";

describe("computeBasePath", () => {
  it("liefert keinen Präfix ohne Server-Hinweis (Vite-Dev)", () => {
    expect(computeBasePath("/dashboard", null)).toBe("");
  });

  it("liefert keinen Präfix, wenn die App auf der Wurzel liegt", () => {
    expect(computeBasePath("/dashboard", "/dashboard")).toBe("");
    expect(computeBasePath("/", "/")).toBe("");
  });

  it("erkennt den Slug beim Einstieg auf dem Mount-Root", () => {
    expect(computeBasePath("/mexp/", "/")).toBe("/mexp");
  });

  it("erkennt den Slug auf einer flachen Route", () => {
    expect(computeBasePath("/mexp/dashboard", "/dashboard")).toBe("/mexp");
  });

  it("erkennt den Slug auf einer tiefen Route", () => {
    expect(computeBasePath("/mexp/events/evt-001", "/events/evt-001")).toBe("/mexp");
  });

  it("kommt mit mehrsegmentigen Einhängepunkten zurecht", () => {
    expect(computeBasePath("/tools/mexp/events/evt-1", "/events/evt-1")).toBe("/tools/mexp");
  });

  it("rät nicht, wenn der Server-Pfad kein Suffix des Browser-Pfads ist", () => {
    expect(computeBasePath("/mexp/dashboard", "/events")).toBe("");
  });

  it("hinterlässt keinen Trailing-Slash, der zu Doppel-Slashes führen würde", () => {
    expect(computeBasePath("/mexp/", "/")).not.toMatch(/\/$/);
  });
});
