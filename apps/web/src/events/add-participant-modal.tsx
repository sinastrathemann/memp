import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { apiFetch } from "../api/client";
import type { UserSearchResult } from "./types";

interface AddParticipantModalProps {
  eventId: string;
  eventTitle: string;
  onClose: () => void;
}

interface AddParticipantResponse {
  ok: true;
  skipped?: boolean;
  message?: string;
  participation?: { userDisplayName: string | null };
}

const SEARCH_DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 2;

// Teilnehmer manuell zu einem Event hinzufügen (Admin/Manager-Workflow) — Live-Suche über
// alle Personio-synced + manuell angelegten mEXP-User. Verwendet React Portal wie
// event-edit-modal.tsx: ohne Portal landet das Modal sonst im DOM-Kontext des Panels und
// kann hinter anderen Elementen der Seite verschwinden.
export function AddParticipantModal({ eventId, eventTitle, onClose }: AddParticipantModalProps) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  // userId → Ergebnis der letzten Hinzufügen-Aktion (für Zeilen-Status "✓ hinzugefügt" etc.)
  const [addedIds, setAddedIds] = useState<Record<string, "added" | "skipped">>({});
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; text: string } | null>(
    null,
  );

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(null), 4000);
    return () => clearTimeout(timer);
  }, [feedback]);

  const searchQ = useQuery({
    queryKey: ["user-search", debouncedQuery],
    queryFn: () =>
      apiFetch<{ users: UserSearchResult[] }>(
        `/users/search?q=${encodeURIComponent(debouncedQuery)}`,
      ),
    enabled: debouncedQuery.length >= MIN_QUERY_LENGTH,
  });

  const addMut = useMutation({
    mutationFn: (userId: string) =>
      apiFetch<AddParticipantResponse>(`/events/${eventId}/participants`, {
        method: "POST",
        body: JSON.stringify({ userId }),
      }),
    onSuccess: (data, userId) => {
      setAddedIds((cur) => ({ ...cur, [userId]: data.skipped ? "skipped" : "added" }));
      const name = data.participation?.userDisplayName ?? data.message ?? "";
      setFeedback({
        kind: "success",
        text: data.skipped
          ? (data.message ?? t("participants.addAlreadyIn", { name }))
          : t("participants.addSuccess", { name }),
      });
      qc.invalidateQueries({ queryKey: ["events", eventId, "participants"] });
    },
    onError: (err) => {
      setFeedback({
        kind: "error",
        text: err instanceof Error ? err.message : t("participants.addError"),
      });
    },
  });

  const results = searchQ.data?.users ?? [];
  const showEmptyHint = debouncedQuery.length < MIN_QUERY_LENGTH;
  const showNoResults =
    !showEmptyHint && !searchQ.isFetching && results.length === 0 && debouncedQuery.length > 0;

  return createPortal(
    <div
      className="modal-backdrop"
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(10, 10, 10, 0.55)",
        backdropFilter: "blur(4px)",
        zIndex: 9999,
        padding: 24,
        overflow: "auto",
      }}
    >
      <div
        className="modal"
        style={{
          maxWidth: 560,
          width: "100%",
          maxHeight: "85vh",
          overflow: "auto",
          background: "#ffffff",
          borderRadius: 12,
          padding: 32,
          boxShadow: "0 20px 40px rgba(0,0,0,0.2)",
          position: "relative",
        }}
      >
        <div className="card-header" style={{ marginBottom: "var(--space-2)" }}>
          <div>
            <div className="eyebrow">{t("participants.addModalEyebrow")}</div>
            <h2 className="card-title" style={{ marginTop: 4 }}>
              {eventTitle}
            </h2>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="field" style={{ marginTop: "var(--space-4)" }}>
          <input
            type="search"
            className="input"
            // biome-ignore lint/a11y/noAutofocus: Fokus wandert in einen bewusst geöffneten Dialog — WAI-ARIA-Dialogmuster, nicht Autofokus beim Seitenaufruf.
            autoFocus
            placeholder={t("participants.addSearchPlaceholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        {feedback && (
          <div
            className={feedback.kind === "success" ? "alert alert-info" : "alert alert-error"}
            style={{ marginTop: "var(--space-3)" }}
          >
            {feedback.text}
          </div>
        )}

        <div style={{ marginTop: "var(--space-3)" }}>
          {showEmptyHint && <p className="muted text-sm">{t("participants.addSearchHint")}</p>}
          {!showEmptyHint && searchQ.isFetching && (
            <p className="muted text-sm">{t("participants.addSearching")}</p>
          )}
          {showNoResults && <p className="muted text-sm">{t("participants.addNoResults")}</p>}

          {results.length > 0 && (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {results.map((u) => {
                const status = addedIds[u.id];
                const meta = [u.team, u.department, u.position].filter(Boolean).join(" · ");
                return (
                  <li
                    key={u.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "var(--space-3)",
                      padding: "var(--space-3)",
                      borderBottom: "1px solid var(--border-default)",
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div
                        className="text-bold"
                        style={{ overflow: "hidden", textOverflow: "ellipsis" }}
                      >
                        {u.displayName}
                      </div>
                      <div className="muted text-sm">{u.email ?? "—"}</div>
                      {meta && (
                        <div className="muted text-xs" style={{ marginTop: 2 }}>
                          {meta}
                        </div>
                      )}
                    </div>
                    {status ? (
                      <span className="badge badge-muted" style={{ flexShrink: 0 }}>
                        {status === "added"
                          ? t("participants.addBadgeAdded")
                          : t("participants.addBadgeSkipped")}
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        style={{ flexShrink: 0 }}
                        disabled={addMut.isPending}
                        onClick={() => addMut.mutate(u.id)}
                      >
                        {t("participants.addButton")}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="form-actions" style={{ marginTop: "var(--space-5)" }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t("participants.addDone")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
