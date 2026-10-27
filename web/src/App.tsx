import { useEffect, useRef } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { getConfig, setLockedHandler } from "./api";
import { SettingsSheet } from "./components/settings/SettingsSheet";
import { Toast } from "./components/Toast";
import { useTheme } from "./hooks/useTheme";
import { Library } from "./screens/Library";
import { Reader } from "./screens/Reader";
import { Unlock } from "./screens/Unlock";
import { useSettings } from "./state/settings";

function Shell() {
  const navigate = useNavigate();
  const location = useLocation();
  const path = useRef(location.pathname);
  path.current = location.pathname;
  useTheme();

  useEffect(() => {
    const toUnlock = () => {
      if (path.current !== "/unlock") navigate("/unlock", { replace: true, state: { from: path.current } });
    };
    setLockedHandler(toUnlock);
    getConfig()
      .then((config) => {
        if (config.accessPinRequired && !config.unlocked) toUnlock();
        else void useSettings.getState().load();
      })
      .catch(() => void useSettings.getState().load());
  }, [navigate]);

  return (
    <>
      <Routes>
        <Route path="/" element={<Library />} />
        <Route path="/d/:id" element={<Reader />} />
        <Route path="/unlock" element={<Unlock />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <SettingsSheet />
      <Toast />
    </>
  );
}

export function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Shell />
    </BrowserRouter>
  );
}
