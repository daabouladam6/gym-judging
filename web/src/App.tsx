import { Navigate, Route, Routes } from "react-router-dom";
import { SessionProvider, useSession } from "./auth/SessionProvider";
import { AdminPage } from "./pages/AdminPage";
import { JudgePage } from "./pages/JudgePage";
import { LoginPage } from "./pages/LoginPage";

function HomeRedirect() {
  const session = useSession();
  if (!session.hydrated) return null;
  if (session.user?.role === "ADMIN") return <Navigate to="/admin" replace />;
  if (session.user?.role === "JUDGE") return <Navigate to="/judge" replace />;
  return <Navigate to="/login" replace />;
}

export function App() {
  return (
    <SessionProvider>
      <Routes>
        <Route path="/" element={<HomeRedirect />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/judge" element={<JudgePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </SessionProvider>
  );
}
