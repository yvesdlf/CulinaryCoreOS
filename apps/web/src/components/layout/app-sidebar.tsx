import { NavLink, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Package,
  ChefHat,
  Layers,
  ShieldAlert,
  CopyCheck,
  FolderOpen,
  Truck,
  Warehouse,
  ShoppingCart,
  Users,
  ShieldCheck,
  Factory,
  ChartNoAxesCombined,
  Settings,
  UtensilsCrossed,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";

const navItems = [
  { title: "Dashboard", to: "/", icon: LayoutDashboard },
  { title: "Products", to: "/products", icon: Package },
  { title: "Recipes", to: "/recipes", icon: ChefHat },
  { title: "Sub Recipes", to: "/sub-recipes", icon: Layers },
  { title: "Allergen Matrix", to: "/allergen-matrix", icon: ShieldAlert },
  { title: "Collections", to: "/collections", icon: FolderOpen },
  { title: "Suppliers", to: "/suppliers", icon: Truck },
  { title: "Duplicates", to: "/duplicates", icon: CopyCheck },
  { title: "Purchasing", to: "/purchasing", icon: ShoppingCart },
  { title: "People", to: "/people", icon: Users },
  { title: "Inventory", to: "/inventory", icon: Warehouse },
  { title: "Traceability", to: "/traceability", icon: ShieldCheck },
  { title: "Production", to: "/production", icon: Factory },
  { title: "Menu Engineering", to: "/menu-engineering", icon: ChartNoAxesCombined },
  { title: "Settings", to: "/settings", icon: Settings },
];

export function AppSidebar() {
  const location = useLocation();

  function isActive(to: string) {
    if (to === "/") return location.pathname === "/";
    return location.pathname.startsWith(to);
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" tooltip="CulinaryCore">
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <UtensilsCrossed className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">CulinaryCore</span>
                <span className="truncate text-xs text-sidebar-muted">
                  Recipe Management
                </span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent role="navigation" aria-label="Main">
        <SidebarGroup>
          <SidebarGroupLabel>Menu</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    tooltip={item.title}
                    isActive={isActive(item.to)}
                    render={<NavLink to={item.to} />}
                  >
                    <item.icon />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter />
      <SidebarRail />
    </Sidebar>
  );
}
