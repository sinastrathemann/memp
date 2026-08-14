import { getPortfolioStats } from "@mexp/application";
import { Hono } from "hono";
import { dashboard, env } from "../deps.js";
import { persistentMap } from "../dev-persistence.js";

export const dashboardRoutes = new Hono();

// Dev-Store-Zugriff nur für Aggregation — dieselben Stores wie in events.ts + registration-form.ts.
// (Wir lesen nur, wir mutieren nicht — die Stores sind bereits über die anderen Routes befüllt.)
const devCreatedEventsStore = persistentMap<Record<string, unknown>>("created-events");
const devEventOverrideStore = persistentMap<Record<string, unknown>>("event-overrides");
const devLiveParticipantsStore = persistentMap<Record<string, unknown>>("live-participants");

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
  for (const p of devLiveParticipantsStore.values()) {
    const st = (p as { status?: string }).status ?? "registered";
    if (participationByStatus[st] !== undefined) participationByStatus[st]++;
  }

  const attended = participationByStatus.attended ?? 0;
  const noShow = participationByStatus.no_show ?? 0;
  const totalCheckable = attended + noShow;
  const attendanceRate = totalCheckable > 0 ? attended / totalCheckable : null;
  const noShowRate = totalCheckable > 0 ? noShow / totalCheckable : null;

  return {
    eventsByStatus,
    participationByStatus,
    upcomingEventsCount,
    attendanceRate,
    noShowRate,
    totalEvents: allEvents.length,
  };
}

dashboardRoutes.get("/portfolio", async (c) => {
  if (!env.DATABASE_URL) {
    return c.json({ stats: computeDevStats() });
  }
  const stats = await getPortfolioStats({ dashboard });
  return c.json({ stats });
});
