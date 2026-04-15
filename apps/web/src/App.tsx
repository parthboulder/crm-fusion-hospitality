/**
 * Root app — routing + auth gate.
 */

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/auth.store';
import { AppShell } from './components/layout/AppShell';
import { LoginPage } from './pages/LoginPage';
import { AuthCallbackPage } from './pages/AuthCallbackPage';
import { DashboardPage } from './pages/DashboardPage';
import { PropertyPage } from './pages/PropertyPage';
import { AdminPage } from './pages/AdminPage';
import { PerformanceHubPage } from './pages/PerformanceHubPage';
import { StoneriverDashboardPage } from './pages/StoneriverDashboardPage';
import { FlashReportDashboardPage } from './pages/FlashReportDashboardPage';
import { EngineeringDashboardPage } from './pages/EngineeringDashboardPage';
import { DocumentsPage } from './pages/DocumentsPage';
import { ScannerPage } from './pages/ScannerPage';
import { OcrUploadsPage } from './pages/OcrUploadsPage';

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
        <Route path="/auth/callback" element={<AuthCallbackPage />} />

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
          <Route path="documents" element={<DocumentsPage />} />
          <Route path="ocr" element={<OcrUploadsPage />} />
          <Route path="admin" element={<AdminPage />} />
          <Route path="stoneriver" element={<PerformanceHubPage />} />
          <Route path="stoneriver/revenue-flash" element={<StoneriverDashboardPage />} />
          <Route path="stoneriver/flash-report" element={<FlashReportDashboardPage />} />
          <Route path="stoneriver/engineering" element={<EngineeringDashboardPage />} />
          <Route path="scanner" element={<ScannerPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
