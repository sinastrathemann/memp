import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isBootstrapAdmin, parseBootstrapAdmins } from "../src/bootstrap-admins.js";

describe("parseBootstrapAdmins", () => {
  it("liefert eine leere Liste ohne Wert", () => {
    expect(parseBootstrapAdmins(undefined)).toEqual([]);
    expect(parseBootstrapAdmins("")).toEqual([]);
  });

  it("trennt an Kommas und entfernt Leerraum", () => {
    expect(parseBootstrapAdmins("a@x.de, b@x.de ,c@x.de")).toEqual(["a@x.de", "b@x.de", "c@x.de"]);
  });

  it("normalisiert auf Kleinschreibung", () => {
    expect(parseBootstrapAdmins("Sina.Strathemann@Mindsquare.DE")).toEqual([
      "sina.strathemann@mindsquare.de",
    ]);
  });

  it("verwirft leere Eintraege", () => {
    expect(parseBootstrapAdmins("a@x.de,,  ,b@x.de")).toEqual(["a@x.de", "b@x.de"]);
  });
});

describe("isBootstrapAdmin", () => {
  let original: string | undefined;

  beforeEach(() => {
    original = process.env.MEXP_BOOTSTRAP_ADMINS;
  });

  afterEach(() => {
    if (original === undefined) {
      // biome-ignore lint/performance/noDelete: env cleanup requires actual deletion
      delete process.env.MEXP_BOOTSTRAP_ADMINS;
    } else {
      process.env.MEXP_BOOTSTRAP_ADMINS = original;
    }
  });

  it("ist false ohne gesetzte Variable", () => {
    // biome-ignore lint/performance/noDelete: env cleanup requires actual deletion
    delete process.env.MEXP_BOOTSTRAP_ADMINS;
    expect(isBootstrapAdmin("a@x.de")).toBe(false);
  });

  it("ist false ohne E-Mail", () => {
    process.env.MEXP_BOOTSTRAP_ADMINS = "a@x.de";
    expect(isBootstrapAdmin(null)).toBe(false);
    expect(isBootstrapAdmin(undefined)).toBe(false);
    expect(isBootstrapAdmin("")).toBe(false);
  });

  it("trifft unabhaengig von Gross-/Kleinschreibung", () => {
    process.env.MEXP_BOOTSTRAP_ADMINS = "sina.strathemann@mindsquare.de";
    expect(isBootstrapAdmin("Sina.Strathemann@Mindsquare.de")).toBe(true);
  });

  it("trifft nicht bei fremder Adresse", () => {
    process.env.MEXP_BOOTSTRAP_ADMINS = "a@x.de";
    expect(isBootstrapAdmin("b@x.de")).toBe(false);
  });
});
