import { Suspense, lazy } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ToastProvider } from "./components/Toast";
import { AuthPage } from "./pages/AuthPage";
import { LandingPage } from "./pages/LandingPage";
import { MenuPage } from "./pages/MenuPage";
import { ScanPage } from "./pages/ScanPage";

const DashboardPage = lazy(() =>
  import("./pages/DashboardPage").then((m) => ({ default: m.DashboardPage }))
);
const KitchenPage = lazy(() =>
  import("./pages/KitchenPage").then((m) => ({ default: m.KitchenPage }))
);
const SuperAdminPage = lazy(() =>
  import("./pages/SuperAdminPage").then((m) => ({ default: m.SuperAdminPage }))
);
const ReservePage = lazy(() =>
  import("./pages/ReservePage").then((m) => ({ default: m.ReservePage }))
);

function RouteFallback() {
  return (
    <div className="min-h-screen bg-[var(--qm-bg)] flex items-center justify-center">
      <p className="font-display text-2xl text-[var(--qm-muted)]">Loading...</p>
    </div>
  );
}

export function App() {
  return (
    <ToastProvider>
      <BrowserRouter>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/auth" element={<AuthPage />} />
            <Route path="/super-admin" element={<SuperAdminPage />} />
            <Route path="/scan" element={<ScanPage />} />
            <Route path="/menu" element={<MenuPage />} />
            <Route path="/reserve" element={<ReservePage />} />
            <Route path="/r/:slug/scan" element={<ScanPage />} />
            <Route path="/r/:slug/menu" element={<MenuPage />} />
            <Route path="/r/:slug/reserve" element={<ReservePage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/kitchen" element={<KitchenPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ToastProvider>
  );
}

export default App;
