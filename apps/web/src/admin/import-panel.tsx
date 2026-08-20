import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { apiFetch } from "../api/client";
import { withBasePath } from "../base-path";

interface PersonioSyncResult {
  ok: boolean;
  total: number;
  created: number;
  updated: number;
  deactivated: number;
  syncedAt: string;
}

interface SharepointSyncResult {
  ok: boolean;
  total: number;
  created: number;
  updated: number;
  deactivated: number;
  skippedNoEmail: number;
  syncedAt: string;
}

interface CsvImportResult {
  ok: boolean;
  total: number;
  created: number;
  updated: number;
  skippedNoEmail: number;
  errors: string[];
  detectedHeaders: string[];
  importedAt: string;
}

export function ImportPanel() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin", "users"] });

  const syncMut = useMutation({
    mutationFn: () => apiFetch<PersonioSyncResult>("/admin/personio/sync", { method: "POST" }),
    onSuccess: invalidate,
  });

  const spSyncMut = useMutation({
    mutationFn: () =>
      apiFetch<SharepointSyncResult>("/admin/sharepoint/sync-studis", { method: "POST" }),
    onSuccess: invalidate,
  });

  const csvFileRef = useRef<HTMLInputElement>(null);
  const csvImportMut = useMutation({
    // Kein apiFetch hier: apiFetch erzwingt immer "Content-Type: application/json",
    // was den multipart/form-data-Boundary für den File-Upload kaputt machen würde.
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(withBasePath("/api/admin/users/import-csv"), {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      const text = await res.text();
      const body = text ? (JSON.parse(text) as unknown) : null;
      if (!res.ok) {
        const message =
          body && typeof body === "object" && "message" in body && typeof body.message === "string"
            ? body.message
            : `HTTP ${res.status}`;
        throw new Error(message);
      }
      return body as CsvImportResult;
    },
    onSuccess: invalidate,
  });

  return (
    <>
      <div className="row" style={{ gap: 12, marginTop: "var(--space-8)", alignItems: "center" }}>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => syncMut.mutate()}
          disabled={syncMut.isPending}
        >
          {syncMut.isPending ? t("admin.personioSyncing") : t("admin.personioSync")}
        </button>
        {syncMut.data && (
          <span className="badge badge-success">
            {t("admin.personioSyncResult", {
              total: syncMut.data.total,
              created: syncMut.data.created,
              updated: syncMut.data.updated,
              deactivated: syncMut.data.deactivated,
            })}
          </span>
        )}
        {syncMut.error instanceof Error && (
          <span className="alert alert-error" style={{ padding: "4px 12px" }}>
            {t("admin.personioSyncError", { message: syncMut.error.message })}
          </span>
        )}
      </div>

      <div className="row" style={{ gap: 12, marginTop: "var(--space-2)", alignItems: "center" }}>
        <button
          type="button"
          className="btn btn-outline"
          onClick={() => spSyncMut.mutate()}
          disabled={spSyncMut.isPending}
        >
          {spSyncMut.isPending ? t("admin.sharepointSyncing") : t("admin.sharepointSync")}
        </button>
        {spSyncMut.data && (
          <span className="badge badge-success">
            {spSyncMut.data.skippedNoEmail > 0
              ? t("admin.sharepointSyncResultNoEmail", {
                  total: spSyncMut.data.total,
                  created: spSyncMut.data.created,
                  updated: spSyncMut.data.updated,
                  deactivated: spSyncMut.data.deactivated,
                  skippedNoEmail: spSyncMut.data.skippedNoEmail,
                })
              : t("admin.sharepointSyncResult", {
                  total: spSyncMut.data.total,
                  created: spSyncMut.data.created,
                  updated: spSyncMut.data.updated,
                  deactivated: spSyncMut.data.deactivated,
                })}
          </span>
        )}
        {spSyncMut.error instanceof Error && (
          <span className="alert alert-error" style={{ padding: "4px 12px" }}>
            {t("admin.sharepointSyncError", { message: spSyncMut.error.message })}
          </span>
        )}
      </div>

      <div className="row" style={{ gap: 12, marginTop: "var(--space-2)", alignItems: "center" }}>
        <input
          ref={csvFileRef}
          type="file"
          accept=".csv,text/csv"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) csvImportMut.mutate(file);
          }}
        />
        <button
          type="button"
          className="btn btn-outline"
          onClick={() => csvFileRef.current?.click()}
          disabled={csvImportMut.isPending}
        >
          {csvImportMut.isPending ? t("admin.csvImporting") : t("admin.csvImport")}
        </button>
        {csvImportMut.data && (
          <span className="badge badge-success">
            {csvImportMut.data.skippedNoEmail > 0
              ? t("admin.csvImportResultNoEmail", {
                  total: csvImportMut.data.total,
                  created: csvImportMut.data.created,
                  updated: csvImportMut.data.updated,
                  skippedNoEmail: csvImportMut.data.skippedNoEmail,
                })
              : t("admin.csvImportResult", {
                  total: csvImportMut.data.total,
                  created: csvImportMut.data.created,
                  updated: csvImportMut.data.updated,
                })}
          </span>
        )}
        {csvImportMut.error instanceof Error && (
          <span className="alert alert-error" style={{ padding: "4px 12px" }}>
            {t("admin.csvImportError", { message: csvImportMut.error.message })}
          </span>
        )}
      </div>
      {csvImportMut.data && csvImportMut.data.detectedHeaders.length > 0 && (
        <details style={{ marginTop: "var(--space-2)" }}>
          <summary>
            {t("admin.csvDetectedHeaders", { count: csvImportMut.data.detectedHeaders.length })}
          </summary>
          <code style={{ fontSize: "0.85em" }}>
            {csvImportMut.data.detectedHeaders.join(" · ")}
          </code>
        </details>
      )}
    </>
  );
}
