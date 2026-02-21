import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import { setOnUnauthorized } from "./api/http";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Quiz from "./pages/Quiz";
import QuizEdit from "./pages/QuizEdit";
import AppLayout from "./layout/AppLayout";

function UnauthHandler() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  useEffect(() => {
    setOnUnauthorized(() => {
      logout();
      navigate("/login", { replace: true });
    });
  }, [logout, navigate]);
  return null;
}

export default function App() {
  return (
    <BrowserRouter>
      <UnauthHandler />
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/login" element={<Login />} />

        <Route element={<AppLayout />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/quiz/:quizId/edit" element={<QuizEdit />} />
          <Route path="/quiz/:quizId" element={<Quiz />} />
        </Route>

        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
