import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { App } from "./App";
import { hydrateFromSupabase } from "@/stores/persistence";
import "./index.css";

// Kick off before render. The stores already hold the mock catalogue, so the
// UI paints immediately and swaps to real data when this resolves; when no
// credentials are configured it no-ops and the mock data simply stays.
void hydrateFromSupabase();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <TooltipProvider>
        <App />
        <Toaster />
      </TooltipProvider>
    </BrowserRouter>
  </React.StrictMode>
);
