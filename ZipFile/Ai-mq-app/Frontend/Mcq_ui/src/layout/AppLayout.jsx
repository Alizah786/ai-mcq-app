import { Outlet, Navigate } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import { useAuth } from "../context/AuthContext";
import { SidebarRefreshProvider } from "../context/SidebarRefreshContext";

export default function AppLayout() {
  // For now: assume logged-in; later we’ll enforce JWT
  const { token, loading } = useAuth();
  if (loading) return <div style={{ padding: 24 }}>Loading...</div>;
  if (!token) return <Navigate to="/login" replace />;
  return (
    <SidebarRefreshProvider>
      <div style={{ display: "flex", minHeight: "100vh" }}>
        <Sidebar />
        <main style={{ flex: 1, padding: 24, background: "#f6f8fc" }}>
          <Outlet />
        </main>
      </div>
    </SidebarRefreshProvider>
  );
}
