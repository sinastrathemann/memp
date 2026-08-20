import type { RoleName } from "../auth/types";

/**
 * Reihenfolge, in der Rollen in der Legende erklaert werden — von wenig zu viel
 * Verantwortung.
 *
 * Das ist eine Lesereihenfolge, KEINE Hierarchie: mEXP-Rollen sind additiv,
 * eine Person kann `event_office` und `budget_owner` gleichzeitig tragen. Wer
 * hier eine Rangfolge hineinliest, irrt.
 *
 * Der Test haelt die Liste mit ROLE_NAMES synchron: kommt eine Rolle dazu,
 * schlaegt er fehl, bis sie hier eingeordnet ist.
 */
export const ROLE_EXPLANATION_ORDER: readonly RoleName[] = [
  "read_only",
  "participant",
  "werkstudent",
  "event_office",
  "budget_owner",
  "manager",
  "admin",
] as const;
