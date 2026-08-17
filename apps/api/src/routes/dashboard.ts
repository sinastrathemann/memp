import { getPortfolioStats } from "@mexp/application";
import { Hono } from "hono";
import { dashboard, env } from "../deps.js";
import { requireMexpRole } from "./_user-resolution.js";
import { devCreatedEventsStore, devEventOverrideStore } from "./events.js";
import { devLiveParticipantsStore } from "./registration-form.js";

export const dashboardRoutes = new Hono();

// Portfolio-Kennzahlen sind Managementdaten (Auslastung, Quoten ueber alle Events)
// und gehen normale Teilnehmende nichts an — Audit-Finding SEC-06.
// Rollen bewusst identisch zur Sidebar-Logik in apps/web/src/components/sidebar.tsx.
const PORTFOLIO_ROLES = ["admin", "manager", "event_office"] as const;

// WICHTIG: Diese Stores werden aus den schreibenden Modulen importiert, nicht hier
// neu erzeugt. persistentMap liest die Datei nur einmal beim Erzeugen — eine eigene
// Instanz wuerde den Stand vom Prozessstart einfrieren (Audit-Finding FUN-08).

interface EventLike {
  id: string;
  status?: string;
  startAt?: string;
  endAt?: string;
  _deleted?: boolean;
}

function computeDevStats() {
  // Statische Mock-Events der Seed-Liste sind in events.ts hardcodiert — für die
  // Dashboard-Aggregation nehmen wir die aus dem override-Store + created-Store.
  // Das reicht: der override-Store enthält für alle 7 Seed-Events die Sinas Edits,
  // der created-Store enthält alle per POST /api/events angelegten Events (die 18
  // OneNote-Imports + neue via UI). Reine Mock-Events die weder editiert noch neu
  // angelegt wurden zählen wir nicht mit — die haben eh keine Teilnehmerdaten.
  const seedIds = ["evt-001", "evt-002", "evt-003", "evt-004", "evt-005", "evt-006", "evt-007"];
  const allEvents: EventLike[] = [];

  // Seeds: Base + Override, gelöschte raus
  for (const seedId of seedIds) {
    const ov = devEventOverrideStore.get(seedId) as EventLike | undefined;
    if (ov?._deleted) continue;
    // Ohne Override existiert das Seed-Event trotzdem — wir kennen aber Status/Dates
    // nur wenn eins gesetzt wurde. Wenn kein Override: den Base-Status "open"/"planned"
    // annehmen (wie in buildMockEventList) — konservativ „open" nehmen.
    allEvents.push({
      id: seedId,
      status: (ov?.status as string) ?? "open",
      startAt: ov?.startAt as string,
      endAt: ov?.endAt as string,
    });
  }

  // Alle per POST angelegten Events (18 OneNote-Imports + neue via UI)
  for (const evt of devCreatedEventsStore.values()) {
    const e = evt as unknown as EventLike;
    if (e._deleted) continue;
    allEvents.push({
      id: e.id,
      status: e.status ?? "draft",
      startAt: e.startAt as string,
      endAt: e.endAt as string,
    });
  }

  const eventsByStatus: Record<string, number> = {
    draft: 0,
    planned: 0,
    open: 0,
    running: 0,
    closed: 0,
    cancelled: 0,
  };
  const now = Date.now();
  let upcomingEventsCount = 0;

  for (const evt of allEvents) {
    const st = evt.status ?? "draft";
    if (eventsByStatus[st] !== undefined) eventsByStatus[st]++;
    // "Kommend" = startAt in Zukunft
    if (evt.startAt && new Date(evt.startAt).getTime() > now) {
      upcomingEventsCount++;
    }
  }

  // Teilnahmen: aus live-participants aggregieren
  const participationByStatus: Record<string, number> = {
    registered: 0,
    waitlisted: 0,
    attended: 0,
    no_show: 0,
  };
  // Der Store bildet eventId -> Liste der Teilnehmenden ab. Vorher wurde ueber
  // .values() iteriert und jede LISTE als einzelner Teilnehmer behandelt — dadurch
  // zaehlte jedes Event als genau eine Anmeldung, egal wie viele Leute drin standen.
  const closedEventIds = new Set(
    allEvents.filter((e) => e.status === "closed").map((e) => e.id),
  );
  let closedSeats = 0;
  let closedAttended = 0;
  let closedNoShow = 0;

  for (const [eventId, participants] of devLiveParticipantsStore.entries()) {
    for (const p of participants) {
      const st = p.status ?? "registered";
      if (participationByStatus[st] !== undefined) participationByStatus[st]++;
      if (!closedEventIds.has(eventId)) continue;
      // Nenner der Quoten sind alle bestaetigten Plaetze. Warteliste zaehlt nicht
      // mit — diese Personen hatten nie einen Platz und konnten nicht fehlen.
      if (st === "attended") {
        closedAttended++;
        closedSeats++;
      } else if (st === "no_show") {
        closedNoShow++;
        closedSeats++;
      } else if (st === "registered") {
        closedSeats++;
      }
    }
  }

  // Audit-Finding FUN-16: Der Nenner darf nicht (anwesend + Fehlzeit) sein. Sonst
  // zeigt die Quote 100 %, solange niemand Fehlzeiten pflegt — auch wenn die
  // Haelfte nicht erschienen ist. Gezaehlt werden nur abgeschlossene Events;
  // laufende und kommende wuerden die Quote sonst kuenstlich druecken.
  const attendanceRate = closedSeats > 0 ? closedAttended / closedSeats : null;
  const noShowRate = closedSeats > 0 ? closedNoShow / closedSeats : null;

  return {
    eventsByStatus,
    participationByStatus,
    upcomingEventsCount,
    attendanceRate,
    noShowRate,
    totalEvents: allEvents.length,
  };
}

dashboardRoutes.get("/portfolio", requireMexpRole(...PORTFOLIO_ROLES), async (c) => {
  if (!env.DATABASE_URL) {
    return c.json({ stats: computeDevStats() });
  }
  const stats = await getPortfolioStats({ dashboard });
  return c.json({ stats });
});
