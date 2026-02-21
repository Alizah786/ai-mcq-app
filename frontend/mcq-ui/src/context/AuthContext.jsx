import { createContext, useContext, useState, useCallback, useEffect } from "react";

const STORAGE_KEY = "ai-mcq-auth";
const SELECTED_STUDENT_KEY = "ai-mcq-selected-student-id";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedStudentId, setSelectedStudentIdState] = useState(null);

  const loadStored = useCallback(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data?.token && data?.user) {
        setToken(data.token);
        setUser(data.user);
      }
      const storedStudentId = localStorage.getItem(SELECTED_STUDENT_KEY);
      if (storedStudentId) {
        const n = Number(storedStudentId);
        if (Number.isFinite(n) && n > 0) setSelectedStudentIdState(n);
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStored();
  }, [loadStored]);

  const login = useCallback((newToken, newUser) => {
    setToken(newToken);
    setUser(newUser);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ token: newToken, user: newUser }));
    if (newUser?.role !== "Manager" && newUser?.role !== "Teacher") {
      setSelectedStudentIdState(null);
      localStorage.removeItem(SELECTED_STUDENT_KEY);
    }
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(SELECTED_STUDENT_KEY);
  }, []);

  const setStored = useCallback((newToken, newUser) => {
    setToken(newToken);
    setUser(newUser);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ token: newToken, user: newUser }));
  }, []);

  const setSelectedStudentId = useCallback((studentId) => {
    if (!studentId) {
      setSelectedStudentIdState(null);
      localStorage.removeItem(SELECTED_STUDENT_KEY);
      return;
    }
    const n = Number(studentId);
    if (!Number.isFinite(n) || n <= 0) return;
    setSelectedStudentIdState(n);
    localStorage.setItem(SELECTED_STUDENT_KEY, String(n));
  }, []);

  const value = {
    user,
    token,
    loading,
    isManager: user?.role === "Manager" || user?.role === "Teacher",
    isTeacher: user?.role === "Teacher" || user?.role === "Manager",
    isStudent: user?.role === "Student",
    selectedStudentId,
    setSelectedStudentId,
    login,
    logout,
    setStored,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
