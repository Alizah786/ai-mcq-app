import { useEffect, useState } from "react";
import { Outlet, Navigate } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import AdRail from "../components/AdRail";
import { useAuth } from "../context/AuthContext";
import { SidebarRefreshProvider } from "../context/SidebarRefreshContext";

export default function AppLayout() {
  const { token, loading, user } = useAuth();
  const [isMobile, setIsMobile] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const adsEnabled =
    import.meta.env.DEV || String(import.meta.env.VITE_ENABLE_ADS || "").toLowerCase() === "true";

  useEffect(() => {
    function update() {
      setIsMobile(window.innerWidth < 900);
    }
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    if (!isMobile) setDrawerOpen(false);
  }, [isMobile]);

  if (loading) return <div style={{ padding: 24 }}>Loading...</div>;
  if (!token) return <Navigate to="/login" replace />;

  return (
    <SidebarRefreshProvider>
      {!isMobile ? (
        <div style={{ display: "flex", minHeight: "100vh", background: "#f6f8fc" }}>
          <Sidebar searchQuery={searchQuery} />
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
            <header
              style={{
                height: 68,
                background: "#ffffff",
                borderBottom: "1px solid #e5e7eb",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "0 22px",
                position: "sticky",
                top: 0,
                zIndex: 15,
              }}
            >
              <div style={{ width: "100%", maxWidth: 1760, display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{ fontWeight: 800, color: "#31425f", fontSize: 18 }}>Q</div>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search quizzes, classes, topics..."
                  style={{
                    flex: 1,
                    border: "1px solid #e5e7eb",
                    background: "#f4f6fb",
                    borderRadius: 12,
                    padding: "12px 14px",
                    color: "#111827",
                    fontSize: 15,
                    fontWeight: 600,
                  }}
                />
                <button
                  type="button"
                  style={{
                    border: "none",
                    background: "#4255ff",
                    color: "#fff",
                    borderRadius: 999,
                    fontWeight: 700,
                    padding: "9px 14px",
                    cursor: "pointer",
                  }}
                >
                  +
                </button>
                <div style={{ color: "#4b5563", fontWeight: 700, fontSize: 14 }}>{user?.displayName || "User"}</div>
              </div>
            </header>

            <main style={{ flex: 1, padding: "28px 34px" }}>
              <div style={{ width: "100%", maxWidth: 1760, margin: "0 auto", display: "flex", gap: 24 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Outlet />
                </div>
                {adsEnabled && <AdRail />}
              </div>
            </main>
          </div>
        </div>
      ) : (
        <div style={{ minHeight: "100vh", background: "#f6f8fc" }}>
          <header
            style={{
              height: 58,
              background: "#ffffff",
              borderBottom: "1px solid #e5e7eb",
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "0 14px",
              position: "sticky",
              top: 0,
              zIndex: 20,
            }}
          >
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              style={{
                border: "1px solid #e5e7eb",
                background: "#fff",
                borderRadius: 8,
                minWidth: 52,
                height: 36,
                cursor: "pointer",
                fontSize: 13,
                lineHeight: 1,
                padding: "0 10px",
              }}
            >
              Menu
            </button>
            <div style={{ fontWeight: 700, color: "#111827" }}>AI MCQ Classroom</div>
          </header>

          {drawerOpen && (
            <>
              <div
                onClick={() => setDrawerOpen(false)}
                style={{
                  position: "fixed",
                  inset: 0,
                  background: "rgba(17,24,39,0.36)",
                  zIndex: 30,
                }}
              />
              <div
                style={{
                  position: "fixed",
                  top: 0,
                  left: 0,
                  zIndex: 31,
                  boxShadow: "0 10px 35px rgba(0,0,0,0.22)",
                }}
              >
                <Sidebar isMobile searchQuery={searchQuery} onNavigate={() => setDrawerOpen(false)} />
              </div>
            </>
          )}

          <main style={{ padding: 14 }}>
            <Outlet />
          </main>
        </div>
      )}
    </SidebarRefreshProvider>
  );
}
