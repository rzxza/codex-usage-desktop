import React from "react";
import ReactDOM from "react-dom/client";
import "./i18n";
import App from "./App";
import { CompactMonitor } from "./components/compact-monitor";
import "./styles.css";


const isCompact = window.location.hash === "#/compact";

if (isCompact) {
  document.documentElement.classList.add("compact-mode");
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isCompact ? <CompactMonitor /> : <App />}
  </React.StrictMode>,
);

