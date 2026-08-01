import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { App } from "./App";
import "./index.css";
import { initTheme } from "@/lib/theme";

// Before render, so the first paint is the right theme rather than a flash
// of light followed by a correction.
initTheme();

// Hydration is deliberately NOT kicked off here. RLS scopes every row to the
// caller's organization, so a fetch before sign-in returns nothing but a
// permission error. The auth store loads the data once a session exists.

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
