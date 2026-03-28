/**
 * Root app — routing + auth gate.
 */

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/auth.store';
import { AppShell } from './components/layout/AppShell';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { PropertyPage } from './pages/PropertyPage';
import { ReportsPage } from './pages/ReportsPage';
import { AlertsPage } from './pages/AlertsPage';
import { TasksPage } from './pages/TasksPage';
import { AdminPage } from './pages/AdminPage';
import { StoneriverDashboardPage } from './pages/StoneriverDashboardPage';
import { DocumentsPage } from './pages/DocumentsPage';
import { BatchReviewPage } from './pages/BatchReviewPage';
import { ScannerPage } from './pages/ScannerPage';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        <Route
          path="/"
          element={
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          }
        >
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="properties/:id" element={<PropertyPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="documents" element={<DocumentsPage />} />
          <Route path="batch-review" element={<BatchReviewPage />} />
          <Route path="alerts" element={<AlertsPage />} />
          <Route path="tasks" element={<TasksPage />} />
          <Route path="admin" element={<AdminPage />} />
          <Route path="stoneriver" element={<StoneriverDashboardPage />} />
          <Route path="scanner" element={<ScannerPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
