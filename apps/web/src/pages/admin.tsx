import { useTranslation } from "react-i18next";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { ImportPanel } from "../admin/import-panel";
import { UsersPanel } from "../admin/users-panel";
import { useAuth } from "../auth/auth-context";
import BlueprintsPage from "./blueprints";

/**
 * Rahmen fuer den Verwaltungsbereich. Die Reiter tragen ihre eigene
 * Rollenpruefung: Vorlagen stehen auch Werkstudenten offen, Nutzer und Import
 * nur Admins. Deshalb reicht eine Pruefung auf der Route nicht aus.
 */
export default function AdminPage() {
  const { t } = useTranslation();
  const { hasRole } = useAuth();
  const isAdmin = hasRole("admin");
  const mayBlueprints = hasRole("admin", "manager", "event_office", "werkstudent");

  const tabClass = ({ isActive }: { isActive: boolean }) =>
    `btn btn-sm${isActive ? " btn-primary" : " btn-ghost"}`;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="eyebrow">mEXP</div>
          <h1 className="page-title">{t("admin.title")}</h1>
        </div>
      </div>

      <nav className="row" style={{ gap: 8, marginBottom: "var(--space-6)" }}>
        {isAdmin && (
          <NavLink to="/admin/users" className={tabClass}>
            {t("admin.tabUsers")}
          </NavLink>
        )}
        {mayBlueprints && (
          <NavLink to="/admin/blueprints" className={tabClass}>
            {t("admin.tabBlueprints")}
          </NavLink>
        )}
        {isAdmin && (
          <NavLink to="/admin/import" className={tabClass}>
            {t("admin.tabImport")}
          </NavLink>
        )}
      </nav>

      <Routes>
        <Route index element={<Navigate to={isAdmin ? "users" : "blueprints"} replace />} />
        {isAdmin && <Route path="users" element={<UsersPanel />} />}
        {mayBlueprints && <Route path="blueprints" element={<BlueprintsPage />} />}
        {isAdmin && <Route path="import" element={<ImportPanel />} />}
        <Route path="*" element={<Navigate to={isAdmin ? "users" : "blueprints"} replace />} />
      </Routes>
    </div>
  );
}
