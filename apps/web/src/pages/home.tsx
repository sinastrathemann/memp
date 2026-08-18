import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { apiFetch } from "../api/client";
import { useAuth } from "../auth/auth-context";
import { EventStatusBadge } from "../events/status-badge";
import type { EventDto } from "../events/types";

interface MyEventShort {
  id: string;
  title: string;
  eventType: string;
  status: string;
  startAt: string;
  endAt: string;
  location: string | null;
}

interface MyDashboard {
  upcoming: MyEventShort[];
  past: MyEventShort[];
  totalCostCents: number;
  costByEvent: { eventId: string; title: string; eventType: string; shareCents: number }[];
  registeredCount: number;
  attendedCount: number;
}

const WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const MONTHS = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
];

export default function HomePage() {
  const { t } = useTranslation();
  const { user, hasRole } = useAuth();
  const isAdmin = hasRole("admin", "manager", "event_office", "werkstudent");

  const eventsQ = useQuery({
    queryKey: ["events", "list"],
    queryFn: () => apiFetch<{ events: EventDto[] }>("/events"),
  });

  const myQ = useQuery({
    queryKey: ["my", "dashboard"],
    queryFn: () => apiFetch<MyDashboard>("/my/dashboard"),
    enabled: Boolean(user),
  });

  const today = new Date();
  const todayLabel = `${WEEKDAYS[today.getDay()]}, ${today.getDate()}. ${MONTHS[today.getMonth()]}`;

  const events = eventsQ.data?.events ?? [];

  const now = Date.now();
  const inDays = (iso: string) => Math.round((new Date(iso).getTime() - now) / 86400000);

  const live = events
    .filter((e) => e.status === "running")
    .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());

  const open = events
    .filter((e) => e.status === "open")
    .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());

  const upcoming = events
    .filter((e) => e.status === "planned" && new Date(e.startAt).getTime() > now)
    .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())
    .slice(0, 6);

  // ─── Erinnerungs-Banner ─────────────────────────────────────
  // 1) Bald-Banner: User ist angemeldet, Event startet in <48h
  const imminent = (myQ.data?.upcoming ?? []).find((e) => {
    const ms = new Date(e.startAt).getTime() - now;
    return ms > 0 && ms < 48 * 3600 * 1000;
  });

  // 2) Anmeldefrist-Banner: Event mit deadline in <48h und User noch nicht angemeldet
  const myEventIds = new Set((myQ.data?.upcoming ?? []).map((e) => e.id));
  const deadlineSoon = events.find((e) => {
    if (!e.registrationDeadline || myEventIds.has(e.id) || e.status !== "open") return false;
    const ms = new Date(e.registrationDeadline).getTime() - now;
    return ms > 0 && ms < 48 * 3600 * 1000;
  });

  const fmtHoursOrDays = (iso: string) => {
    const diff = new Date(iso).getTime() - now;
    if (diff < 3600 * 1000) {
      return `in ${Math.round(diff / 60000)} Min.`;
    }
    if (diff < 24 * 3600 * 1000) {
      return `heute um ${new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}`;
    }
    if (diff < 48 * 3600 * 1000) {
      return `morgen um ${new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}`;
    }
    return new Date(iso).toLocaleString("de-DE", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  };

  const stats = isAdmin
    ? {
        total: events.length,
        open: open.length,
        live: live.length,
        upcoming: upcoming.length,
      }
    : null;

  return (
    <div className="page">
      <div className="page-header" style={{ borderBottom: "none", paddingBottom: 0 }}>
        <div>
          <div className="eyebrow">
            {todayLabel} ·{" "}
            <span style={{ color: "var(--fg-muted)" }}>
              <span
                style={{
                  display: "inline-block",
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "var(--brand-lime)",
                  marginRight: 4,
                  verticalAlign: "middle",
                }}
              />
              {live.length > 0 ? `${live.length} Event live` : "Alle ruhig"}
            </span>
          </div>
          <h1 className="page-title">Hallo {user?.name?.split(" ")[0] ?? "👋"}.</h1>
          <p className="page-subtitle">
            {isAdmin
              ? "Dein Portfolio auf einen Blick — was läuft, was offen ist, was kommt."
              : "Was du heute brauchst — Events, bei denen du dabei bist oder dabei sein kannst."}
          </p>
        </div>
        {isAdmin && (
          <Link to="/events/new" className="btn btn-primary btn-lg">
            + Event anlegen
          </Link>
        )}
      </div>

      {/* Erinnerungs-Banner */}
      {imminent && (
        <Link
          to={`/events/${imminent.id}`}
          style={{
            display: "block",
            margin: "var(--space-6) 0 var(--space-4)",
            padding: "var(--space-4) var(--space-5)",
            background: "var(--brand-orange)",
            color: "var(--color-white)",
            borderRadius: "var(--radius-lg)",
            textDecoration: "none",
            boxShadow: "var(--shadow-orange)",
          }}
        >
          <div
            className="text-mono text-xs"
            style={{ opacity: 0.85, letterSpacing: "var(--tracking-wider)" }}
          >
            🔔 ERINNERUNG
          </div>
          <div style={{ marginTop: 4, fontSize: "var(--text-md)", fontWeight: 700 }}>
            {imminent.title} — {fmtHoursOrDays(imminent.startAt)}
            {imminent.location && (
              <span style={{ fontWeight: 400, opacity: 0.9 }}> · {imminent.location}</span>
            )}
          </div>
        </Link>
      )}
      {deadlineSoon && (
        <Link
          to={`/events/${deadlineSoon.id}`}
          style={{
            display: "block",
            margin: "var(--space-4) 0",
            padding: "var(--space-4) var(--space-5)",
            background: "var(--brand-yellow)",
            color: "var(--color-ink-900)",
            borderRadius: "var(--radius-lg)",
            textDecoration: "none",
          }}
        >
          <div
            className="text-mono text-xs"
            style={{ opacity: 0.7, letterSpacing: "var(--tracking-wider)" }}
          >
            ⏰ LETZTE CHANCE
          </div>
          <div style={{ marginTop: 4, fontSize: "var(--text-md)", fontWeight: 700 }}>
            Anmeldung schließt {fmtHoursOrDays(deadlineSoon.registrationDeadline ?? "")} —{" "}
            {deadlineSoon.title}
          </div>
        </Link>
      )}

      {/* Admin KPI-Strip */}
      {isAdmin && stats && (
        <section
          className="bento"
          style={{ marginBottom: "var(--space-8)", gridAutoRows: "minmax(110px, auto)" }}
        >
          <div className="bento-tile tone-ink span-3">
            <div className="bento-eyebrow">🗂️ Portfolio</div>
            <div className="bento-headline size-md">{stats.total}</div>
            <div className="bento-sub">Events gesamt</div>
          </div>
          <div className="bento-tile tone-orange span-3">
            <div className="bento-eyebrow">📅 Anmeldung offen</div>
            <div className="bento-headline size-md">{stats.open > 0 ? stats.open : "–"}</div>
            <div className="bento-sub">Mitarbeiter können sich anmelden</div>
          </div>
          <div className="bento-tile tone-yellow span-3">
            <div className="bento-eyebrow">🛠️ Geplant</div>
            <div className="bento-headline size-md">
              {stats.upcoming > 0 ? stats.upcoming : "–"}
            </div>
            <div className="bento-sub">in Vorbereitung</div>
          </div>
          <div className="bento-tile span-3">
            <div className="bento-eyebrow">
              <span
                className={`badge ${stats.live > 0 ? "badge-success badge-live" : "badge-muted"}`}
                style={{ padding: "2px 8px" }}
              >
                Live
              </span>
            </div>
            <div
              className="bento-headline size-md"
              style={{
                color: stats.live > 0 ? "var(--brand-lime)" : "var(--fg-muted)",
                marginTop: "var(--space-4)",
              }}
            >
              {stats.live > 0 ? stats.live : "–"}
            </div>
            <div className="bento-sub muted">
              {stats.live > 0 ? "Events laufen jetzt" : "Nichts läuft gerade"}
            </div>
          </div>
        </section>
      )}

      {/* Persönliche Sektionen — nur wenn User Anmeldungen oder vergangene Events hat */}
      {myQ.data && (myQ.data.upcoming.length > 0 || myQ.data.past.length > 0) && (
        <>
          {/* KPI: Was hat die Firma für dich ausgegeben */}
          {myQ.data.totalCostCents > 0 && (
            <section
              className="bento"
              style={{ marginBottom: "var(--space-8)", gridAutoRows: "minmax(110px, auto)" }}
            >
              <div className="bento-tile tone-ink span-4">
                <div className="bento-eyebrow">Für dich investiert</div>
                <div className="bento-headline size-md">
                  {new Intl.NumberFormat("de-DE", {
                    style: "currency",
                    currency: "EUR",
                    maximumFractionDigits: 0,
                  }).format(myQ.data.totalCostCents / 100)}
                </div>
                <div className="bento-sub">Anteilig über alle Events</div>
              </div>
              <div className="bento-tile tone-orange span-4">
                <div className="bento-eyebrow">Meine Anmeldungen</div>
                <div className="bento-headline size-md">{myQ.data.registeredCount}</div>
                <div className="bento-sub">anstehende Events</div>
              </div>
              <div className="bento-tile tone-yellow span-4">
                <div className="bento-eyebrow">Besucht</div>
                <div className="bento-headline size-md">{myQ.data.attendedCount}</div>
                <div className="bento-sub">vergangene Events</div>
              </div>
            </section>
          )}

          {/* Meine Anmeldungen */}
          {myQ.data.upcoming.length > 0 && (
            <Section
              eyebrow={`Wo du dich angemeldet hast · ${myQ.data.upcoming.length}`}
              title="Meine nächsten Events"
            >
              <div className="event-grid">
                {myQ.data.upcoming.map((e) => (
                  <MyEventCard key={e.id} event={e} />
                ))}
              </div>
            </Section>
          )}

          {/* Vergangene */}
          {myQ.data.past.length > 0 && (
            <Section
              eyebrow={`Vergangenheit · ${myQ.data.past.length}`}
              title="Meine vergangenen Events"
            >
              <div className="event-grid">
                {myQ.data.past.map((e) => (
                  <MyEventCard key={e.id} event={e} compact />
                ))}
              </div>
            </Section>
          )}
        </>
      )}

      {/* Live jetzt */}
      {live.length > 0 && (
        <Section
          eyebrow={
            <span className="badge badge-success badge-live" style={{ padding: "2px 8px" }}>
              Live jetzt
            </span>
          }
          title="Diese Events laufen gerade"
        >
          <div className="event-grid">
            {live.map((e) => (
              <EventCardBig key={e.id} event={e} highlight />
            ))}
          </div>
        </Section>
      )}

      {/* Anmeldung offen */}
      {open.length > 0 && (
        <Section
          eyebrow={`Anmeldung offen · ${open.length}`}
          title={isAdmin ? "Aktuell zur Anmeldung freigegeben" : "Hier kannst du dich anmelden"}
        >
          <div className="event-grid">
            {open.map((e) => (
              <EventCardBig key={e.id} event={e} daysFromNow={inDays(e.startAt)} />
            ))}
          </div>
        </Section>
      )}

      {/* Demnächst */}
      {upcoming.length > 0 && (
        <Section eyebrow="Demnächst" title="In Planung">
          <div className="event-grid">
            {upcoming.map((e) => (
              <EventCardBig key={e.id} event={e} daysFromNow={inDays(e.startAt)} compact />
            ))}
          </div>
        </Section>
      )}

      {/* Empty state */}
      {!eventsQ.isLoading && events.length === 0 && (
        <div className="card" style={{ textAlign: "center", padding: "var(--space-12)" }}>
          <div className="bento-eyebrow">Nichts in Sicht</div>
          <h3 style={{ marginTop: "var(--space-3)" }}>Keine Events im Portfolio</h3>
          {isAdmin && (
            <Link
              to="/events/new"
              className="btn btn-primary"
              style={{ marginTop: "var(--space-4)" }}
            >
              + Erstes Event anlegen
            </Link>
          )}
        </div>
      )}

      {eventsQ.isLoading && <div className="muted">{t("auth.loading")}</div>}
    </div>
  );
}

function Section({
  eyebrow,
  title,
  children,
}: {
  eyebrow: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginBottom: "var(--space-10)" }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: "var(--space-4)",
          gap: "var(--space-3)",
        }}
      >
        <div>
          <div className="eyebrow" style={{ marginBottom: 4 }}>
            {eyebrow}
          </div>
          <h2 className="card-title">{title}</h2>
        </div>
      </div>
      {children}
    </section>
  );
}

function EventCardBig({
  event,
  daysFromNow,
  highlight,
  compact,
}: {
  event: EventDto;
  daysFromNow?: number;
  highlight?: boolean;
  compact?: boolean;
}) {
  const date = new Date(event.startAt);
  const dateStr = date.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "short",
  });
  const timeStr = date.toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const relStr =
    daysFromNow === undefined
      ? null
      : daysFromNow === 0
        ? "Heute"
        : daysFromNow === 1
          ? "Morgen"
          : daysFromNow > 0
            ? `in ${daysFromNow} Tagen`
            : `vor ${Math.abs(daysFromNow)} Tagen`;

  return (
    <Link
      to={`/events/${event.id}`}
      className="event-card"
      data-status={event.status}
      style={highlight ? { borderColor: "var(--brand-lime)" } : undefined}
    >
      <div className="event-card-head">
        <span className="event-card-type">
          {dateStr} · {timeStr}
          {relStr && (
            <span
              style={{
                marginLeft: 8,
                color: "var(--brand-orange)",
                fontWeight: 700,
              }}
            >
              {relStr}
            </span>
          )}
        </span>
        <EventStatusBadge status={event.status} />
      </div>

      <h2 className="event-card-title">{event.title}</h2>

      {!compact && event.description && (
        <p
          className="muted text-sm"
          style={{
            margin: 0,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {event.description}
        </p>
      )}

      <div className="event-card-meta">
        <div className="event-card-meta-row">
          <span className="event-card-meta-label">Ort</span>
          <span className="event-card-meta-value">{event.location ?? "—"}</span>
        </div>
        {event.capacity !== null && event.capacity !== undefined && (
          <div className="event-card-meta-row">
            <span className="event-card-meta-label">Plätze</span>
            <span className="event-card-meta-value text-mono">{event.capacity}</span>
          </div>
        )}
      </div>
    </Link>
  );
}

function MyEventCard({ event, compact }: { event: MyEventShort; compact?: boolean }) {
  const date = new Date(event.startAt);
  const dateStr = date.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
  });
  const timeStr = date.toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <div
      className="event-card"
      data-status={event.status}
      style={compact ? { opacity: 0.85 } : undefined}
    >
      <div className="event-card-head">
        <span className="event-card-type">
          {dateStr} · {timeStr}
          <span
            style={{ marginLeft: 8, color: "var(--brand-lime)", fontWeight: 700 }}
            className="text-mono text-xs"
          >
            ✓ angemeldet
          </span>
        </span>
        <EventStatusBadge status={event.status} />
      </div>
      <Link to={`/events/${event.id}`} style={{ color: "inherit", textDecoration: "none" }}>
        <h2 className="event-card-title" style={{ marginBottom: 0 }}>
          {event.title}
        </h2>
      </Link>
      <div className="event-card-meta">
        <div className="event-card-meta-row">
          <span className="event-card-meta-label">Ort</span>
          <span className="event-card-meta-value">{event.location ?? "—"}</span>
        </div>
      </div>
      {!compact && (
        <div
          style={{
            display: "flex",
            gap: 8,
            marginTop: "var(--space-2)",
            paddingTop: "var(--space-3)",
            borderTop: "1px solid var(--border-muted)",
          }}
        >
          <Link to={`/events/${event.id}`} className="btn btn-ghost btn-sm">
            Details →
          </Link>
          <a
            href={`/api/events/${event.id}/calendar.ics`}
            className="btn btn-ghost btn-sm"
            title="In Outlook / Apple Calendar / Google Calendar speichern"
            onClick={(e) => e.stopPropagation()}
          >
            📅 Kalender
          </a>
        </div>
      )}
    </div>
  );
}
