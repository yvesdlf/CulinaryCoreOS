import { useEffect } from "react";
import { Routes, Route } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { DashboardPage } from "@/pages/dashboard";
import { AllergenMatrixPage } from "@/pages/allergen-matrix";
import { SuppliersPage } from "@/pages/suppliers";
import { DuplicatesPage } from "@/pages/duplicates";
import { ProductsPage } from "@/pages/products/products-page";
import { ProductDetailPage } from "@/pages/products/product-detail-page";
import { RecipesPage } from "@/pages/recipes/recipes-page";
import { RecipeDetailPage } from "@/pages/recipes/recipe-detail-page";
import { SubRecipesPage } from "@/pages/sub-recipes/sub-recipes-page";
import { SubRecipeDetailPage } from "@/pages/sub-recipes/sub-recipe-detail-page";
import { NotFoundPage } from "@/pages/not-found";
import { LoginPage } from "@/pages/login";
import { useAuthStore, useIsAuthenticated } from "@/stores/auth-store";

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
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/products" element={<ProductsPage />} />
        <Route path="/products/new" element={<ProductDetailPage />} />
        <Route path="/products/:id" element={<ProductDetailPage />} />
        <Route path="/recipes" element={<RecipesPage />} />
        <Route path="/recipes/new" element={<RecipeDetailPage />} />
        <Route path="/recipes/:id" element={<RecipeDetailPage />} />
        <Route path="/sub-recipes" element={<SubRecipesPage />} />
        <Route path="/sub-recipes/new" element={<SubRecipeDetailPage />} />
        <Route path="/sub-recipes/:id" element={<SubRecipeDetailPage />} />
        <Route path="/duplicates" element={<DuplicatesPage />} />
        <Route path="/suppliers" element={<SuppliersPage />} />
        <Route path="/allergen-matrix" element={<AllergenMatrixPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
