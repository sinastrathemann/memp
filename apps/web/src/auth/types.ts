export const ROLE_NAMES = [
  "read_only",
  "participant",
  "werkstudent",
  "event_office",
  "budget_owner",
  "manager",
  "admin",
] as const;

export type RoleName = (typeof ROLE_NAMES)[number];

/**
 * Hub-Identität, wie sie `GET /me` liefert (siehe apps/api/src/routes/auth.ts).
 * `roles`/`groups` sind Rohwerte aus den X-MSQ-*-Headern (Entra/AppHub-Rollen) —
 * NICHT dieselben Werte wie `RoleName` (mEXP-interne Rollen, verwaltet über
 * /admin/users). Hub-Admins (`isHubAdmin`) werden serverseitig überall als
 * mEXP-"admin" behandelt (siehe requireMexpRole) — das spiegelt `hasRole` unten.
 */
export interface AuthUser {
  id: string;
  email: string | null;
  name: string | null;
  roles: string[];
  groups: string[];
  isHubAdmin: boolean;
  isGuest: boolean;
  authTime: string | null;
}

/**
 * Antwort von `GET /me/roles` (siehe apps/api/src/routes/auth.ts) — die mEXP-internen
 * Rollen des aktuellen Hub-Users, getrennt von den rohen Hub-Rollen aus `/me`.
 */
export interface MeRoles {
  userId: string;
  isHubAdmin: boolean;
  hubRoles: string[];
  mexpRoles: string[];
  effectiveRoles: string[];
}

export interface AdminUserRow {
  id: string;
  email: string;
  displayName: string;
  isActive: boolean;
  roles: RoleName[];
  createdAt: string;
  lastLoginAt: string | null;
  /** Letzter authentifizierter Request. Fehlt bei Nutzern, die sich nie
   *  angemeldet haben — etwa frisch aus Personio importierte. */
  lastSeenAt?: string;
  // Optional: nur gesetzt für User, die aus/mit Personio synchronisiert wurden
  // (siehe apps/api/src/routes/admin-personio.ts).
  personioId?: string;
  department?: string | null;
  // Optional: nur gesetzt für User, die aus/mit der SharePoint-Studi-Liste
  // synchronisiert wurden (siehe apps/api/src/routes/admin-sharepoint.ts).
  sharepointStudiId?: string;
  position?: string | null;
  team?: string | null;
  // Optional: nur gesetzt für User, die per manuellem CSV-Upload angelegt/aktualisiert
  // wurden (siehe apps/api/src/routes/admin-users-import.ts).
  csvImportedAt?: string;
}
