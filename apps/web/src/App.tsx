import { useEffect, lazy, Suspense } from "react";
import { Routes, Route } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { DashboardPage } from "@/pages/dashboard";
import { ProductsPage } from "@/pages/products/products-page";
import { RecipesPage } from "@/pages/recipes/recipes-page";
import { SubRecipesPage } from "@/pages/sub-recipes/sub-recipes-page";
import { NotFoundPage } from "@/pages/not-found";
import { LoginPage } from "@/pages/login";
import { useAuthStore, useIsAuthenticated } from "@/stores/auth-store";

/*
 * Secondary routes load on demand.
 *
 * The whole app was one 1 MB chunk, so opening the dashboard downloaded the
 * allergen matrix, the print sheets, the ZIP writer and every editor. The four
 * list pages stay eager — they are what a user lands on, and splitting those
 * trades a spinner for bytes needed immediately.
 */
const AllergenMatrixPage = lazy(() => import("@/pages/allergen-matrix").then((x) => ({ default: x.AllergenMatrixPage })));
const SuppliersPage = lazy(() => import("@/pages/suppliers").then((x) => ({ default: x.SuppliersPage })));
const TraceabilityPage = lazy(() => import("@/pages/traceability").then((x) => ({ default: x.TraceabilityPage })));
const MenuEngineeringPage = lazy(() => import("@/pages/menu-engineering").then((x) => ({ default: x.MenuEngineeringPage })));
const ProductionPage = lazy(() => import("@/pages/production").then((x) => ({ default: x.ProductionPage })));
const InventoryPage = lazy(() => import("@/pages/inventory").then((x) => ({ default: x.InventoryPage })));
const DuplicatesPage = lazy(() => import("@/pages/duplicates").then((x) => ({ default: x.DuplicatesPage })));
const CollectionsPage = lazy(() => import("@/pages/collections").then((x) => ({ default: x.CollectionsPage })));
const CollectionPrintPage = lazy(() => import("@/pages/collection-print-page").then((x) => ({ default: x.CollectionPrintPage })));
const RecipePrintPage = lazy(() => import("@/pages/recipes/recipe-print-page").then((x) => ({ default: x.RecipePrintPage })));
const SubRecipePrintPage = lazy(() => import("@/pages/sub-recipes/sub-recipe-print-page").then((x) => ({ default: x.SubRecipePrintPage })));
const ProductDetailPage = lazy(() => import("@/pages/products/product-detail-page").then((x) => ({ default: x.ProductDetailPage })));
const RecipeDetailPage = lazy(() => import("@/pages/recipes/recipe-detail-page").then((x) => ({ default: x.RecipeDetailPage })));
const SubRecipeDetailPage = lazy(() => import("@/pages/sub-recipes/sub-recipe-detail-page").then((x) => ({ default: x.SubRecipeDetailPage })));


export function App() {
  const initialize = useAuthStore((s) => s.initialize);
  const loading = useAuthStore((s) => s.loading);
  const authenticated = useIsAuthenticated();

  useEffect(() => {
    void initialize();
  }, [initialize]);

  // Restoring a session is a round trip. Rendering the sign-in page first would
  // flash it in front of an already-signed-in user on every refresh.
  if (loading) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!authenticated) {
    return <LoginPage />;
  }

  return (
    // Every lazy route needs a boundary to suspend into. Without one React
    // throws and the page renders blank — which is how this first shipped,
    // and is worse than the bundle size it was meant to fix.
    <Suspense
      fallback={
        <div className="flex min-h-[50vh] items-center justify-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
          <span className="sr-only">Loading</span>
        </div>
      }
    >
      <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/products" element={<ProductsPage />} />
        <Route path="/products/new" element={<ProductDetailPage />} />
        <Route path="/products/:id" element={<ProductDetailPage />} />
        <Route path="/recipes" element={<RecipesPage />} />
        <Route path="/recipes/new" element={<RecipeDetailPage />} />
        <Route path="/recipes/:id" element={<RecipeDetailPage />} />
        <Route path="/recipes/:id/print" element={<RecipePrintPage />} />
        <Route path="/sub-recipes" element={<SubRecipesPage />} />
        <Route path="/sub-recipes/new" element={<SubRecipeDetailPage />} />
        <Route path="/sub-recipes/:id" element={<SubRecipeDetailPage />} />
        <Route path="/sub-recipes/:id/print" element={<SubRecipePrintPage />} />
        <Route path="/collections" element={<CollectionsPage />} />
        <Route path="/collections/:id/print" element={<CollectionPrintPage />} />
        <Route path="/inventory" element={<InventoryPage />} />
        <Route path="/production" element={<ProductionPage />} />
        <Route path="/menu-engineering" element={<MenuEngineeringPage />} />
        <Route path="/traceability" element={<TraceabilityPage />} />
        <Route path="/duplicates" element={<DuplicatesPage />} />
        <Route path="/suppliers" element={<SuppliersPage />} />
        <Route path="/allergen-matrix" element={<AllergenMatrixPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
      </Routes>
    </Suspense>
  );
}
