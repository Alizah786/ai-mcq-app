import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import { setOnPaymentRequired, setOnUnauthorized } from "./api/http";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import Pricing from "./pages/Pricing";
import Dashboard from "./pages/Dashboard";
import Quiz from "./pages/Quiz";
import QuizEdit from "./pages/QuizEdit";
import StudyToolsCreate from "./pages/StudyToolsCreate";
import StudyToolsList from "./pages/StudyToolsList";
import StudyToolsDetail from "./pages/StudyToolsDetail";
import StudyToolsFlashcards from "./pages/StudyToolsFlashcards";
import MyResults from "./pages/MyResults";
import AssignedQuizzes from "./pages/AssignedQuizzes";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import ChangePassword from "./pages/ChangePassword";
import Profile from "./pages/Profile";
import RecoverUserName from "./pages/RecoverUserName";
import BillingSuccess from "./pages/BillingSuccess";
import AppLayout from "./layout/AppLayout";
import AdminAnalytics from "./pages/AdminAnalytics";

function UnauthHandler() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  useEffect(() => {
    setOnUnauthorized(() => {
      logout();
      navigate("/login", { replace: true });
    });
    setOnPaymentRequired((payload) => {
      const email = payload?.email || "";
      const role = payload?.role || "Student";
      const message = payload?.message || "";
      if (message) {
        try { window.alert(message); } catch {}
      }
      const query = new URLSearchParams();
      if (email) query.set("email", email);
      if (role) query.set("role", role);
      if (message) query.set("message", message);
      navigate(`/pricing${query.toString() ? `?${query.toString()}` : ""}`, { replace: true });
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
        <Route path="/signup" element={<Signup />} />
        <Route path="/pricing" element={<Pricing />} />
        <Route path="/billing/success" element={<BillingSuccess />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/recover-username" element={<RecoverUserName />} />
        <Route path="/reset-password" element={<ResetPassword />} />

        <Route element={<AppLayout />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/assigned-quizzes" element={<AssignedQuizzes />} />
          <Route path="/results" element={<MyResults />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/change-password" element={<ChangePassword />} />
          <Route path="/quiz/:quizId/edit" element={<QuizEdit />} />
          <Route path="/quiz/:quizId" element={<Quiz />} />
          <Route path="/study-tools" element={<StudyToolsList />} />
          <Route path="/study-tools/create" element={<StudyToolsCreate />} />
          <Route path="/study-tools/:id" element={<StudyToolsDetail />} />
          <Route path="/study-tools/:id/flashcards" element={<StudyToolsFlashcards />} />
          <Route path="/admin/analytics" element={<AdminAnalytics />} />
        </Route>

        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
