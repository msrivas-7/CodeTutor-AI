// Dev-only pre-hydration bootstrap MUST be the very first import so that any
// frozen active profile re-applies its seed before the zustand-backed stores
// (aiStore, progressStore, themeStore) read localStorage at module eval.
// Stripped from prod by import.meta.env.DEV dead-code elimination.
import "./__dev__/bootstrap";

import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";

// Dev-only global keyboard shortcut. The import is guarded by
// import.meta.env.DEV so Vite tree-shakes the whole __dev__ folder in prod.
const DevShortcut = import.meta.env.DEV
  ? (await import("./__dev__/DevShortcut")).DevShortcut
  : () => null;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
      <DevShortcut />
    </BrowserRouter>
  </React.StrictMode>
);
