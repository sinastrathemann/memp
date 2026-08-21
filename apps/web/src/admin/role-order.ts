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

/**
 * Rollen, die den Verwaltungsbereich (`/admin`) betreten duerfen. Gilt fuer die
 * Route selbst UND fuer den Sidebar-Menuepunkt — beide muessen diese Liste
 * verwenden, sonst kann eine Rolle in der Sidebar erscheinen, deren Reiter
 * niemand rendert (oder umgekehrt). Einzelne Reiter innerhalb von `/admin`
 * pruefen zusaetzlich eigene, engere Rollen (siehe admin.tsx).
 */
export const ADMIN_AREA_ROLES: readonly RoleName[] = [
  "admin",
  "manager",
  "event_office",
  "werkstudent",
] as const;
