import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { registerSW } from "virtual:pwa-register";
import { App } from "./App";
import "./index.css";

/** Do not auto-reload mid-event — avoids kicking judges/admins out of their tab. */
registerSW({
  immediate: true,
  onNeedRefresh() {
    /* User can hard-refresh when convenient. */
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
