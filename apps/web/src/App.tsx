import { Routes, Route } from "react-router-dom";
import { AppShell } from "@/components/layout/app-shell";
import { DashboardPage } from "@/pages/dashboard";
import { ProductsPage } from "@/pages/products/products-page";
import { ProductDetailPage } from "@/pages/products/product-detail-page";
import { RecipesPage } from "@/pages/recipes/recipes-page";
import { RecipeDetailPage } from "@/pages/recipes/recipe-detail-page";
import { SubRecipesPage } from "@/pages/sub-recipes/sub-recipes-page";
import { SubRecipeDetailPage } from "@/pages/sub-recipes/sub-recipe-detail-page";
import { NotFoundPage } from "@/pages/not-found";

export function App() {
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
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
