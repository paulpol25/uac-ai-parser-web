import { Routes, Route, Navigate } from "react-router-dom";
import { Layout } from "@/components/ui/Layout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { Login } from "@/pages/Login";
import { Dashboard } from "@/pages/Dashboard";
import { Investigations } from "@/pages/Investigations";
import { Query } from "@/pages/Query";
import { Timeline } from "@/pages/Timeline";
import { Search } from "@/pages/Search";
import { Export } from "@/pages/Export";
import { Settings } from "@/pages/Settings";
import { Analysis } from "@/pages/Analysis";
import { Agents } from "@/pages/Agents";
import { YaraRules } from "@/pages/YaraRules";
import { Documentation } from "@/pages/Documentation";
import { useAuthStore } from "@/stores/authStore";

export default function App() {
  const { isAuthenticated } = useAuthStore();

  return (
    <ErrorBoundary>
      <Routes>
        <Route
          path="/login"
          element={isAuthenticated ? <Navigate to="/" replace /> : <Login />}
        />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="investigations" element={<Investigations />} />
          <Route path="query" element={<Query />} />
          <Route path="timeline" element={<Timeline />} />
          <Route path="search" element={<Search />} />
          <Route path="export" element={<Export />} />
          <Route path="analysis" element={<Analysis />} />
          <Route path="agents" element={<Agents />} />
          <Route path="yara-rules" element={<YaraRules />} />
          <Route path="docs" element={<Documentation />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Routes>
    </ErrorBoundary>
  );
}
