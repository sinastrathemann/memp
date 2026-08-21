import { randomUUID } from "node:crypto";
/**
 * CSV-Upload für User-Import (Sinas Alternative zum Microsoft-Graph-SharePoint-Sync,
 * siehe admin-sharepoint.ts): solange die Azure-App-Registrierung für den Graph-Zugriff
 * keine Admin-Freigabe hat, exportiert Sina die SharePoint-Studi-Liste wöchentlich per
 * Hand als CSV (SharePoint → "In Excel exportieren") und lädt sie hier hoch.
 * - Neue E-Mails → auto als mEXP-User mit Rolle "participant" (Sinas Wahl — konservativ,
 *   nicht "werkstudent"), isActive=true.
 * - Bestehende mEXP-User (E-Mail-Match) → Update von Position/Team, Rolle bleibt
 *   unangetastet (könnte bereits ein Personio-User mit anderer Rolle sein).
 * - KEIN Reverse-Sync/Auto-Deaktivierung hier (anders als admin-personio.ts/
 *   admin-sharepoint.ts): Sina importiert CSVs teilweise, nicht immer alle Studis auf
 *   einmal — ein User, der in dieser CSV fehlt, heißt nicht "ausgeschieden".
 *   Deaktivierung bleibt bewusst manuell (siehe admin-users.tsx).
 * Admin-only (requireMexpRole("admin")): der Import legt/aendert User account-weit.
 * Die mEXP-Adminrolle wird ausschliesslich von Admins vergeben; requireMexpRole prueft
 * hub.isHubAdmin selbst zuerst (siehe packages/auth/src/hub-middleware.ts) — echte
 * Hub-Admins sind also eingeschlossen.
 */
import { rootLogger } from "@mexp/shared";
import { Hono } from "hono";
import { z } from "zod";
import { type MexpUser, mexpUserStore, requireMexpRole } from "./_user-resolution.js";

const log = rootLogger.child({ module: "api/admin/users-import" });
export const adminUsersImportRoutes = new Hono();

/**
 * Toleranter CSV-Parser für User-Import.
 *
 * Erkennt:
 * - Delimiter: `,` oder `;` (Auto-Detect basiert auf erster Zeile)
 * - Encoding: erwartet UTF-8 (mit optionalem BOM). Windows-1252-Exporte (Excel ohne
 *   "CSV UTF-8"-Option) können bei Umlauten als Mojibake ankommen — es findet keine
 *   automatische Konvertierung statt, siehe docs/csv-import.md für den Workaround.
 * - Quoted values mit `"..."` (inkl. Escaped-Quotes `""`)
 * - Header-Aliases (siehe FIELD_ALIASES unten): probiert deutsche + englische Spaltennamen
 */
function detectDelimiter(firstLine: string): string {
  const semis = (firstLine.match(/;/g) ?? []).length;
  const commas = (firstLine.match(/,/g) ?? []).length;
  return semis > commas ? ";" : ",";
}

function parseCsvLine(line: string, delim: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === delim) {
        cells.push(cur);
        cur = "";
      } else cur += ch;
    }
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const clean = text.replace(/^﻿/, ""); // BOM entfernen
  const lines = clean.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  const delim = detectDelimiter(lines[0] ?? "");
  const headers = parseCsvLine(lines[0] ?? "", delim).map((h) => h.trim());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i] ?? "", delim);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = cells[idx] ?? "";
    });
    rows.push(row);
  }
  return { headers, rows };
}

const FIELD_ALIASES = {
  firstName: ["Vorname", "First Name", "First name", "FirstName", "Given Name"],
  lastName: ["Nachname", "Last Name", "Last name", "LastName", "Surname"],
  displayName: ["Name", "Vollständiger Name", "Full Name", "DisplayName", "Title"],
  email: ["E-Mail", "Email", "EMail", "E-Mail-Adresse", "Mail"],
  position: ["Position", "Rolle", "Typ", "Art", "Stelle"],
  team: ["Team", "Bereich", "Abteilung", "Department"],
  endDate: ["Vertragsende", "Ende", "End Date", "EndDate", "Bis"],
};

function pick(row: Record<string, string>, aliases: string[]): string | null {
  for (const key of aliases) {
    const v = row[key];
    if (v !== undefined && v !== "") return v;
  }
  // Case-insensitive fallback
  const lowerRow: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) lowerRow[k.toLowerCase()] = v;
  for (const key of aliases) {
    const v = lowerRow[key.toLowerCase()];
    if (v !== undefined && v !== "") return v;
  }
  return null;
}

const jsonBodySchema = z.object({ csv: z.string().min(1) });

adminUsersImportRoutes.post("/import-csv", requireMexpRole("admin"), async (c) => {
  const contentType = c.req.header("content-type") ?? "";
  let csvText = "";

  if (contentType.startsWith("multipart/form-data")) {
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) {
      return c.json(
        { error: "no_file", message: "Bitte eine CSV-Datei als 'file' hochladen." },
        400,
      );
    }
    csvText = await file.text();
  } else if (contentType.startsWith("text/csv") || contentType.startsWith("text/plain")) {
    csvText = await c.req.text();
  } else if (contentType.startsWith("application/json")) {
    const json = await c.req.json();
    const parsed = jsonBodySchema.safeParse(json);
    if (!parsed.success) {
      return c.json({ error: "no_csv", message: "JSON-Body muss {csv: '...'} enthalten." }, 400);
    }
    csvText = parsed.data.csv;
  } else {
    return c.json(
      {
        error: "unsupported_content_type",
        message: `Content-Type '${contentType}' nicht unterstützt. Erwartet: multipart/form-data, text/csv oder application/json {csv:'...'}`,
      },
      415,
    );
  }

  if (!csvText.trim()) return c.json({ error: "empty_csv", message: "CSV ist leer." }, 400);

  const parsedCsv = parseCsv(csvText);
  if (parsedCsv.rows.length === 0) {
    return c.json({ error: "no_rows", message: "CSV hat einen Header aber keine Zeilen." }, 400);
  }

  const now = new Date().toISOString();
  let created = 0;
  let updated = 0;
  let skippedNoEmail = 0;
  const errors: string[] = [];

  for (const [idx, row] of parsedCsv.rows.entries()) {
    const email = pick(row, FIELD_ALIASES.email);
    if (!email) {
      skippedNoEmail++;
      continue;
    }
    const emailLc = email.toLowerCase();

    const firstName = pick(row, FIELD_ALIASES.firstName);
    const lastName = pick(row, FIELD_ALIASES.lastName);
    const nameFromParts = [firstName, lastName].filter(Boolean).join(" ");
    const displayName = pick(row, FIELD_ALIASES.displayName) ?? (nameFromParts || emailLc);

    const position = pick(row, FIELD_ALIASES.position);
    const team = pick(row, FIELD_ALIASES.team);

    let existing: MexpUser | undefined;
    for (const u of mexpUserStore.values()) {
      if (u.email?.toLowerCase() === emailLc) {
        existing = u;
        break;
      }
    }

    try {
      if (existing) {
        mexpUserStore.set(existing.id, {
          ...existing,
          position: position ?? existing.position ?? null,
          team: team ?? existing.team ?? null,
          csvImportedAt: now,
          updatedAt: now,
        });
        updated++;
      } else {
        const id = `csv-${randomUUID()}`;
        const fresh: MexpUser = {
          id,
          email: emailLc,
          displayName,
          roles: ["participant"],
          isActive: true,
          createdAt: now,
          updatedAt: now,
          position,
          team,
          csvImportedAt: now,
        };
        mexpUserStore.set(id, fresh);
        created++;
      }
    } catch (err) {
      errors.push(`Zeile ${idx + 2}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  log.info(
    { total: parsedCsv.rows.length, created, updated, skippedNoEmail, errors: errors.length },
    "csv import done",
  );
  return c.json({
    ok: true,
    total: parsedCsv.rows.length,
    created,
    updated,
    skippedNoEmail,
    errors,
    detectedHeaders: parsedCsv.headers,
    importedAt: now,
  });
});
