import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider } from "./auth/auth-context";
import { ProtectedRoute } from "./auth/protected-route";
import { BASE_PATH } from "./base-path";
import { Sidebar } from "./components/sidebar";
import AdminUsersPage from "./pages/admin-users";
import BlueprintsPage from "./pages/blueprints";
import DashboardPage from "./pages/dashboard";
import EventCreatePage from "./pages/event-create";
import EventDetailPage from "./pages/event-detail";
import EventsListPage from "./pages/events-list";
import HomePage from "./pages/home";
import ReportsPage from "./pages/reports";
import VendorPage from "./pages/vendor";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

function AppRoutes() {
  return (
    <Routes>
      {/* Anbieter-Landingpage — öffentlich, Auth via Token in URL */}
      <Route path="/vendor" element={<VendorPage />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <HomePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute roles={["admin", "manager", "event_office"]}>
            <DashboardPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/events"
        element={
          <ProtectedRoute>
            <EventsListPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/events/new"
        element={
          <ProtectedRoute roles={["admin", "manager", "event_office", "werkstudent"]}>
            <EventCreatePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/events/:id"
        element={
          <ProtectedRoute>
            <EventDetailPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/reports"
        element={
          <ProtectedRoute roles={["admin", "manager", "event_office"]}>
            <ReportsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/blueprints"
        element={
          <ProtectedRoute roles={["admin", "manager", "event_office", "werkstudent"]}>
            <BlueprintsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/users"
        element={
          <ProtectedRoute roles={["admin"]}>
            <AdminUsersPage />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function Shell() {
  const location = useLocation();
  const isVendor = location.pathname === "/vendor";

  if (isVendor) {
    return <AppRoutes />;
  }

  return (
    <div className="ms-app-layout">
      <Sidebar />
      <div className="ms-app-content">
        <AppRoutes />
      </div>
    </div>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      {/* basename: hinter dem Agent Hub liegt die App unter /<slug>/. Ohne den
          Präfix schreibt der Router wurzel-absolute Pfade in die Adresszeile und
          der Slug geht bei der ersten Navigation verloren. */}
      <BrowserRouter basename={BASE_PATH}>
        <AuthProvider>
          <Shell />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
