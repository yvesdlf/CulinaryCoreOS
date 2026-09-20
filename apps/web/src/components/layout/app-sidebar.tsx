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
  SprayCan,
  Wrench,
  BedDouble,
  Factory,
  ChartNoAxesCombined,
  Settings,
  ShieldUser,
  Inbox,
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

/*
 * Grouped by what somebody is doing, not by when the section was built.
 *
 * Twenty items in one flat list is past what anybody scans; by the end it was
 * ordered by the date each section shipped, which is the one ordering no user
 * has a reason to know. The six groups are the questions people actually
 * arrive with: what is happening today, what we cook, what we buy, what we
 * run, who works here, and how the place is set up.
 *
 * Deliberately not collapsible. A collapsed group hides where something is
 * from the person who least knows where it is, and the whole list still fits
 * on a laptop screen.
 *
 * These are labels and destinations only. What a person may actually open is
 * the access grid's business, and hiding a link is not authorisation — the
 * database refuses the write regardless.
 */
interface NavItem {
  title: string;
  to: string;
  icon: typeof LayoutDashboard;
}

const navGroups: { label: string; items: NavItem[] }[] = [
  {
    label: "Today",
    items: [
      { title: "Dashboard", to: "/", icon: LayoutDashboard },
      { title: "Messages", to: "/messages", icon: Inbox },
    ],
  },
  {
    label: "Culinary",
    items: [
      { title: "Recipes", to: "/recipes", icon: ChefHat },
      { title: "Sub Recipes", to: "/sub-recipes", icon: Layers },
      { title: "Products", to: "/products", icon: Package },
      { title: "Collections", to: "/collections", icon: FolderOpen },
      { title: "Allergen Matrix", to: "/allergen-matrix", icon: ShieldAlert },
      { title: "Menu Engineering", to: "/menu-engineering", icon: ChartNoAxesCombined },
    ],
  },
  {
    label: "Supply",
    items: [
      { title: "Purchasing", to: "/purchasing", icon: ShoppingCart },
      { title: "Suppliers", to: "/suppliers", icon: Truck },
      { title: "Inventory", to: "/inventory", icon: Warehouse },
      { title: "Traceability", to: "/traceability", icon: ShieldCheck },
    ],
  },
  {
    label: "Operations",
    items: [
      { title: "Production", to: "/production", icon: Factory },
      { title: "Hygiene", to: "/hygiene", icon: SprayCan },
      { title: "Maintenance", to: "/maintenance", icon: Wrench },
      { title: "Housekeeping", to: "/housekeeping", icon: BedDouble },
    ],
  },
  {
    label: "People",
    items: [
      { title: "Human Resources", to: "/human-resources", icon: Users },
    ],
  },
  {
    label: "System",
    items: [
      // Duplicates is a job rather than a place — it belongs next to the data
      // it cleans up, and sits here until Products grows a home for it.
      { title: "Duplicates", to: "/duplicates", icon: CopyCheck },
      { title: "Administration", to: "/administration", icon: ShieldUser },
      { title: "Settings", to: "/settings", icon: Settings },
    ],
  },
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
        {navGroups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
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
        ))}
      </SidebarContent>

      <SidebarFooter />
      <SidebarRail />
    </Sidebar>
  );
}
