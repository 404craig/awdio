import { useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { SettingsSheet } from "./components/settings/SettingsSheet";
import { Toast } from "./components/Toast";
import { useTheme } from "./hooks/useTheme";
import { Library } from "./screens/Library";
import { Reader } from "./screens/Reader";
import { useSettings } from "./state/settings";
import { useVoices } from "./state/voices";

function Shell() {
  useTheme();

  useEffect(() => {
    void useSettings.getState().load();
    useVoices.getState().load();
  }, []);

  return (
    <>
      <Routes>
        <Route path="/" element={<Library />} />
        <Route path="/d/:id" element={<Reader />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <SettingsSheet />
      <Toast />
    </>
  );
}

/** Router basename follows Vite's base (`/awdio/` on GitHub Pages). */
const basename = import.meta.env.BASE_URL.replace(/\/$/, "") || "/";

export function App() {
  return (
    <BrowserRouter basename={basename} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Shell />
    </BrowserRouter>
  );
}
