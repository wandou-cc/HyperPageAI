import React from "react";
import ReactDOM from "react-dom/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import "../../assets/tailwind.css";
import { DocumentsPage } from "./DocumentsPage";

const container = document.getElementById("root");
if (!container) throw new Error("documentsRootUnavailable");
ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <TooltipProvider delay={350}>
      <DocumentsPage embedded={window.self !== window.top} />
    </TooltipProvider>
  </React.StrictMode>,
);
