import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "./app-sidebar";
import { AppHeader } from "./app-header";
import { Outlet } from "react-router-dom";
import { useCatalogueRefresh } from "@/hooks/use-catalogue-refresh";

export function AppShell() {
  // Mounted once, at the shell, so every page benefits without each one
  // remembering to ask.
  useCatalogueRefresh();

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <AppHeader />
        {/* SidebarInset renders the <main> landmark; this is only the
            scroll container, so it must not be another one. */}
        <div className="flex-1 overflow-auto p-6">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
