import { useTranslation } from "react-i18next";
import { NavLink } from "react-router-dom";
import logoUrl from "../assets/logo-mindsquare.png";
import { useAuth } from "../auth/auth-context";

export function Sidebar() {
  const { t, i18n } = useTranslation();
  const { user, hasRole } = useAuth();

  // Admins/Manager/EventOffice sehen die KPI-Dashboard-Seite als Startseite,
  // normale Teilnehmer sehen ihre persönliche Home-Seite ("Hallo, ...").
  // Logo + erster Sidebar-Menüpunkt führen beide zum jeweils passenden Ziel —
  // so gibt's genau EIN Dashboard pro User statt zwei parallel.
  const isPrivileged = hasRole("admin", "manager", "event_office");
  const homeRoute = isPrivileged ? "/dashboard" : "/";
  const homeLabel = isPrivileged
    ? t("dashboard.navLink")
    : i18n.language === "de"
      ? "Startseite"
      : "Home";

  return (
    <aside className="ms-sidebar">
      <NavLink to={homeRoute} className="ms-sidebar-logo">
        <img src={logoUrl} alt="mindsquare" />
        <span className="ms-sidebar-logo-sub">mEXP</span>
      </NavLink>

      <nav className="ms-sidebar-nav">
        {user && (
          <NavLink
            to={homeRoute}
            end
            className={({ isActive }) => `ms-sidebar-link${isActive ? " active" : ""}`}
          >
            <span className="ms-sidebar-icon" aria-hidden="true">
              🏠
            </span>
            {homeLabel}
          </NavLink>
        )}
        {user && (
          <NavLink
            to="/events"
            className={({ isActive }) => `ms-sidebar-link${isActive ? " active" : ""}`}
          >
            <span className="ms-sidebar-icon" aria-hidden="true">
              📅
            </span>
            {t("events.navLink")}
          </NavLink>
        )}
        {hasRole("admin", "manager", "event_office") && (
          <NavLink
            to="/reports"
            className={({ isActive }) => `ms-sidebar-link${isActive ? " active" : ""}`}
          >
            <span className="ms-sidebar-icon" aria-hidden="true">
              📊
            </span>
            Reports
          </NavLink>
        )}
        {hasRole("admin", "manager", "event_office", "werkstudent") && (
          <NavLink
            to="/blueprints"
            className={({ isActive }) => `ms-sidebar-link${isActive ? " active" : ""}`}
          >
            <span className="ms-sidebar-icon" aria-hidden="true">
              📋
            </span>
            {t("blueprints.navLink")}
          </NavLink>
        )}
        {hasRole("admin") && (
          <NavLink
            to="/admin/users"
            className={({ isActive }) => `ms-sidebar-link${isActive ? " active" : ""}`}
          >
            <span className="ms-sidebar-icon" aria-hidden="true">
              👥
            </span>
            {t("admin.usersLink")}
          </NavLink>
        )}
      </nav>

      <div className="ms-sidebar-footer">
        {user && (
          <div className="ms-sidebar-user">
            <span className="ms-sidebar-user-avatar" aria-hidden="true" />
            <span className="ms-sidebar-user-name">{user.name}</span>
          </div>
        )}
        <div className="ms-sidebar-actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => i18n.changeLanguage(i18n.language === "de" ? "en" : "de")}
          >
            {i18n.language === "de" ? "EN" : "DE"}
          </button>
          {user && (
            <a href="/auth/logout" className="btn btn-outline btn-sm">
              {t("auth.logout")}
            </a>
          )}
        </div>
      </div>
    </aside>
  );
}
