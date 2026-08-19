import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { apiFetch } from "../api/client";
import { useAuth } from "../auth/auth-context";
import { ROLE_NAMES } from "../auth/types";
import type { AdminUserRow, RoleName } from "../auth/types";
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

export default function AdminUsersPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { hasRole } = useAuth();
  const isAdmin = hasRole("admin");
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "users"],
    queryFn: () => apiFetch<{ users: AdminUserRow[] }>("/admin/users"),
  });

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

  const createMut = useMutation({
    mutationFn: (input: {
      email: string;
      password: string;
      displayName: string;
      roles: RoleName[];
    }) =>
      apiFetch("/admin/users", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: invalidate,
  });

  const toggleActiveMut = useMutation({
    mutationFn: (input: { id: string; isActive: boolean }) =>
      apiFetch(`/admin/users/${input.id}/active`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: input.isActive }),
      }),
    onSuccess: invalidate,
  });

  const addRoleMut = useMutation({
    mutationFn: (input: { id: string; role: RoleName }) =>
      apiFetch(`/admin/users/${input.id}/roles`, {
        method: "POST",
        body: JSON.stringify({ role: input.role }),
      }),
    onSuccess: invalidate,
  });

  const removeRoleMut = useMutation({
    mutationFn: (input: { id: string; role: RoleName }) =>
      apiFetch(`/admin/users/${input.id}/roles/${input.role}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });

  const resetPwMut = useMutation({
    mutationFn: (input: { id: string; newPassword: string }) =>
      apiFetch(`/admin/users/${input.id}/password`, {
        method: "POST",
        body: JSON.stringify({ newPassword: input.newPassword }),
      }),
  });

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="eyebrow">Administration</div>
          <h1 className="page-title">{t("admin.usersTitle")}</h1>
        </div>
      </div>

      <CreateUserForm
        onSubmit={(v) => createMut.mutateAsync(v).catch(() => undefined)}
        pending={createMut.isPending}
        error={createMut.error}
      />

      {isAdmin && (
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
      )}

      {isAdmin && (
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
      )}

      {isAdmin && (
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
      )}
      {isAdmin && csvImportMut.data && csvImportMut.data.detectedHeaders.length > 0 && (
        <details style={{ marginTop: "var(--space-2)" }}>
          <summary>
            {t("admin.csvDetectedHeaders", { count: csvImportMut.data.detectedHeaders.length })}
          </summary>
          <code style={{ fontSize: "0.85em" }}>
            {csvImportMut.data.detectedHeaders.join(" · ")}
          </code>
        </details>
      )}

      <h2 style={{ marginTop: "var(--space-4)" }}>{t("admin.usersListTitle")}</h2>
      {isLoading && <div className="card muted">{t("auth.loading")}</div>}
      {data && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table className="table">
            <thead>
              <tr>
                <th>{t("admin.colEmail")}</th>
                <th>{t("admin.colDisplayName")}</th>
                <th>{t("admin.colRoles")}</th>
                <th>{t("admin.colStatus")}</th>
                <th>{t("admin.colActions")}</th>
              </tr>
            </thead>
            <tbody>
              {data.users.map((u) => (
                <tr key={u.id}>
                  <td className="text-bold">{u.email}</td>
                  <td>
                    {u.displayName}
                    {u.personioId && (
                      <div className="row" style={{ gap: 6, marginTop: 4 }}>
                        <span className="badge badge-cobalt">{t("admin.personioBadge")}</span>
                        {u.department && (
                          <span className="badge badge-outline">{u.department}</span>
                        )}
                      </div>
                    )}
                    {u.sharepointStudiId && (
                      <div className="row" style={{ gap: 6, marginTop: 4 }}>
                        <span className="badge badge-cobalt">{t("admin.sharepointBadge")}</span>
                        {u.team && <span className="badge badge-outline">{u.team}</span>}
                      </div>
                    )}
                    {u.csvImportedAt && (
                      <div className="row" style={{ gap: 6, marginTop: 4 }}>
                        <span className="badge badge-cobalt">{t("admin.csvBadge")}</span>
                      </div>
                    )}
                  </td>
                  <td>
                    <RoleEditor
                      currentRoles={u.roles}
                      onAdd={(role) => addRoleMut.mutate({ id: u.id, role })}
                      onRemove={(role) => removeRoleMut.mutate({ id: u.id, role })}
                    />
                  </td>
                  <td>
                    <span className={u.isActive ? "badge badge-success" : "badge badge-muted"}>
                      {u.isActive ? t("admin.active") : t("admin.inactive")}
                    </span>
                  </td>
                  <td>
                    <div className="row" style={{ gap: "var(--space-2)" }}>
                      <button
                        type="button"
                        onClick={() => toggleActiveMut.mutate({ id: u.id, isActive: !u.isActive })}
                        className="btn btn-outline btn-sm"
                      >
                        {u.isActive ? t("admin.deactivate") : t("admin.activate")}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const pw = window.prompt(t("admin.newPasswordPrompt") ?? "New password");
                          if (pw && pw.length >= 8) {
                            resetPwMut.mutate({ id: u.id, newPassword: pw });
                          }
                        }}
                        className="btn btn-ghost btn-sm"
                      >
                        {t("admin.resetPassword")}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CreateUserForm(props: {
  onSubmit: (v: {
    email: string;
    password: string;
    displayName: string;
    roles: RoleName[];
  }) => void;
  pending: boolean;
  error: unknown;
}) {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<RoleName>("participant");

  function submit(e: FormEvent) {
    e.preventDefault();
    props.onSubmit({ email, password, displayName, roles: [role] });
    setEmail("");
    setDisplayName("");
    setPassword("");
  }

  return (
    <form onSubmit={submit} className="card">
      <h2 className="card-title" style={{ marginTop: 0 }}>
        {t("admin.create")}
      </h2>
      <div className="field-row">
        <div className="field">
          <label className="label" htmlFor="adm-email">
            {t("admin.colEmail")}
          </label>
          <input
            id="adm-email"
            className="input"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="adm-name">
            {t("admin.colDisplayName")}
          </label>
          <input
            id="adm-name"
            className="input"
            type="text"
            required
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label className="label" htmlFor="adm-pw">
            {t("auth.passwordLabel")}
          </label>
          <input
            id="adm-pw"
            className="input"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="adm-role">
            {t("admin.colRoles")}
          </label>
          <select
            id="adm-role"
            className="select"
            value={role}
            onChange={(e) => setRole(e.target.value as RoleName)}
          >
            {ROLE_NAMES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="form-actions">
        <button type="submit" disabled={props.pending} className="btn btn-primary">
          {props.pending ? t("admin.creating") : t("admin.create")}
        </button>
      </div>
      {props.error instanceof Error && (
        <div className="alert alert-error">{props.error.message}</div>
      )}
    </form>
  );
}

function RoleEditor(props: {
  currentRoles: RoleName[];
  onAdd: (role: RoleName) => void;
  onRemove: (role: RoleName) => void;
}) {
  const available = ROLE_NAMES.filter((r) => !props.currentRoles.includes(r));
  return (
    <div className="row" style={{ gap: "var(--space-2)" }}>
      {props.currentRoles.map((r) => (
        <span key={r} className="badge badge-orange" style={{ gap: 4 }}>
          {r}
          <button
            type="button"
            onClick={() => props.onRemove(r)}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 0,
              color: "inherit",
              marginLeft: 4,
            }}
            aria-label={`remove ${r}`}
          >
            ×
          </button>
        </span>
      ))}
      {available.length > 0 && (
        <select
          className="select"
          defaultValue=""
          style={{ width: "auto", fontSize: "var(--text-xs)", padding: "2px 8px" }}
          onChange={(e) => {
            const value = e.target.value;
            if (value) {
              props.onAdd(value as RoleName);
              e.target.value = "";
            }
          }}
        >
          <option value="">+</option>
          {available.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
