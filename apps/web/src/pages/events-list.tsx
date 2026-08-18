import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { apiFetch } from "../api/client";
import { useAuth } from "../auth/auth-context";
import { EventStatusBadge } from "../events/status-badge";
import { EVENT_STATUSES, type EventDto } from "../events/types";

export default function EventsListPage() {
  const { t, i18n } = useTranslation();
  const { hasRole } = useAuth();
  const qc = useQueryClient();
  const canCreate = hasRole("admin", "manager", "event_office", "werkstudent");
  const canManage = canCreate;

  const { data, isLoading, error } = useQuery({
    queryKey: ["events", "list"],
    queryFn: () => apiFetch<{ events: EventDto[] }>("/events"),
  });

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const bulkMut = useMutation({
    mutationFn: (status: string) =>
      apiFetch("/events/bulk/status", {
        method: "POST",
        body: JSON.stringify({ eventIds: selectedIds, status }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["events"] });
      setSelectedIds([]);
    },
  });

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleString(i18n.language === "de" ? "de-DE" : "en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    });

  const total = data?.events.length ?? 0;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="eyebrow">Events · {total.toString().padStart(2, "0")} aktiv</div>
          <h1 className="page-title">{t("events.listTitle")}</h1>
          <p className="page-subtitle">
            Alle Events im Überblick — Coworking, Bereichsevents, Teamevents, Feelgood-Formate und
            mehr.
          </p>
        </div>
        {canCreate && (
          <Link to="/events/new" className="btn btn-primary btn-lg">
            + {t("events.create")}
          </Link>
        )}
      </div>

      {isLoading && <div className="card">{t("auth.loading")}</div>}
      {error instanceof Error && <div className="alert alert-error">{error.message}</div>}

      {canManage && data && data.events.length > 0 && (
        <label
          className="row"
          style={{ gap: 6, marginBottom: 12, fontSize: 14, color: "var(--fg-muted)" }}
        >
          <input
            type="checkbox"
            checked={selectedIds.length === data.events.length}
            onChange={(e) => {
              if (e.target.checked) setSelectedIds(data.events.map((ev) => ev.id));
              else setSelectedIds([]);
            }}
          />
          Alle auswählen
        </label>
      )}

      {canManage && selectedIds.length > 0 && (
        <div
          className="card"
          style={{ padding: 12, marginBottom: 16, background: "var(--color-orange-50)" }}
        >
          <strong>{selectedIds.length} Events ausgewählt</strong>
          <select
            disabled={bulkMut.isPending}
            onChange={(e) => {
              if (e.target.value) {
                bulkMut.mutate(e.target.value);
                e.target.value = "";
              }
            }}
            style={{ marginLeft: 12 }}
          >
            <option value="">Status ändern…</option>
            {EVENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                → {t(`events.status.${s}`)}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ marginLeft: 8 }}
            onClick={() => setSelectedIds([])}
          >
            Auswahl aufheben
          </button>
          {bulkMut.error instanceof Error && (
            <div className="alert alert-error" style={{ marginTop: 8 }}>
              {bulkMut.error.message}
            </div>
          )}
        </div>
      )}

      {data && data.events.length === 0 && (
        <div
          className="card"
          style={{
            textAlign: "center",
            padding: "var(--space-16) var(--space-6)",
            color: "var(--fg-muted)",
          }}
        >
          <div className="bento-eyebrow">Noch nichts hier</div>
          <h3 style={{ marginTop: "var(--space-3)" }}>{t("events.empty")}</h3>
        </div>
      )}

      {data && data.events.length > 0 && (
        <div className="event-grid">
          {data.events.map((e) => (
            <Link key={e.id} to={`/events/${e.id}`} className="event-card" data-status={e.status}>
              {canManage && (
                <input
                  type="checkbox"
                  checked={selectedIds.includes(e.id)}
                  onChange={(ev) => {
                    if (ev.target.checked) setSelectedIds([...selectedIds, e.id]);
                    else setSelectedIds(selectedIds.filter((id) => id !== e.id));
                  }}
                  onClick={(ev) => ev.stopPropagation()}
                  style={{ position: "absolute", top: 12, right: 12, transform: "scale(1.3)" }}
                />
              )}
              <div className="event-card-head">
                <span className="event-card-type">{t(`events.type.${e.eventType}`)}</span>
                <EventStatusBadge status={e.status} />
              </div>

              <h2 className="event-card-title">{e.title}</h2>

              <div className="event-card-meta">
                <div className="event-card-meta-row">
                  <span className="event-card-meta-label">Start</span>
                  <span className="event-card-meta-value">{fmtDate(e.startAt)}</span>
                </div>
                <div className="event-card-meta-row">
                  <span className="event-card-meta-label">Ort</span>
                  <span className="event-card-meta-value">{e.location ?? "—"}</span>
                </div>
                {e.capacity !== null && e.capacity !== undefined && (
                  <div className="event-card-meta-row">
                    <span className="event-card-meta-label">Plätze</span>
                    <span className="event-card-meta-value text-mono">{e.capacity}</span>
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
