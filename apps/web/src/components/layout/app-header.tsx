import { Fragment, useState } from "react";
import { useLocation } from "react-router-dom";
import { Search, Sun, Moon, LogOut } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { CommandPalette } from "./command-palette";
import { Link } from "react-router-dom";
import { useAuthStore } from "@/stores/auth-store";
import { currentTheme, setTheme } from "@/lib/theme";

const routeLabels: Record<string, string> = {
  "": "Dashboard",
  products: "Products",
  recipes: "Recipes",
  "sub-recipes": "Sub Recipes",
  "allergen-matrix": "Allergen Matrix",
  inventory: "Inventory",
  production: "Production",
  suppliers: "Suppliers",
  duplicates: "Duplicates",
  collections: "Collections",
  print: "Sheet",
  new: "New",
};

function useBreadcrumbs() {
  const location = useLocation();
  const segments = location.pathname.split("/").filter(Boolean);

  if (segments.length === 0) {
    return [{ label: "Dashboard", href: "/", isCurrentPage: true }];
  }

  const crumbs = segments.map((segment, index) => {
    const href = "/" + segments.slice(0, index + 1).join("/");
    const label = routeLabels[segment] ?? decodeURIComponent(segment);
    const isCurrentPage = index === segments.length - 1;
    return { label, href, isCurrentPage };
  });

  return crumbs;
}

export function AppHeader() {
  const [commandOpen, setCommandOpen] = useState(false);
  const activeOrg = useAuthStore((s) => s.activeOrg);
  const session = useAuthStore((s) => s.session);
  const signOut = useAuthStore((s) => s.signOut);
  const [isDark, setIsDark] = useState(() => currentTheme() === "dark");
  const breadcrumbs = useBreadcrumbs();

  function toggleTheme() {
    const next = !isDark;
    setIsDark(next);
    // Persisted, so the choice survives a reload. It used to be a class and
    // nothing else, which meant dark mode had to be re-picked every visit.
    setTheme(next ? "dark" : "light");
  }

  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mr-2 h-4" />

        <Breadcrumb className="flex-1">
          <BreadcrumbList>
            {breadcrumbs.map((crumb, index) => (
              // Separator renders its own <li>, so it must be a sibling of the
              // item rather than nested inside it.
              <Fragment key={crumb.href}>
                {index > 0 && <BreadcrumbSeparator />}
                <BreadcrumbItem>
                  {crumb.isCurrentPage ? (
                    <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink render={<Link to={crumb.href} />}>
                      {crumb.label}
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
              </Fragment>
            ))}
          </BreadcrumbList>
        </Breadcrumb>

        <div className="flex items-center gap-1">
          {/* Which kitchen's data is on screen — RLS makes this the boundary
              of everything visible, so it is worth showing explicitly. */}
          {activeOrg && (
            <div className="mr-2 hidden text-right sm:block">
              <p className="text-xs font-medium leading-tight">
                {activeOrg.name}
              </p>
              <p className="text-[10px] leading-tight text-muted-foreground">
                {activeOrg.role.toLowerCase()}
              </p>
            </div>
          )}

          <Button
            variant="outline"
            size="sm"
            className="hidden gap-2 text-muted-foreground md:flex"
            onClick={() => setCommandOpen(true)}
          >
            <Search className="size-3.5" />
            <span className="text-xs">Search...</span>
            <kbd className="pointer-events-none ml-2 hidden h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground sm:flex">
              <span className="text-xs">&#8984;</span>K
            </kbd>
          </Button>

          <Button
            variant="ghost"
            size="icon-sm"
            className="md:hidden"
            onClick={() => setCommandOpen(true)}
          >
            <Search className="size-4" />
            <span className="sr-only">Search</span>
          </Button>

          {session && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => void signOut()}
              title="Sign out"
            >
              <LogOut className="size-4" />
              <span className="sr-only">Sign out</span>
            </Button>
          )}

          <Button variant="ghost" size="icon-sm" onClick={toggleTheme}>
            {isDark ? (
              <Sun className="size-4" />
            ) : (
              <Moon className="size-4" />
            )}
            <span className="sr-only">Toggle theme</span>
          </Button>
        </div>
      </header>

      <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} />
    </>
  );
}
