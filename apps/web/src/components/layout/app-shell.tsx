import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "./app-sidebar";
import { AppHeader } from "./app-header";
import { Outlet } from "react-router-dom";
import { useCatalogueRefresh } from "@/hooks/use-catalogue-refresh";
import { useCatalogueLive } from "@/hooks/use-catalogue-live";
import { Assistant } from "@/components/ai/assistant";
import { MockDataBanner } from "./mock-data-banner";

export function AppShell() {
  // Mounted once, at the shell, so every page benefits without each one
  // remembering to ask.
  useCatalogueRefresh();
  // And the live half: the focus refresh is what catches up when somebody
  // comes back to the tab, this is what keeps them current while they stay.
  useCatalogueLive();

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        {/* Above the header, so it is on every screen and cannot be
            scrolled away. Renders nothing when a database is configured. */}
        <MockDataBanner />
        <AppHeader />
        {/* SidebarInset renders the <main> landmark; this is only the
            scroll container, so it must not be another one. */}
        <div className="flex-1 overflow-auto p-6">
          <Outlet />
          {/* Every page. The panel knows which one from the route. */}
          <Assistant />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
