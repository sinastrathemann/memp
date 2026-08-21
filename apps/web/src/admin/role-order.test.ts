import { describe, expect, it } from "vitest";
import { ROLE_NAMES } from "../auth/types";
import { ROLE_EXPLANATION_ORDER } from "./role-order";

describe("ROLE_EXPLANATION_ORDER", () => {
  it("enthaelt jede Rolle genau einmal", () => {
    expect([...ROLE_EXPLANATION_ORDER].sort()).toEqual([...ROLE_NAMES].sort());
  });

  it("beginnt mit der eingeschraenktesten Rolle", () => {
    expect(ROLE_EXPLANATION_ORDER[0]).toBe("read_only");
  });

  it("endet mit admin", () => {
    expect(ROLE_EXPLANATION_ORDER[ROLE_EXPLANATION_ORDER.length - 1]).toBe("admin");
  });
});
