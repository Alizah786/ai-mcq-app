import { useEffect, useMemo, useState } from "react";
import { Outlet, Navigate, useNavigate, useLocation } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import AdRail from "../components/AdRail";
import BrandLogo from "../components/BrandLogo";
import { useAuth } from "../context/AuthContext";
import { SidebarRefreshProvider, useSidebarRefresh } from "../context/SidebarRefreshContext";
import { apiGet } from "../api/http";
import { useUIText } from "../context/UITextContext";

function HeaderInfo({ user, isMobile, hidePlanDetails = false }) {
  const { isManager, selectedStudentId } = useAuth();
  const { refreshKey } = useSidebarRefresh();
  const { loadCategoryKeys, t } = useUIText();
  const [students, setStudents] = useState([]);
  const [subscription, setSubscription] = useState(null);

  useEffect(() => {
    loadCategoryKeys("UI_LABEL", [
      "layout.header.role",
      "layout.header.currentStudent",
      "layout.header.user",
      "layout.header.planDetails",
    ]).catch(() => {});
  }, [loadCategoryKeys]);

  useEffect(() => {
    let alive = true;
    async function loadStudents() {
      if (!isManager) {
        setStudents([]);
        return;
      }
      try {
        const res = await apiGet("/api/teacher/students");
        if (!alive) return;
        setStudents(res.students || []);
      } catch {
        if (!alive) return;
        setStudents([]);
      }
    }
    loadStudents();
    return () => {
      alive = false;
    };
  }, [isManager, refreshKey, user?.userId]);

  useEffect(() => {
    let alive = true;
    async function loadSubscription() {
      if (user?.role === "AppAdmin") {
        if (!alive) return;
        setSubscription(null);
        return;
      }
      try {
        const res = await apiGet("/api/billing/subscription-status");
        if (!alive) return;
        setSubscription(res.subscription || null);
      } catch {
        if (!alive) return;
        setSubscription(null);
      }
    }
    loadSubscription();
    return () => {
      alive = false;
    };
  }, [refreshKey, user?.userId, user?.role]);

  const roleLabel = user?.role === "Manager" ? "Teacher" : (user?.role || "User");
  const selectedStudent = useMemo(
    () => students.find((s) => Number(s.studentId) === Number(selectedStudentId)) || null,
    [students, selectedStudentId]
  );
  const studentName = isManager
    ? (selectedStudent?.studentCode || "Select student")
    : (user?.displayName || "User");
  const studentSubtext = isManager ? (selectedStudent?.userName || "") : (user?.teacherUserName || "");
  const planName = subscription?.planName || (user?.role === "Student" ? "Student" : "Teacher");

  const chipStyle = {
    display: "flex",
    alignItems: "center",
    gap: 10,
    minHeight: 48,
    padding: isMobile ? "8px 10px" : "10px 12px",
    borderRadius: 16,
    border: "1px solid #dbe3ef",
    background: "#f6f8fc",
    color: "#24324a",
  };

  const labelStyle = {
    color: "#7a88a1",
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginBottom: 2,
  };

  const valueStyle = {
    color: "#142033",
    fontSize: isMobile ? 13 : 14,
    fontWeight: 800,
    lineHeight: 1.1,
  };

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 10,
        flex: isMobile ? "1 1 100%" : "1 1 auto",
        minWidth: 0,
      }}
    >
      <div style={{ ...chipStyle, minWidth: isMobile ? 0 : 142 }}>
        <div>
          <div style={labelStyle}>{t("layout.header.role", "Role")}</div>
          <div style={valueStyle}>{roleLabel}</div>
        </div>
      </div>

      <div style={{ ...chipStyle, minWidth: isMobile ? 0 : 218, flex: "1 1 220px" }}>
        <div>
          <div style={labelStyle}>{isManager ? t("layout.header.currentStudent", "Current Student") : t("layout.header.user", "User")}</div>
          <div style={valueStyle}>{studentName}</div>
          {!!studentSubtext && (
            <div style={{ color: "#6b7890", fontSize: 12, fontWeight: 700, marginTop: 3 }}>
              {studentSubtext}
            </div>
          )}
        </div>
      </div>

      {!!subscription && !hidePlanDetails && (
        <div style={{ ...chipStyle, minWidth: isMobile ? 0 : 260, flex: "1 1 260px" }}>
          <div>
            <div style={labelStyle}>{t("layout.header.planDetails", "Plan Details")}</div>
            <div style={valueStyle}>{planName}</div>
          </div>
        </div>
      )}
    </div>
  );
}

function LayoutShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const { token, loading, user, logout } = useAuth();
  const { loadCategoryKeys, t } = useUIText();
  const [isMobile, setIsMobile] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const adsEnabled =
    import.meta.env.DEV || String(import.meta.env.VITE_ENABLE_ADS || "").toLowerCase() === "true";
  const isStudent = user?.role === "Student";
  const isTeacher = user?.role === "Teacher";
  const isAssignedStudent =
    user?.role === "Student" &&
    Number(user?.managerId || 0) > 0 &&
    !user?.isDirectStudent;
  const isAssignedStudentFocusedRoute =
    isAssignedStudent &&
    (location.pathname === "/assigned-quizzes" || /^\/quiz\/[^/]+$/.test(location.pathname));
  const hideSidebarChrome = isAssignedStudentFocusedRoute;
  const showUpgradeButton = isTeacher || isStudent;

  useEffect(() => {
    loadCategoryKeys("UI_LABEL", [
      "layout.search.placeholder",
      "layout.upgrade.button",
      "layout.menu.button",
      "layout.brand.title",
      "layout.logout.button",
    ]).catch(() => {});
  }, [loadCategoryKeys]);

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

  useEffect(() => {
    if (isMobile) return;
    try {
      const saved = localStorage.getItem("sidebarCollapsed");
      if (saved === "1") setSidebarCollapsed(true);
    } catch {}
  }, [isMobile]);

  function toggleSidebar() {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("sidebarCollapsed", next ? "1" : "0");
      } catch {}
      return next;
    });
  }

  if (loading) return <div style={{ padding: 24 }}>Loading...</div>;
  if (!token) return <Navigate to="/login" replace />;
  if (user?.mustChangePassword && location.pathname !== "/change-password") {
    return <Navigate to="/change-password" replace />;
  }

  function handleLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  return (
    <>
      {!isMobile ? (
        <div style={{ display: "flex", height: "100vh", overflow: "hidden", background: "#f6f8fc" }}>
          {!hideSidebarChrome && !sidebarCollapsed && (
            <div style={{ height: "100vh", overflowY: "auto", flexShrink: 0 }}>
              <Sidebar searchQuery={searchQuery} />
            </div>
          )}
          {!hideSidebarChrome && (
            <div
              onClick={toggleSidebar}
              title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              style={{
                width: 18,
                minWidth: 18,
                height: "100vh",
                overflow: "hidden",
                borderRight: "1px solid #e5e7eb",
                background: "#f3f5f9",
                cursor: "pointer",
                position: "relative",
                userSelect: "none",
              }}
            >
              <div
                style={{
                  position: "sticky",
                  top: "50vh",
                  transform: "translateY(-50%)",
                  display: "grid",
                  placeItems: "center",
                  width: 18,
                  height: 64,
                  border: "1px solid #3046f6",
                  borderRight: "none",
                  borderRadius: "10px 0 0 10px",
                  background: "#4255ff",
                  color: "#ffffff",
                  fontSize: 14,
                  fontWeight: 800,
                  lineHeight: 1,
                }}
              >
                {sidebarCollapsed ? ">" : "<"}
              </div>
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
            <header
              style={{
                minHeight: 84,
                background: "#ffffff",
                borderBottom: "1px solid #e5e7eb",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "10px 22px",
                position: "sticky",
                top: 0,
                zIndex: 15,
              }}
            >
              <div style={{ width: "100%", maxWidth: 1760, display: "flex", alignItems: "center", gap: 14 }}>
                <HeaderInfo user={user} isMobile={false} hidePlanDetails={hideSidebarChrome} />
                {!hideSidebarChrome && (
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={t("layout.search.placeholder", "Search quizzes, classes, topics...")}
                    style={{
                      flex: "0 0 26%",
                      minWidth: 220,
                      marginLeft: "auto",
                      border: "1px solid #e5e7eb",
                      background: "#f4f6fb",
                      borderRadius: 12,
                      padding: "12px 14px",
                      color: "#111827",
                      fontSize: 15,
                      fontWeight: 600,
                    }}
                  />
                )}
                {showUpgradeButton && !hideSidebarChrome && (
                  <button
                    type="button"
                    onClick={() => navigate("/pricing")}
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
                    {t("layout.upgrade.button", "Upgrade")}
                  </button>
                )}
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 4,
                    minWidth: 88,
                    textAlign: "center",
                  }}
                >
                  <div style={{ color: "#4b5563", fontWeight: 700, fontSize: 14 }}>{user?.displayName || "User"}</div>
                  <button
                    type="button"
                    onClick={handleLogout}
                    style={{
                      border: "1px solid #d1d5db",
                      background: "#fff",
                      color: "#334155",
                      borderRadius: 999,
                      fontWeight: 700,
                      padding: "6px 12px",
                      cursor: "pointer",
                      fontSize: 13,
                    }}
                  >
                    {t("layout.logout.button", "Logout")}
                  </button>
                </div>
              </div>
            </header>

            <main style={{ flex: 1, padding: "28px 34px", overflowY: "auto" }}>
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
              minHeight: 58,
              background: "#ffffff",
              borderBottom: "1px solid #e5e7eb",
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 12,
              padding: "10px 14px",
              position: "sticky",
              top: 0,
              zIndex: 20,
            }}
          >
            {!hideSidebarChrome && (
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
                {t("layout.menu.button", "Menu")}
              </button>
            )}
            <div style={{ marginRight: "auto" }}>
              <BrandLogo compact />
            </div>
            <HeaderInfo user={user} isMobile hidePlanDetails={hideSidebarChrome} />
            <button
              type="button"
              onClick={handleLogout}
              style={{
                border: "1px solid #d1d5db",
                background: "#fff",
                color: "#334155",
                borderRadius: 999,
                fontWeight: 700,
                padding: "7px 12px",
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              {t("layout.logout.button", "Logout")}
            </button>
          </header>

          {drawerOpen && !hideSidebarChrome && (
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
    </>
  );
}

export default function AppLayout() {
  return (
    <SidebarRefreshProvider>
      <LayoutShell />
    </SidebarRefreshProvider>
  );
}
