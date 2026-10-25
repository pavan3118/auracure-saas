import { PatientPortal } from "./PatientPortal";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./auth";
import {
  Login,
  Onboarding,
  SecurityGate,
  Invite,
  Recover,
  PatientLink,
  PatientActivate,
  PatientOtpRequest,
} from "./PublicPages";
import { Workspace } from "./Workspace";
export function App() {
  const auth = useAuth();
  if (auth.loading)
    return (
      <main className="loading" role="status">
        Opening your workspace…
      </main>
    );
  return (
    <BrowserRouter>
      {auth.result &&
      (auth.result.purpose !== "access" || auth.result.recovery_codes) ? (
        <SecurityGate />
      ) : auth.me ? (
        <Routes>
          <Route
            path="/"
            element={
              auth.me.user.role === "PATIENT" ? (
                <PatientPortal />
              ) : (
                <Workspace />
              )
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      ) : (
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/onboarding" element={<Onboarding />} />
          <Route path="/invite" element={<Invite />} />
          <Route path="/recover" element={<Recover />} />
          <Route path="/patient-link" element={<PatientLink />} />
          <Route path="/patient-activate" element={<PatientActivate />} />
          <Route path="/patient-sign-in" element={<PatientOtpRequest />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      )}
    </BrowserRouter>
  );
}
