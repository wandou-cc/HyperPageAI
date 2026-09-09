import React from "react";
import ReactDOM from "react-dom/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import "../../assets/tailwind.css";
import { SettingsPage } from "./SettingsPage";

const container = document.getElementById("root");
if (!container) throw new Error("settingsRootUnavailable");
ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <TooltipProvider delay={350}>
      <SettingsPage />
    </TooltipProvider>
  </React.StrictMode>,
);
