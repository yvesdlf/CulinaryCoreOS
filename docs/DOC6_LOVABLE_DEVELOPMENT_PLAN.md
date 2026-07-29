# DOCUMENT 6: LOVABLE DEVELOPMENT PLAN

> **Status: original design intent, captured 2026-07-26.**
> Written before implementation began and not revised since. The build has
> since diverged in places — currency is IDR with Indonesian PPN rather than
> AED with VAT, and the schema has gained multi-tenancy and row level security.
> Treat this as the reasoning behind the design, not a description of what
> currently exists. `docs/PROGRESS.md` is the living record of what is built.


## CulinaryCore -- Commercial Recipe & Hospitality Management Platform

Version: 1.0
Status: Planning
Last Updated: 2026-07-25

---

## Table of Contents

1. [Plan Overview](#plan-overview)
2. [Mandatory Architecture Reset: Platform Core (Phase 0)](#mandatory-architecture-reset-platform-core-phase-0)
3. [Phase 1: Foundation (Weeks 1-3)](#phase-1-foundation-weeks-1-3)
3. [Phase 2: Recipe Core (Weeks 4-6)](#phase-2-recipe-core-weeks-4-6)
4. [Phase 3: Nutrition & Allergens (Weeks 7-8)](#phase-3-nutrition--allergens-weeks-7-8)
5. [Phase 4: Pricing & Costing (Weeks 9-10)](#phase-4-pricing--costing-weeks-9-10)
6. [Phase 5: Supplier & Purchasing (Weeks 11-12)](#phase-5-supplier--purchasing-weeks-11-12)
7. [Phase 6: Menu Management (Weeks 13-14)](#phase-6-menu-management-weeks-13-14)
8. [Phase 7: Inventory & Production (Weeks 15-17)](#phase-7-inventory--production-weeks-15-17)
9. [Phase 8: AI Integration (Weeks 18-20)](#phase-8-ai-integration-weeks-18-20)
10. [Phase 9: Reporting & Analytics (Weeks 21-22)](#phase-9-reporting--analytics-weeks-21-22)
11. [Phase 10: Cross-Platform & Polish (Weeks 23-26)](#phase-10-cross-platform--polish-weeks-23-26)
12. [Phase 11: Version Control & Audit (Weeks 27-28)](#phase-11-version-control--audit-weeks-27-28)
13. [Phase 12: Advanced Features (Weeks 29-32)](#phase-12-advanced-features-weeks-29-32)
14. [Phase 13: Operations Control, Workforce & Finance Integration](#phase-13-operations-control-workforce--finance-integration-weeks-3338)
15. [Phase 14: Procurement & People Workspaces](#phase-14-procurement--people-workspaces-post-foundation)
16. [Appendix A: Supabase Schema Summary](#appendix-a-supabase-schema-summary)
17. [Appendix B: Lovable Prompt Writing Guidelines](#appendix-b-lovable-prompt-writing-guidelines)

---

## Plan Overview

### Mandatory sequencing amendment

The Platform Core Specification is a prerequisite for all remaining phases. Complete Phase 0 before Phase 1 work is accepted, then apply its access, hierarchy, workflow, audit, data-classification and integration contracts to every subsequent phase. This avoids rebuilding recipes, procurement, HR and approvals around incompatible security models.

### Architecture Summary

CulinaryCore replaces two complex Excel workbooks (Recipes.xlsm with 89 sheets and Sub Rec.xlsm with 250 sheets) with a modern, cross-platform application. The core data flow is:

```
Products --> Sub Recipes --> Recipes --> Menus
   |              |             |          |
   v              v             v          v
 Costs -------> Roll Up ----> Roll Up --> Total Cost
 Nutrition ---> Roll Up ----> Roll Up --> Total Nutrition
 Allergens ---> Inherit ----> Inherit --> Allergen Matrix
```

### Technology Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18+, TypeScript 5+, Vite |
| UI Components | shadcn/ui (Radix primitives) |
| Styling | Tailwind CSS 3.4+ |
| Backend | Supabase (PostgreSQL 15+, Auth, Storage, Edge Functions, Realtime) |
| State Management | Zustand + TanStack Query |
| Desktop | Tauri 2.x (macOS) |
| Mobile | Capacitor 6.x (iOS/iPadOS) |
| AI | Abstraction layer over OpenAI, Anthropic, Gemini, Apple Foundation Models |
| Offline | Supabase local-first with PowerSync or custom sync |
| Testing | Vitest, Playwright, React Testing Library |

### Lovable.dev Prompt Strategy

Each phase is broken into individual Lovable prompts. Each prompt generates a single screen or feature. Prompts follow these rules:

1. One feature or screen per prompt
2. Explicit component names from shadcn/ui
3. Exact Tailwind classes for critical styling
4. Supabase table and column references
5. TypeScript interfaces included inline
6. Responsive breakpoints specified
7. Error states and loading states described
8. Each prompt builds on the previous prompts' outputs

### Currency and Locale

All monetary values use AED (UAE Dirham). The system stores values in minor units (fils) as integers where precision matters, or as `numeric(12,4)` for costs. Display format: `AED 12.50`.

---

## Phase 1: Foundation (Weeks 1-3)

### 1.1 Objectives

- Stand up the Supabase project with core schema
- Implement authentication with Apple Sign-In, Google, and email/password
- Create the application shell with navigation, command palette, and global search
- Build the complete Product/Ingredient CRUD interface
- Establish the design system tokens and layout patterns used by all subsequent phases

### 1.2 Database Changes

#### New Tables

```sql
-- Organization (multi-tenant root)
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  currency TEXT NOT NULL DEFAULT 'AED',
  timezone TEXT NOT NULL DEFAULT 'Asia/Dubai',
  logo_url TEXT,
  settings JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- User profiles (extends Supabase auth.users)
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  avatar_url TEXT,
  role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('owner','admin','manager','chef','viewer')),
  preferences JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Product categories (maps to the 12 Set Up categories from Recipes.xlsm)
CREATE TABLE product_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  color TEXT, -- hex color for UI badges
  icon TEXT, -- lucide icon name
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, name)
);

-- Units of measure
CREATE TABLE units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,          -- 'kilogram'
  abbreviation TEXT NOT NULL,  -- 'kg'
  unit_type TEXT NOT NULL CHECK (unit_type IN ('weight','volume','count','length')),
  base_unit_id UUID REFERENCES units(id),
  conversion_factor NUMERIC(18,8), -- multiply by this to get base unit
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, abbreviation)
);

-- Products / Ingredients (maps to Sub Rec Product List - 657 products, 31 columns)
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  category_id UUID REFERENCES product_categories(id) ON DELETE SET NULL,
  code TEXT,                          -- internal product code
  name TEXT NOT NULL,
  brand TEXT,
  description TEXT,
  
  -- Purchasing
  supplier_id UUID,                   -- FK added in Phase 5
  purchase_unit_id UUID NOT NULL REFERENCES units(id),
  purchase_unit_qty NUMERIC(10,3) NOT NULL DEFAULT 1, -- e.g., "6" for a 6-pack
  purchase_price NUMERIC(12,4) NOT NULL DEFAULT 0,    -- price per purchase unit in AED
  
  -- Recipe unit (what chefs measure in)
  recipe_unit_id UUID NOT NULL REFERENCES units(id),
  recipe_unit_conversion NUMERIC(18,8) NOT NULL DEFAULT 1, -- purchase_unit * this = recipe_units
  
  -- Yield & Waste (from Sub Rec workbook)
  waste_percentage NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (waste_percentage >= 0 AND waste_percentage < 100),
  yield_percentage NUMERIC(5,2) NOT NULL DEFAULT 100 CHECK (yield_percentage > 0 AND yield_percentage <= 100),
  
  -- Computed cost per recipe unit (stored, recalculated on price/yield change)
  cost_per_recipe_unit NUMERIC(12,6) NOT NULL DEFAULT 0,
  
  -- Nutrition per 100g (9 values from Sub Rec workbook)
  energy_kcal NUMERIC(8,2) DEFAULT 0,
  energy_kj NUMERIC(8,2) DEFAULT 0,
  protein_g NUMERIC(8,2) DEFAULT 0,
  carbohydrate_g NUMERIC(8,2) DEFAULT 0,
  sugar_g NUMERIC(8,2) DEFAULT 0,
  fat_g NUMERIC(8,2) DEFAULT 0,
  saturated_fat_g NUMERIC(8,2) DEFAULT 0,
  fibre_g NUMERIC(8,2) DEFAULT 0,
  sodium_mg NUMERIC(8,2) DEFAULT 0,
  
  -- Status
  is_active BOOLEAN NOT NULL DEFAULT true,
  
  -- Metadata
  image_url TEXT,
  notes TEXT,
  tags TEXT[] DEFAULT '{}',
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  
  UNIQUE(organization_id, code)
);

-- Allergens reference table
CREATE TABLE allergens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                -- 'Gluten', 'Dairy', etc.
  icon TEXT,                         -- emoji or icon name
  legal_name TEXT,                   -- regulatory display name
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_major BOOLEAN NOT NULL DEFAULT true, -- EU Big 14
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, name)
);

-- Product-allergen junction
CREATE TABLE product_allergens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  allergen_id UUID NOT NULL REFERENCES allergens(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('contains','may_contain','free_from')) DEFAULT 'contains',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(product_id, allergen_id)
);

-- Indexes
CREATE INDEX idx_products_org ON products(organization_id);
CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_products_name ON products(organization_id, name);
CREATE INDEX idx_products_code ON products(organization_id, code);
CREATE INDEX idx_profiles_org ON profiles(organization_id);
```

#### Row Level Security Policies

```sql
-- Organizations: users see only their own org
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own org" ON organizations
  FOR SELECT USING (
    id IN (SELECT organization_id FROM profiles WHERE id = auth.uid())
  );

-- Products: scoped to organization
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view org products" ON products
  FOR SELECT USING (
    organization_id IN (SELECT organization_id FROM profiles WHERE id = auth.uid())
  );
CREATE POLICY "Managers+ insert products" ON products
  FOR INSERT WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM profiles 
      WHERE id = auth.uid() AND role IN ('owner','admin','manager','chef')
    )
  );
CREATE POLICY "Managers+ update products" ON products
  FOR UPDATE USING (
    organization_id IN (
      SELECT organization_id FROM profiles 
      WHERE id = auth.uid() AND role IN ('owner','admin','manager','chef')
    )
  );
-- Repeat pattern for all org-scoped tables
```

#### Seed Data

```sql
-- Default allergens (EU Big 14)
INSERT INTO allergens (organization_id, name, icon, legal_name, sort_order, is_major) VALUES
  (:org_id, 'Gluten', 'wheat', 'Cereals containing gluten', 1, true),
  (:org_id, 'Crustaceans', 'shrimp', 'Crustaceans', 2, true),
  (:org_id, 'Eggs', 'egg', 'Eggs', 3, true),
  (:org_id, 'Fish', 'fish', 'Fish', 4, true),
  (:org_id, 'Peanuts', 'nut', 'Peanuts', 5, true),
  (:org_id, 'Soybeans', 'bean', 'Soybeans', 6, true),
  (:org_id, 'Dairy', 'milk', 'Milk', 7, true),
  (:org_id, 'Tree Nuts', 'almond', 'Nuts', 8, true),
  (:org_id, 'Celery', 'leaf', 'Celery', 9, true),
  (:org_id, 'Mustard', 'mustard', 'Mustard', 10, true),
  (:org_id, 'Sesame', 'sesame', 'Sesame seeds', 11, true),
  (:org_id, 'Sulphites', 'flask', 'Sulphur dioxide/sulphites', 12, true),
  (:org_id, 'Lupin', 'flower', 'Lupin', 13, true),
  (:org_id, 'Molluscs', 'shell', 'Molluscs', 14, true);

-- Default units
INSERT INTO units (organization_id, name, abbreviation, unit_type, conversion_factor) VALUES
  (:org_id, 'gram', 'g', 'weight', 1),
  (:org_id, 'kilogram', 'kg', 'weight', 1000),
  (:org_id, 'milligram', 'mg', 'weight', 0.001),
  (:org_id, 'pound', 'lb', 'weight', 453.592),
  (:org_id, 'ounce', 'oz', 'weight', 28.3495),
  (:org_id, 'millilitre', 'ml', 'volume', 1),
  (:org_id, 'litre', 'L', 'volume', 1000),
  (:org_id, 'fluid ounce', 'fl oz', 'volume', 29.5735),
  (:org_id, 'cup', 'cup', 'volume', 236.588),
  (:org_id, 'tablespoon', 'tbsp', 'volume', 14.787),
  (:org_id, 'teaspoon', 'tsp', 'volume', 4.929),
  (:org_id, 'piece', 'pc', 'count', 1),
  (:org_id, 'dozen', 'doz', 'count', 12),
  (:org_id, 'bunch', 'bunch', 'count', 1),
  (:org_id, 'pack', 'pack', 'count', 1);

-- Default product categories (from Recipes.xlsm Set Up sheets)
INSERT INTO product_categories (organization_id, name, sort_order, color) VALUES
  (:org_id, 'Dairy & Eggs', 1, '#F59E0B'),
  (:org_id, 'Meat', 2, '#EF4444'),
  (:org_id, 'Poultry', 3, '#F97316'),
  (:org_id, 'Seafood', 4, '#3B82F6'),
  (:org_id, 'Vegetables', 5, '#22C55E'),
  (:org_id, 'Fruits', 6, '#A855F7'),
  (:org_id, 'Herbs & Spices', 7, '#14B8A6'),
  (:org_id, 'Dry Goods & Grains', 8, '#D97706'),
  (:org_id, 'Oils & Fats', 9, '#EAB308'),
  (:org_id, 'Sauces & Condiments', 10, '#EC4899'),
  (:org_id, 'Bakery & Pastry', 11, '#8B5CF6'),
  (:org_id, 'Beverages', 12, '#06B6D4');
```

### 1.3 UI Changes

| Screen | Route | Description |
|--------|-------|-------------|
| Login | `/login` | Email/password + Apple Sign-In + Google |
| Register | `/register` | Create account + organization |
| App Shell | `/` | Sidebar nav, top bar, command palette |
| Dashboard | `/dashboard` | Placeholder cards (populated Phase 9) |
| Products List | `/products` | Searchable, filterable data table |
| Product Detail | `/products/:id` | Full product form with all fields |
| Product Create | `/products/new` | Same form as detail, create mode |
| Categories | `/settings/categories` | Manage product categories |
| Units | `/settings/units` | Manage units of measure |
| Organization Settings | `/settings/organization` | Org name, currency, logo |
| User Settings | `/settings/profile` | Profile, preferences |

### 1.4 Business Logic

#### Cost Per Recipe Unit Calculation

```typescript
function calculateCostPerRecipeUnit(product: Product): number {
  const pricePerPurchaseUnit = product.purchase_price / product.purchase_unit_qty;
  const costAfterWaste = pricePerPurchaseUnit / (1 - product.waste_percentage / 100);
  const costPerRecipeUnit = costAfterWaste / product.recipe_unit_conversion;
  return costPerRecipeUnit;
}
```

This mirrors the Excel formula: `Gross = (100 * Nett) / (100 - Ref%)` where Ref% is the waste percentage.

#### Validations

- Product name required, max 200 characters
- Purchase price >= 0
- Waste percentage 0-99.99
- Yield percentage 0.01-100
- Product code unique per organization (if provided)
- At least one unit must exist before creating a product

### 1.5 Testing

| Test | Type | Description |
|------|------|-------------|
| Auth flow | E2E | Register, login, logout, session persistence |
| RLS policies | Integration | Verify user cannot see another org's data |
| Product CRUD | Integration | Create, read, update, soft-delete products |
| Cost calculation | Unit | Verify cost_per_recipe_unit for various waste/yield combos |
| Search | Integration | Product search by name, code, category |
| Responsive | Visual | Shell renders correctly at 375px, 768px, 1280px |

Edge cases:
- 0% waste (no adjustment needed)
- 99% waste (extremely high cost multiplier)
- Product with no category
- Duplicate product codes
- Unicode product names
- Very long product names (200+ chars)

### 1.6 Acceptance Criteria

- [ ] User can register with email and create an organization
- [ ] User can sign in with Apple Sign-In
- [ ] User can sign in with Google
- [ ] Sidebar navigation shows all section links
- [ ] Command palette opens with Cmd+K and searches across entities
- [ ] User can create a product with all fields
- [ ] User can edit an existing product
- [ ] User can search products by name, code, brand
- [ ] User can filter products by category
- [ ] Product list supports pagination (20 per page)
- [ ] Cost per recipe unit auto-calculates when price/waste/yield changes
- [ ] Categories and units CRUD works
- [ ] RLS prevents cross-organization data access
- [ ] All screens are responsive (mobile, tablet, desktop)

### 1.7 Lovable Prompts

---

#### Prompt 1.1: Supabase Project and Auth Setup

```
Create a new React + TypeScript + Vite project with Supabase integration.

SETUP:
- Install dependencies: @supabase/supabase-js, @supabase/auth-ui-react, @supabase/auth-ui-shared, zustand, @tanstack/react-query, react-router-dom, lucide-react
- Install and configure shadcn/ui with the "zinc" theme, CSS variables enabled
- Configure Tailwind CSS with these custom colors in tailwind.config.ts:
  ```
  colors: {
    brand: {
      50: '#f0f7ff',
      100: '#e0effe',
      200: '#bae0fd',
      300: '#7ccafc',
      400: '#37b0f8',
      500: '#0d96e8',
      600: '#0178c8',
      700: '#015fa2',
      800: '#065186',
      900: '#0b446f',
      950: '#072b4a',
    }
  }
  ```

SUPABASE CLIENT:
Create `src/lib/supabase.ts`:
```typescript
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey)
```

AUTH STORE:
Create `src/stores/authStore.ts` using Zustand:
```typescript
interface AuthState {
  user: User | null
  profile: Profile | null
  organization: Organization | null
  isLoading: boolean
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string, fullName: string, orgName: string) => Promise<void>
  signInWithApple: () => Promise<void>
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
  loadProfile: () => Promise<void>
}
```

The signUp function should:
1. Create the auth user via supabase.auth.signUp
2. Create an organization record in the organizations table
3. Create a profile record linking the user to the org with role 'owner'

AUTH PAGES:
1. Login page at `/login`:
   - Card component centered on screen with max-w-md
   - Logo placeholder at top (text "CulinaryCore" in brand-600, text-2xl font-bold)
   - Email input using shadcn Input component
   - Password input using shadcn Input component
   - "Sign In" Button (brand-600 background, full width)
   - Separator with "or continue with"
   - Apple Sign-In button (black background, white text, Apple logo)
   - Google Sign-In button (white background, border, Google logo)
   - Link to register page: "Don't have an account? Sign up"
   - Error display using shadcn Alert with AlertDescription

2. Register page at `/register`:
   - Same card layout as login
   - Full name input
   - Organization name input
   - Email input
   - Password input (min 8 chars, show requirements)
   - Confirm password input
   - "Create Account" Button
   - Link to login: "Already have an account? Sign in"

3. Auth guard component `ProtectedRoute`:
   - Wraps authenticated routes
   - Redirects to /login if no session
   - Shows a centered Loader2 spinner (animate-spin) while checking auth

ROUTING:
Use react-router-dom v6 with these routes:
- `/login` - LoginPage (public)
- `/register` - RegisterPage (public)
- `/` - Redirect to /dashboard (protected)
- `/dashboard` - DashboardPage (protected)
- All protected routes wrapped in ProtectedRoute

Make sure the auth state listener is set up in the root App component using supabase.auth.onAuthStateChange.
```

**Expected Output:** Working auth system with login, register, Apple/Google SSO buttons, Zustand auth store, Supabase client, protected routing, and responsive auth pages.

---

#### Prompt 1.2: Application Shell with Navigation

```
Build the main application shell layout that wraps all authenticated pages.

LAYOUT COMPONENT `src/components/layout/AppLayout.tsx`:
Structure:
- Left sidebar (w-64 on desktop, collapsible to w-16 with icons only)
- Top header bar (h-14, border-b)
- Main content area (flex-1, overflow-y-auto, p-6)

SIDEBAR (`src/components/layout/Sidebar.tsx`):
- Organization name at top with avatar (first letter, bg-brand-600 text-white rounded-lg w-8 h-8)
- Navigation sections with labels:

  MAIN:
  - Dashboard (LayoutDashboard icon) -> /dashboard
  - Products (Package icon) -> /products
  - Sub Recipes (FlaskConical icon) -> /sub-recipes [disabled, coming Phase 2]
  - Recipes (ChefHat icon) -> /recipes [disabled, coming Phase 2]
  - Menus (BookOpen icon) -> /menus [disabled, coming Phase 6]

  OPERATIONS:
  - Inventory (Warehouse icon) -> /inventory [disabled]
  - Production (Factory icon) -> /production [disabled]
  - Suppliers (Truck icon) -> /suppliers [disabled]
  - Purchase Orders (ShoppingCart icon) -> /purchase-orders [disabled]

  ANALYTICS:
  - Reports (BarChart3 icon) -> /reports [disabled]
  - Cost Analysis (TrendingUp icon) -> /cost-analysis [disabled]

  Bottom section:
  - Settings (Settings icon) -> /settings
  - User avatar + name + role badge
  - Sign out button (LogOut icon)

- Active nav item: bg-brand-50 text-brand-700 border-l-2 border-brand-600
- Hover: bg-zinc-50
- Disabled items: opacity-50 cursor-not-allowed, tooltip "Coming soon"
- Sidebar collapse toggle button at bottom (ChevronsLeft/ChevronsRight icon)
- On mobile (< 768px): sidebar is hidden, opens as sheet overlay from hamburger menu

HEADER (`src/components/layout/Header.tsx`):
- Hamburger menu button (visible < 768px only)
- Breadcrumb trail using shadcn Breadcrumb component
- Spacer (flex-1)
- Global search button: "Search..." text with Cmd+K badge, opens command palette
- Notification bell (Bell icon) with badge dot
- User avatar dropdown (shadcn DropdownMenu):
  - Profile link
  - Organization settings link
  - Separator
  - Sign out

COMMAND PALETTE (`src/components/layout/CommandPalette.tsx`):
- Use shadcn CommandDialog (which uses cmdk)
- Opens on Cmd+K (or Ctrl+K on Windows)
- Search input at top
- Sections:
  - "Quick Actions": New Product, New Recipe, New Sub Recipe
  - "Navigation": Dashboard, Products, Recipes, etc.
  - "Recent": last 5 viewed items (store in localStorage)
- Each item shows icon + label + optional shortcut badge
- Selecting an item navigates to the route or performs the action

RESPONSIVE BEHAVIOR:
- Desktop (>= 1024px): Full sidebar visible
- Tablet (768-1023px): Collapsed sidebar (icons only, expand on hover)
- Mobile (< 768px): No sidebar, hamburger opens Sheet overlay

Store sidebar collapsed state in localStorage. Use Zustand store for sidebar state:
```typescript
interface UIState {
  sidebarCollapsed: boolean
  commandPaletteOpen: boolean
  toggleSidebar: () => void
  setCommandPaletteOpen: (open: boolean) => void
}
```

Styling:
- Sidebar background: bg-white border-r border-zinc-200
- Dark mode: dark:bg-zinc-950 dark:border-zinc-800
- Smooth transitions on sidebar collapse: transition-all duration-200
```

**Expected Output:** Complete application shell with responsive sidebar, header with breadcrumbs, command palette (Cmd+K), and proper mobile/tablet/desktop layouts.

---

#### Prompt 1.3: Product List Page

```
Build the Products list page at route `/products`.

PAGE: `src/pages/ProductsPage.tsx`

HEADER SECTION:
- Page title "Products" (text-2xl font-bold)
- Subtitle "Manage ingredients and raw materials" (text-sm text-zinc-500)
- Right side: "Add Product" Button (brand-600, Plus icon) -> navigates to /products/new

FILTER BAR (below header, flex row, gap-3, flex-wrap):
- Search input (shadcn Input, Search icon, placeholder "Search by name, code, or brand...", w-80)
  - Debounced search (300ms) that filters the table
- Category filter: shadcn Select with options from product_categories table, plus "All Categories" default
- Status filter: shadcn Select with options: "All", "Active", "Inactive"
- Sort: shadcn Select with options: "Name A-Z", "Name Z-A", "Category", "Price Low-High", "Price High-Low", "Recently Updated"

DATA TABLE using shadcn Table component:
Columns:
1. Checkbox (for bulk actions)
2. Name (font-medium) + Brand below in text-sm text-zinc-500. If no brand, just name.
3. Code (text-sm font-mono text-zinc-600)
4. Category (Badge component with category color as background)
5. Purchase Price (right-aligned, formatted as "AED 12.50")
6. Recipe Unit (abbreviation from units table)
7. Cost/Unit (right-aligned, cost_per_recipe_unit formatted as "AED 0.0125")
8. Waste % (right-aligned, formatted as "12.5%")
9. Status (green dot + "Active" or red dot + "Inactive")
10. Actions (DropdownMenu with MoreHorizontal icon):
    - Edit (Pencil icon)
    - Duplicate (Copy icon)
    - View History [disabled]
    - Separator
    - Deactivate/Activate (toggle)

TABLE FEATURES:
- Sortable columns (click header to sort, show ChevronUp/ChevronDown)
- Pagination at bottom: "Showing 1-20 of 657 products", Previous/Next buttons, page size selector (20, 50, 100)
- Empty state: illustration placeholder, "No products found", "Add your first product to get started" + CTA button
- Loading state: Skeleton components matching table row layout (5 rows)
- Selected rows: show bulk action bar at top: "X selected" + "Delete" Button (destructive variant) + "Export" Button (outline variant)

SUPABASE QUERY:
```typescript
const { data, count } = await supabase
  .from('products')
  .select(`
    *,
    category:product_categories(id, name, color),
    purchase_unit:units!products_purchase_unit_id_fkey(abbreviation),
    recipe_unit:units!products_recipe_unit_id_fkey(abbreviation)
  `, { count: 'exact' })
  .eq('organization_id', orgId)
  .ilike('name', `%${search}%`)
  .order(sortColumn, { ascending: sortAsc })
  .range(from, to)
```

Use TanStack Query for data fetching:
```typescript
const { data, isLoading, error } = useQuery({
  queryKey: ['products', orgId, search, categoryFilter, statusFilter, sort, page],
  queryFn: () => fetchProducts({ orgId, search, categoryFilter, statusFilter, sort, page }),
})
```

RESPONSIVE:
- On mobile (< 768px): show as card list instead of table. Each card shows: name, category badge, price, cost/unit, waste %. Tap to navigate to detail.
- On tablet: hide Code and Waste % columns
- On desktop: show all columns
```

**Expected Output:** Full-featured product list page with search, filters, sortable/paginated data table, mobile card view, loading/empty states, and Supabase integration.

---

#### Prompt 1.4: Product Detail / Create Form

```
Build the Product detail and create form, used at both `/products/new` and `/products/:id`.

PAGE: `src/pages/ProductDetailPage.tsx`

Detect mode from URL: if `:id` param exists, fetch product and show in edit mode. Otherwise, create mode.

LAYOUT:
- Back button (ArrowLeft icon + "Products") at top-left, navigates to /products
- Page title: "New Product" (create) or product name (edit)
- Right side: "Save" Button (brand-600) + "Cancel" Button (outline variant)
- Below: form in max-w-4xl, organized in Card sections

FORM SECTIONS (each in a shadcn Card with CardHeader + CardContent):

SECTION 1: "Basic Information"
- Name* (Input, required, max 200 chars)
- Brand (Input, optional)
- Code (Input, optional, placeholder "Auto-generated if empty")
- Category (Select, options from product_categories, with colored dots matching category color)
- Description (Textarea, 3 rows)
- Tags (multi-select or tag input, allow custom tags)
- Status toggle (Switch component, "Active"/"Inactive" label)
- Image upload (drag-and-drop zone or click to upload, show preview, store in Supabase Storage bucket "product-images")

SECTION 2: "Purchasing"
- Purchase Unit (Select, options from units table, grouped by unit_type)
- Purchase Quantity (Input type number, step 0.001, "Units per purchase" helper text)
- Purchase Price (Input type number, step 0.01, prefix "AED", "Price per purchase unit")
- Calculated display: "Cost per [unit]: AED X.XXXX" (auto-updates as values change)

SECTION 3: "Recipe Usage"
- Recipe Unit (Select, options from units table, grouped by unit_type)
- Conversion Factor (Input type number, step 0.00000001, helper: "1 [purchase_unit] = X [recipe_unit]")
- Waste Percentage (Input type number, step 0.01, suffix "%", helper: "Trim, peel, or processing loss")
- Yield Percentage (Input type number, step 0.01, suffix "%", auto-calculated as 100 - waste%, but editable)

SECTION 4: "Cost Summary" (read-only display card, bg-zinc-50 dark:bg-zinc-900)
Show a summary box:
```
Purchase Price:           AED 25.00 / kg
After Waste (12.5%):      AED 28.57 / kg
Cost per Recipe Unit:     AED 0.0286 / g
Security Margin (5%):     AED 0.0300 / g
```
All values auto-calculate in real-time as the user edits the form above.
Use the formula: Gross = (100 * Nett) / (100 - Waste%)
Security margin: Cost * 1.05

SECTION 5: "Nutrition per 100g" (collapsible, default collapsed)
- 3-column grid on desktop, 2 on tablet, 1 on mobile
- Fields (all Input type number, step 0.01):
  - Energy (kcal)
  - Energy (kJ)
  - Protein (g)
  - Carbohydrate (g)
  - of which Sugars (g) [indented with ml-4]
  - Fat (g)
  - of which Saturated (g) [indented with ml-4]
  - Fibre (g)
  - Sodium (mg)

SECTION 6: "Allergens" (collapsible, default collapsed)
- Grid of allergen toggles (3 columns desktop, 2 tablet, 1 mobile)
- Each allergen row: icon + name + ToggleGroup with 3 options:
  - "Contains" (red)
  - "May Contain" (amber)  
  - "Free From" (green)
- Default: no selection (not specified)
- Allergens fetched from allergens table

SECTION 7: "Notes" (collapsible, default collapsed)
- Textarea (6 rows)
- "Storage instructions, sourcing notes, etc."

FORM BEHAVIOR:
- Use react-hook-form with zod validation
- Validation schema:
  ```typescript
  const productSchema = z.object({
    name: z.string().min(1, "Name is required").max(200),
    brand: z.string().optional(),
    code: z.string().optional(),
    category_id: z.string().uuid().optional(),
    purchase_unit_id: z.string().uuid("Select a purchase unit"),
    purchase_unit_qty: z.number().positive(),
    purchase_price: z.number().min(0),
    recipe_unit_id: z.string().uuid("Select a recipe unit"),
    recipe_unit_conversion: z.number().positive(),
    waste_percentage: z.number().min(0).max(99.99),
    yield_percentage: z.number().min(0.01).max(100),
    // ... nutrition fields
    // ... allergens as array
  })
  ```
- On save (create): INSERT into products table, INSERT allergens into product_allergens, redirect to /products/:id
- On save (edit): UPDATE product, UPSERT allergens
- Show toast notification (shadcn Sonner) on success: "Product created successfully" / "Product updated"
- Show inline validation errors below each field
- Unsaved changes warning: if form is dirty and user navigates away, show confirmation dialog

SUPABASE:
- Fetch product: `supabase.from('products').select('*, category:product_categories(*), product_allergens(*, allergen:allergens(*))').eq('id', id).single()`
- Fetch units: `supabase.from('units').select('*').eq('organization_id', orgId).order('unit_type').order('name')`
- Fetch categories: `supabase.from('product_categories').select('*').eq('organization_id', orgId).order('sort_order')`
- Fetch allergens: `supabase.from('allergens').select('*').eq('organization_id', orgId).order('sort_order')`

RESPONSIVE:
- On mobile: sections stack vertically, full width
- On desktop: max-w-4xl centered
- Sticky save/cancel bar at bottom on mobile
```

**Expected Output:** Complete product create/edit form with all fields from the Excel workbook, real-time cost calculation, allergen management, image upload, validation, and responsive layout.

---

#### Prompt 1.5: Settings Pages (Categories, Units, Organization)

```
Build three settings pages accessible from /settings.

SETTINGS LAYOUT `src/pages/SettingsPage.tsx`:
- Left sidebar navigation within settings (visible on desktop, tabs on mobile):
  - Organization (Building icon)
  - Categories (Tag icon)
  - Units (Ruler icon)
  - Users [disabled, Phase later]
  - Billing [disabled]
- Content area to the right

PAGE 1: Organization Settings `/settings/organization`
- Card "Organization Details":
  - Name (Input)
  - Slug (Input, read-only, auto-generated from name)
  - Currency (Select: AED, USD, EUR, GBP, SAR, QAR, BHD, KWD, OMR)
  - Timezone (Select: common timezones, default Asia/Dubai)
  - Logo upload (Avatar-sized, circular crop, Supabase Storage)
  - Save button
- Card "Security Margin":
  - Percentage input (default 5%), helper: "Applied to all recipe costs as a buffer"
  - Save button
- Card "Danger Zone" (border-red-200):
  - "Delete Organization" button (destructive variant, requires typing org name to confirm)

PAGE 2: Categories `/settings/categories`
- Page title "Product Categories"
- "Add Category" Button at top-right
- Reorderable list (drag handle, DndKit or similar):
  - Each row: drag handle | color dot (editable, color picker) | name (editable inline) | product count badge | delete button
  - Inline editing: click name to edit, press Enter to save
  - Delete: confirmation dialog showing how many products are in this category
- Color picker: small popover with preset colors + custom hex input
- Empty state: "No categories yet. Add your first category."

PAGE 3: Units `/settings/units`
- Page title "Units of Measure"
- "Add Unit" Button at top-right
- Tabs: "Weight" | "Volume" | "Count" | "Length"
- Each tab shows a Table:
  - Columns: Name | Abbreviation | Conversion Factor | Base Unit | Actions
  - Conversion factor shows: "1 kg = 1000 g" format
  - Actions: Edit (opens dialog), Delete (with confirmation if unit is used by products)
- Add/Edit Dialog (shadcn Dialog):
  - Name (Input)
  - Abbreviation (Input)
  - Unit Type (Select: weight, volume, count, length)
  - Base Unit (Select: filtered by unit_type)
  - Conversion Factor (number input, helper: "How many [base_unit] in 1 [this_unit]")

SUPABASE MUTATIONS:
- Categories: INSERT, UPDATE (name, color, sort_order), DELETE with cascade check
- Units: INSERT, UPDATE, DELETE with usage check (count products using this unit)
- Organization: UPDATE

Toast notifications on all saves. Optimistic updates using TanStack Query's useMutation with onMutate/onError rollback.
```

**Expected Output:** Three settings pages for organization config, category management with drag-reorder, and unit management with type tabs and conversion factors.

---

### 1.8 Expected Output Summary

After completing all Phase 1 prompts, the application should have:

- Working authentication (email, Apple, Google)
- Application shell with sidebar, header, command palette
- Full product CRUD with 657+ product support
- Product search, filter, sort, pagination
- Category management with colors and ordering
- Unit management with conversions
- Organization settings
- Real-time cost calculations
- Responsive design at all breakpoints
- Supabase RLS protecting all data

### 1.9 Dependencies

- Supabase project created with Auth, Database, and Storage enabled
- Apple Developer account for Apple Sign-In OAuth
- Google Cloud project for Google OAuth
- Environment variables configured in `.env.local`

---

## Phase 2: Recipe Core (Weeks 4-6)

### 2.1 Objectives

- Build the sub recipe system with batch costing (replacing Sub Rec.xlsm)
- Build the recipe system with ingredient auto-lookup (replacing Recipes.xlsm)
- Implement the cost roll-up engine (Products -> Sub Recipes -> Recipes)
- Add recipe scaling
- Implement recipe categories and status workflow

### 2.2 Database Changes

#### New Tables

```sql
-- Sub Recipes (maps to Sub Rec.xlsm sheets - 245 sub recipes)
CREATE TABLE sub_recipes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT,
  category TEXT,              -- e.g., 'Sauce', 'Dough', 'Marinade'
  description TEXT,
  
  -- Batch information
  batch_yield_qty NUMERIC(10,3) NOT NULL DEFAULT 1,
  batch_yield_unit_id UUID NOT NULL REFERENCES units(id),
  
  -- Computed totals (recalculated on ingredient change)
  total_cost NUMERIC(12,4) NOT NULL DEFAULT 0,
  cost_per_unit NUMERIC(12,6) NOT NULL DEFAULT 0,      -- total_cost / batch_yield_qty
  
  -- Status
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','archived')),
  
  -- Metadata
  method TEXT,                 -- preparation instructions
  notes TEXT,
  image_url TEXT,
  prep_time_minutes INTEGER,
  cook_time_minutes INTEGER,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  
  UNIQUE(organization_id, code)
);

-- Sub Recipe Ingredients (each sub recipe has N ingredient rows)
CREATE TABLE sub_recipe_ingredients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sub_recipe_id UUID NOT NULL REFERENCES sub_recipes(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  
  -- Reference: either a product or another sub recipe
  product_id UUID REFERENCES products(id) ON DELETE RESTRICT,
  ref_sub_recipe_id UUID REFERENCES sub_recipes(id) ON DELETE RESTRICT,
  -- CHECK: exactly one must be set
  CONSTRAINT one_reference CHECK (
    (product_id IS NOT NULL AND ref_sub_recipe_id IS NULL) OR
    (product_id IS NULL AND ref_sub_recipe_id IS NOT NULL)
  ),
  
  quantity NUMERIC(10,4) NOT NULL,
  unit_id UUID NOT NULL REFERENCES units(id),
  
  -- Computed
  cost NUMERIC(12,6) NOT NULL DEFAULT 0,   -- quantity * ingredient cost_per_unit
  
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Recipes (maps to Recipes.xlsm - 85 recipes with 26 ingredient rows each)
CREATE TABLE recipes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT,
  category_id UUID REFERENCES recipe_categories(id),
  description TEXT,
  
  -- Yield
  yield_qty NUMERIC(10,3) NOT NULL DEFAULT 1,       -- number of portions/servings
  yield_unit_id UUID REFERENCES units(id),           -- e.g., 'portions'
  yield_weight_g NUMERIC(10,2),                       -- total weight in grams (for nutrition)
  portion_weight_g NUMERIC(10,2),                     -- weight per portion in grams
  
  -- Pricing (AED)
  selling_price NUMERIC(12,2) NOT NULL DEFAULT 0,     -- menu price excl. VAT
  selling_price_incl_vat NUMERIC(12,2) NOT NULL DEFAULT 0,
  vat_percentage NUMERIC(5,2) NOT NULL DEFAULT 5,     -- UAE VAT default 5%
  
  -- Computed costs
  total_cost NUMERIC(12,4) NOT NULL DEFAULT 0,
  cost_per_portion NUMERIC(12,4) NOT NULL DEFAULT 0,
  food_cost_percentage NUMERIC(5,2) NOT NULL DEFAULT 0, -- (total_cost / selling_price) * 100
  contribution_margin NUMERIC(12,4) NOT NULL DEFAULT 0, -- selling_price - total_cost
  
  -- Status workflow
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','testing','active','archived','discontinued')),
  
  -- Metadata
  method TEXT,                 -- step-by-step instructions
  notes TEXT,
  image_url TEXT,
  prep_time_minutes INTEGER,
  cook_time_minutes INTEGER,
  rest_time_minutes INTEGER,
  difficulty TEXT CHECK (difficulty IN ('easy','medium','hard','expert')),
  tags TEXT[] DEFAULT '{}',
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  
  UNIQUE(organization_id, code)
);

-- Recipe Categories
CREATE TABLE recipe_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  color TEXT,
  icon TEXT,
  parent_id UUID REFERENCES recipe_categories(id),  -- hierarchical categories
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, name)
);

-- Recipe Ingredients (up to 26 per recipe, matching Excel template)
CREATE TABLE recipe_ingredients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  
  -- Section header (for grouping ingredients in the UI)
  is_section_header BOOLEAN NOT NULL DEFAULT false,
  section_name TEXT,
  
  -- Reference: product, sub recipe, or another recipe
  product_id UUID REFERENCES products(id) ON DELETE RESTRICT,
  sub_recipe_id UUID REFERENCES sub_recipes(id) ON DELETE RESTRICT,
  ref_recipe_id UUID REFERENCES recipes(id) ON DELETE RESTRICT,
  CONSTRAINT one_ref_or_header CHECK (
    is_section_header = true OR (
      (product_id IS NOT NULL)::int + 
      (sub_recipe_id IS NOT NULL)::int + 
      (ref_recipe_id IS NOT NULL)::int = 1
    )
  ),
  
  quantity NUMERIC(10,4),
  unit_id UUID REFERENCES units(id),
  
  -- Computed
  cost NUMERIC(12,6) NOT NULL DEFAULT 0,
  
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_sub_recipes_org ON sub_recipes(organization_id);
CREATE INDEX idx_sub_recipe_ingredients_sub ON sub_recipe_ingredients(sub_recipe_id);
CREATE INDEX idx_recipes_org ON recipes(organization_id);
CREATE INDEX idx_recipe_ingredients_recipe ON recipe_ingredients(recipe_id);
CREATE INDEX idx_recipes_category ON recipes(category_id);
CREATE INDEX idx_recipes_status ON recipes(organization_id, status);
```

#### Database Functions

```sql
-- Recalculate sub recipe costs when ingredients change
CREATE OR REPLACE FUNCTION recalculate_sub_recipe_cost(p_sub_recipe_id UUID)
RETURNS VOID AS $$
DECLARE
  v_total NUMERIC(12,4);
  v_yield NUMERIC(10,3);
BEGIN
  SELECT COALESCE(SUM(cost), 0) INTO v_total
  FROM sub_recipe_ingredients WHERE sub_recipe_id = p_sub_recipe_id;
  
  SELECT batch_yield_qty INTO v_yield
  FROM sub_recipes WHERE id = p_sub_recipe_id;
  
  UPDATE sub_recipes SET
    total_cost = v_total,
    cost_per_unit = CASE WHEN v_yield > 0 THEN v_total / v_yield ELSE 0 END,
    updated_at = now()
  WHERE id = p_sub_recipe_id;
END;
$$ LANGUAGE plpgsql;

-- Recalculate recipe costs when ingredients change
CREATE OR REPLACE FUNCTION recalculate_recipe_cost(p_recipe_id UUID)
RETURNS VOID AS $$
DECLARE
  v_total NUMERIC(12,4);
  v_yield NUMERIC(10,3);
  v_price NUMERIC(12,2);
  v_margin NUMERIC(12,4);
  v_pct NUMERIC(5,2);
BEGIN
  SELECT COALESCE(SUM(cost), 0) INTO v_total
  FROM recipe_ingredients WHERE recipe_id = p_recipe_id AND is_section_header = false;
  
  SELECT yield_qty, selling_price INTO v_yield, v_price
  FROM recipes WHERE id = p_recipe_id;
  
  -- Apply security margin
  v_total := v_total * 1.05;
  
  v_margin := CASE WHEN v_price > 0 THEN v_price - (v_total / NULLIF(v_yield, 0)) ELSE 0 END;
  v_pct := CASE WHEN v_price > 0 THEN ((v_total / NULLIF(v_yield, 0)) / v_price) * 100 ELSE 0 END;
  
  UPDATE recipes SET
    total_cost = v_total,
    cost_per_portion = CASE WHEN v_yield > 0 THEN v_total / v_yield ELSE 0 END,
    food_cost_percentage = v_pct,
    contribution_margin = v_margin,
    updated_at = now()
  WHERE id = p_recipe_id;
END;
$$ LANGUAGE plpgsql;
```

### 2.3 UI Changes

| Screen | Route | Description |
|--------|-------|-------------|
| Sub Recipes List | `/sub-recipes` | Searchable list with cost, yield, status |
| Sub Recipe Detail | `/sub-recipes/:id` | Ingredient rows, batch costing, method |
| Sub Recipe Create | `/sub-recipes/new` | Same form as detail |
| Recipes List | `/recipes` | Searchable list with cost, price, margin |
| Recipe Detail | `/recipes/:id` | Full recipe with ingredients, costing, pricing |
| Recipe Create | `/recipes/new` | Same form as detail |
| Recipe Categories | `/settings/recipe-categories` | Category management |

### 2.4 Business Logic

#### Cost Roll-Up Chain

```typescript
// When a product price changes:
// 1. Recalculate product.cost_per_recipe_unit
// 2. Find all sub_recipe_ingredients referencing this product
// 3. Recalculate each sub_recipe_ingredient.cost = quantity * product.cost_per_recipe_unit
// 4. Recalculate each parent sub_recipe's total_cost and cost_per_unit
// 5. Find all recipe_ingredients referencing affected sub_recipes
// 6. Recalculate each recipe_ingredient.cost
// 7. Recalculate each parent recipe's totals

function calculateIngredientCost(
  quantity: number,
  unitId: string,
  ingredientType: 'product' | 'sub_recipe' | 'recipe',
  ingredientId: string,
  units: Unit[]
): number {
  if (ingredientType === 'product') {
    const product = getProduct(ingredientId);
    const convertedQty = convertUnits(quantity, unitId, product.recipe_unit_id, units);
    return convertedQty * product.cost_per_recipe_unit;
  }
  if (ingredientType === 'sub_recipe') {
    const subRecipe = getSubRecipe(ingredientId);
    const convertedQty = convertUnits(quantity, unitId, subRecipe.batch_yield_unit_id, units);
    return convertedQty * subRecipe.cost_per_unit;
  }
  // ... similar for recipe reference
}
```

#### Recipe Scaling

```typescript
function scaleRecipe(recipe: Recipe, targetYield: number): ScaledRecipe {
  const scaleFactor = targetYield / recipe.yield_qty;
  return {
    ...recipe,
    yield_qty: targetYield,
    ingredients: recipe.ingredients.map(ing => ({
      ...ing,
      quantity: ing.quantity * scaleFactor,
      cost: ing.cost * scaleFactor,
    })),
    total_cost: recipe.total_cost * scaleFactor,
    // cost_per_portion stays the same
    // food_cost_percentage stays the same
  };
}
```

### 2.5 Testing

| Test | Type | Description |
|------|------|-------------|
| Sub recipe CRUD | Integration | Create, edit, delete sub recipes with ingredients |
| Recipe CRUD | Integration | Create, edit, delete recipes with mixed ingredients |
| Cost roll-up | Unit | Product -> Sub Recipe -> Recipe cost chain |
| Unit conversion | Unit | g to kg, ml to L, edge cases |
| Scaling | Unit | Scale recipe by 0.5x, 2x, 10x, verify proportions |
| Circular reference | Unit | Sub recipe A -> Sub recipe B -> Sub recipe A rejected |
| Status workflow | Integration | Draft -> Testing -> Active -> Archived transitions |

Edge cases:
- Sub recipe with 0 yield quantity
- Recipe with no ingredients
- Ingredient referencing a deleted product (RESTRICT should prevent)
- Very small quantities (0.001g)
- Very large batches (10000 portions)
- Scaling to 0 (should be prevented)

### 2.6 Acceptance Criteria

- [ ] User can create a sub recipe with a batch yield and unit
- [ ] User can add products as ingredients to a sub recipe
- [ ] User can add other sub recipes as ingredients (nesting)
- [ ] Sub recipe total cost and cost per unit auto-calculate
- [ ] User can create a recipe with products, sub recipes, or other recipes as ingredients
- [ ] Recipe total cost, cost per portion, food cost %, and contribution margin auto-calculate
- [ ] Ingredient auto-lookup shows product/sub recipe search with name, code, category
- [ ] User can scale a recipe and see adjusted quantities
- [ ] User can add section headers to organize ingredients
- [ ] User can reorder ingredients via drag-and-drop
- [ ] Status transitions enforce the workflow (draft -> testing -> active -> archived)
- [ ] Cost roll-up propagates: changing a product price updates affected sub recipes and recipes
- [ ] Circular references are detected and prevented

### 2.7 Lovable Prompts

---

#### Prompt 2.1: Sub Recipe List Page

```
Build the Sub Recipes list page at route `/sub-recipes`.

PAGE: `src/pages/SubRecipesPage.tsx`

HEADER:
- Title "Sub Recipes" (text-2xl font-bold)
- Subtitle "Base preparations, sauces, doughs, and components" (text-sm text-zinc-500)
- "New Sub Recipe" Button (brand-600, Plus icon) -> /sub-recipes/new

FILTER BAR:
- Search input (Input, Search icon, placeholder "Search sub recipes...", w-80)
- Category filter: Select with options derived from distinct sub_recipes.category values, plus "All"
- Status filter: Select with "All", "Draft", "Active", "Archived"

STATS ROW (4 cards in a grid, gap-4, grid-cols-4 on desktop, grid-cols-2 on mobile):
- Total Sub Recipes (count)
- Active (count where status = 'active')
- Average Cost (avg of cost_per_unit, formatted AED)
- Recently Updated (count updated in last 7 days)
Each card: bg-white border rounded-lg p-4, icon in top-right (text-zinc-400), value in text-2xl font-bold, label in text-sm text-zinc-500.

DATA TABLE (shadcn Table):
Columns:
1. Name (font-medium, click to navigate to detail)
2. Category (Badge, muted variant)
3. Batch Yield (e.g., "5.000 kg")
4. Ingredients (count of sub_recipe_ingredients)
5. Total Cost (right-aligned, "AED 125.50")
6. Cost/Unit (right-aligned, "AED 25.10")
7. Status (Badge: draft=zinc, active=green, archived=zinc with line-through)
8. Updated (relative time: "2 hours ago", using date-fns formatDistanceToNow)
9. Actions (DropdownMenu: Edit, Duplicate, Archive/Activate, Delete)

On row click -> navigate to `/sub-recipes/:id`

SUPABASE QUERY:
```typescript
supabase
  .from('sub_recipes')
  .select(`
    *,
    batch_yield_unit:units!sub_recipes_batch_yield_unit_id_fkey(abbreviation),
    ingredients:sub_recipe_ingredients(count)
  `, { count: 'exact' })
  .eq('organization_id', orgId)
```

Pagination: 20 per page. Loading skeletons. Empty state with illustration.

RESPONSIVE: Card view on mobile with name, category badge, cost/unit, status badge.
```

**Expected Output:** Sub recipe list page with stats cards, search/filter, sortable table, pagination, and mobile card layout.

---

#### Prompt 2.2: Sub Recipe Detail / Create Form

```
Build the Sub Recipe detail and create form at `/sub-recipes/new` and `/sub-recipes/:id`.

PAGE: `src/pages/SubRecipeDetailPage.tsx`

HEADER:
- Back button -> /sub-recipes
- Title: "New Sub Recipe" or sub recipe name
- Status Badge (draft/active/archived)
- Right: "Save" Button + Status dropdown (DropdownMenu to change status)

LAYOUT: Two-column on desktop (65/35 split), single column on mobile.

LEFT COLUMN:

CARD 1: "Details"
- Name* (Input)
- Code (Input, optional)
- Category (Combobox - searchable Select, options: Sauce, Dough, Marinade, Stock, Paste, Garnish, Base, Brine, Cure, Mix, Other + custom)
- Description (Textarea, 2 rows)

CARD 2: "Batch Yield"
- Yield Quantity* (Input number, step 0.001)
- Yield Unit* (Select from units table)
- Display: "This recipe makes {qty} {unit}" in text-sm text-zinc-500

CARD 3: "Ingredients" (THE CORE COMPONENT)
This is the most important part. Build an interactive ingredient table:

TABLE HEADER: "Ingredients" + "Add Ingredient" Button (outline, Plus icon)

Each ingredient row (full width, border-b, py-2):
- Drag handle (GripVertical icon, cursor-grab)
- Ingredient selector: Combobox that searches across:
  - Products (show with Package icon, category badge)
  - Sub Recipes (show with FlaskConical icon, "Sub Recipe" badge)
  Search matches on name, code, brand. Grouped in dropdown.
  Display format: "[icon] Name (code) - Category"
- Quantity (Input number, w-24, step 0.001)
- Unit (Select, filtered to compatible units based on ingredient type)
- Cost (read-only, right-aligned, auto-calculated, text-zinc-500)
- Delete button (Trash2 icon, text-red-500 on hover)

Below the table:
- "Add Ingredient" button (outline variant, full width on mobile, dashed border)

Cost calculation per ingredient:
```typescript
// For product ingredients:
cost = quantity * convertUnits(1, unit_id, product.recipe_unit_id) * product.cost_per_recipe_unit

// For sub recipe ingredients:
cost = quantity * convertUnits(1, unit_id, sub_recipe.batch_yield_unit_id) * sub_recipe.cost_per_unit
```

Drag-and-drop reordering using @dnd-kit/sortable.

CARD 4: "Method" (collapsible)
- Textarea (8 rows, placeholder "Preparation steps...")
- Support for numbered steps (auto-number lines starting with "1.")

RIGHT COLUMN:

CARD 5: "Cost Summary" (sticky on desktop, top-20)
- Background: bg-zinc-50 dark:bg-zinc-900
- Total Ingredient Cost: AED XX.XX (text-lg font-bold)
- Batch Yield: X.XXX unit
- Cost per Unit: AED XX.XXXX (text-2xl font-bold text-brand-600)
- Divider
- With Security Margin (5%): AED XX.XXXX
- Ingredient breakdown: mini bar chart showing each ingredient's % of total cost
  - Each bar: colored by ingredient type (products = blue, sub recipes = purple)
  - Label: ingredient name + percentage

CARD 6: "Metadata"
- Prep Time (Input number, suffix "min")
- Cook Time (Input number, suffix "min")
- Total Time (computed, read-only)
- Image upload (Supabase Storage)
- Notes (Textarea, 3 rows)

SAVE BEHAVIOR:
- On save: 
  1. UPSERT sub_recipe record
  2. DELETE existing sub_recipe_ingredients for this sub_recipe
  3. INSERT new sub_recipe_ingredients with sort_order
  4. Call recalculate_sub_recipe_cost RPC
- Use optimistic updates
- Toast on success

VALIDATION:
- Name required
- Batch yield > 0
- At least 1 ingredient
- No duplicate ingredients
- Circular reference check: sub recipe cannot reference itself or any sub recipe that references it

RESPONSIVE:
- On mobile: single column, cost summary moves above ingredients
- Ingredient rows: stack quantity+unit on second line on mobile
```

**Expected Output:** Full sub recipe editor with interactive ingredient table, auto-lookup combobox, drag-and-drop reorder, real-time cost calculation, cost breakdown chart, and responsive layout.

---

#### Prompt 2.3: Recipe List Page

```
Build the Recipes list page at route `/recipes`.

PAGE: `src/pages/RecipesPage.tsx`

HEADER:
- Title "Recipes" (text-2xl font-bold)
- Subtitle "Manage your menu recipes with full costing and nutrition"
- "New Recipe" Button (brand-600, Plus icon)

FILTER BAR:
- Search input (w-80)
- Category filter (Select from recipe_categories)
- Status filter: "All", "Draft", "Testing", "Active", "Archived", "Discontinued"
- Cost filter: "All", "Under Target", "Over Target", "No Price Set"
- View toggle: Grid view (LayoutGrid icon) / List view (List icon)

STATS ROW (5 cards):
- Total Recipes (count)
- Active (count)
- Avg Food Cost % (with color: green if < 30%, amber 30-35%, red > 35%)
- Avg Margin (AED)
- Recipes Over Target (count where food_cost_percentage > 35, red text)

LIST VIEW (shadcn Table):
Columns:
1. Image thumbnail (40x40 rounded, or placeholder with ChefHat icon)
2. Name (font-medium) + Category badge below
3. Portions (yield_qty + "portions")
4. Total Cost ("AED XX.XX")
5. Cost/Portion ("AED XX.XX")
6. Selling Price ("AED XX.XX")
7. Food Cost % (colored: green < 30, amber 30-35, red > 35, bold)
8. Margin ("AED XX.XX")
9. Status (colored Badge)
10. Actions (Edit, Duplicate, Scale, Archive)

GRID VIEW (alternative view, grid-cols-3 desktop, 2 tablet, 1 mobile):
Each card:
- Image (aspect-video, or gradient placeholder)
- Name (font-medium, truncate)
- Category badge
- Three stats in a row: Cost/Portion | Food Cost % | Margin
- Status badge at bottom-right
- Click to navigate to detail

SUPABASE:
```typescript
supabase
  .from('recipes')
  .select(`
    *,
    category:recipe_categories(id, name, color),
    ingredients:recipe_ingredients(count)
  `, { count: 'exact' })
  .eq('organization_id', orgId)
```

Pagination, loading skeletons, empty state.
```

**Expected Output:** Recipe list page with both list and grid views, cost-based filtering, color-coded food cost %, and comprehensive stats.

---

#### Prompt 2.4: Recipe Detail / Create Form

```
Build the Recipe detail and create form at `/recipes/new` and `/recipes/:id`.

PAGE: `src/pages/RecipeDetailPage.tsx`

HEADER:
- Back button -> /recipes
- Title + Status Badge
- Right: "Scale" Button (outline, Scale3D icon) + "Save" Button (brand-600)
- Status workflow dropdown

LAYOUT: Two-column (65/35) on desktop, single column on mobile.

LEFT COLUMN:

CARD 1: "Details"
- Name* (Input)
- Code (Input)
- Category (Select from recipe_categories with color dots)
- Description (Textarea, 2 rows)
- Difficulty (Select: Easy, Medium, Hard, Expert)
- Tags (tag input, allow custom)

CARD 2: "Yield & Pricing"
- 2-column grid:
  - Portions* (Input number, step 1, label "Number of Portions")
  - Portion Size (Input number, step 0.01, suffix "g")
  - Selling Price excl. VAT* (Input number, step 0.01, prefix "AED")
  - VAT % (Input number, default 5)
  - Selling Price incl. VAT (computed, read-only: price * (1 + vat/100))

CARD 3: "Ingredients" (THE CORE - same pattern as sub recipe but enhanced)
- "Add Ingredient" Button + "Add Section" Button (Heading icon, creates a section divider)

Section header row (when is_section_header = true):
- Full-width text input, font-semibold text-sm text-zinc-500 uppercase tracking-wide
- Drag handle + delete button
- Example: "--- SAUCE COMPONENTS ---"

Ingredient row:
- Drag handle
- Ingredient Combobox: searches Products, Sub Recipes, AND Recipes
  - Products: Package icon, show purchase price info
  - Sub Recipes: FlaskConical icon, show cost/unit
  - Recipes: ChefHat icon, show cost/portion
  Grouped sections in dropdown with headers
- Quantity (Input number, w-24)
- Unit (Select, compatible units)
- Cost (read-only, auto-calculated)
- % of Total (read-only, computed, text-xs text-zinc-400)
- Delete button

After all ingredients, show:
- Subtotal line (font-semibold, border-t)
- Security Margin line (+5%, text-sm text-zinc-500)
- Total Cost line (text-lg font-bold)

CARD 4: "Method" (collapsible)
- Rich-ish textarea: numbered steps, each on a new line
- "Add Step" button appends a new numbered line

CARD 5: "Timing" (collapsible)
- 3-column grid: Prep Time (min) | Cook Time (min) | Rest Time (min)
- Total Time (computed, read-only, font-medium)

RIGHT COLUMN:

CARD 6: "Cost Analysis" (sticky, top-20)
- Background: bg-zinc-50 dark:bg-zinc-900 border
- Large food cost % display:
  - Circular progress/gauge showing food_cost_percentage
  - Color: green < 30%, amber 30-35%, red > 35%
  - Center: percentage value in text-3xl font-bold
- Below the gauge:
  | Label              | Value          |
  |--------------------|----------------|
  | Total Cost         | AED XX.XX      |
  | Cost per Portion   | AED XX.XX      |
  | Selling Price      | AED XX.XX      |
  | Contribution Margin| AED XX.XX      |
  | Food Cost %        | XX.X%          |
- Divider
- "Recommended Price" suggestion:
  - At 30% food cost: AED XX.XX
  - At 25% food cost: AED XX.XX
  (calculated as: total_cost / target_percentage)

CARD 7: "Ingredient Cost Breakdown"
- Horizontal stacked bar showing ingredient costs as proportions
- Legend below with ingredient names + AED amounts
- Top 5 most expensive ingredients listed

CARD 8: "Image & Notes"
- Image upload
- Notes textarea

SCALE DIALOG (opens from "Scale" button):
- shadcn Dialog
- Title: "Scale Recipe"
- Current portions: {yield_qty} (read-only)
- Target portions (Input number)
- Scale factor (computed, read-only: target / current)
- Preview of adjusted ingredient quantities in a mini table
- "Apply" Button (updates all quantities and yield, recalculates costs)
- "Cancel" Button

SAVE:
1. UPSERT recipe record
2. DELETE + INSERT recipe_ingredients
3. Call recalculate_recipe_cost RPC
4. Toast notification
5. Invalidate related queries

VALIDATION:
- Name required
- At least 1 non-header ingredient
- Yield > 0
- Selling price >= 0
- No circular references (recipe cannot contain itself)
```

**Expected Output:** Complete recipe editor with section headers, mixed ingredient types (products, sub recipes, recipes), real-time cost gauge, contribution margin, scaling dialog, and responsive layout.

---

#### Prompt 2.5: Cost Engine and Auto-Calculation

```
Build the cost calculation engine as a shared utility and integrate it with the ingredient forms.

FILE: `src/lib/costEngine.ts`

UNIT CONVERSION:
```typescript
interface Unit {
  id: string;
  abbreviation: string;
  unit_type: string;
  base_unit_id: string | null;
  conversion_factor: number;
}

// Convert quantity from one unit to another
// Both units must be same unit_type
// Convert source to base, then base to target
export function convertUnits(
  quantity: number,
  fromUnitId: string,
  toUnitId: string,
  units: Unit[]
): number {
  if (fromUnitId === toUnitId) return quantity;
  
  const fromUnit = units.find(u => u.id === fromUnitId);
  const toUnit = units.find(u => u.id === toUnitId);
  
  if (!fromUnit || !toUnit) throw new Error('Unit not found');
  if (fromUnit.unit_type !== toUnit.unit_type) throw new Error('Incompatible unit types');
  
  // Convert to base unit, then to target
  const inBaseUnits = quantity * fromUnit.conversion_factor;
  return inBaseUnits / toUnit.conversion_factor;
}
```

COST CALCULATIONS:
```typescript
// Product cost per recipe unit
export function productCostPerRecipeUnit(product: Product): number {
  const pricePerSingle = product.purchase_price / product.purchase_unit_qty;
  const afterWaste = pricePerSingle / (1 - product.waste_percentage / 100);
  return afterWaste / product.recipe_unit_conversion;
}

// Ingredient line cost
export function ingredientCost(
  quantity: number,
  unitId: string,
  ingredient: Product | SubRecipe | Recipe,
  ingredientType: 'product' | 'sub_recipe' | 'recipe',
  units: Unit[]
): number {
  switch (ingredientType) {
    case 'product': {
      const p = ingredient as Product;
      const qtyInRecipeUnits = convertUnits(quantity, unitId, p.recipe_unit_id, units);
      return qtyInRecipeUnits * p.cost_per_recipe_unit;
    }
    case 'sub_recipe': {
      const sr = ingredient as SubRecipe;
      const qtyInYieldUnits = convertUnits(quantity, unitId, sr.batch_yield_unit_id, units);
      return qtyInYieldUnits * sr.cost_per_unit;
    }
    case 'recipe': {
      const r = ingredient as Recipe;
      // For recipe references, cost is per portion
      return quantity * r.cost_per_portion;
    }
  }
}

// Recipe totals
export function recipeFinancials(
  ingredientCosts: number[],
  yieldQty: number,
  sellingPrice: number,
  securityMarginPct: number = 5
): RecipeFinancials {
  const subtotal = ingredientCosts.reduce((sum, c) => sum + c, 0);
  const withMargin = subtotal * (1 + securityMarginPct / 100);
  const costPerPortion = yieldQty > 0 ? withMargin / yieldQty : 0;
  const foodCostPct = sellingPrice > 0 ? (costPerPortion / sellingPrice) * 100 : 0;
  const contributionMargin = sellingPrice - costPerPortion;
  
  return {
    subtotal,
    securityMargin: withMargin - subtotal,
    totalCost: withMargin,
    costPerPortion,
    foodCostPercentage: foodCostPct,
    contributionMargin,
    recommendedPrices: {
      at25pct: costPerPortion / 0.25,
      at30pct: costPerPortion / 0.30,
      at35pct: costPerPortion / 0.35,
    }
  };
}
```

REACT HOOK `src/hooks/useIngredientCost.ts`:
```typescript
export function useIngredientCost(ingredients: IngredientRow[], units: Unit[]) {
  return useMemo(() => {
    return ingredients
      .filter(i => !i.is_section_header && i.ingredientData)
      .map(ing => ({
        ...ing,
        calculatedCost: ingredientCost(
          ing.quantity,
          ing.unit_id,
          ing.ingredientData,
          ing.ingredientType,
          units
        )
      }));
  }, [ingredients, units]);
}
```

INGREDIENT COMBOBOX `src/components/recipe/IngredientCombobox.tsx`:
- Uses shadcn Popover + Command (cmdk)
- Search input at top
- Three groups:
  - "Products" (Package icon): search products by name, code, brand
  - "Sub Recipes" (FlaskConical icon): search sub_recipes by name, code
  - "Recipes" (ChefHat icon): search recipes by name, code
- Each item shows: icon + name + code in parentheses + cost info on right
- Debounced search (200ms)
- Queries all three tables in parallel using Promise.all
- Selected item populates: ingredient reference + default unit + cost display

COST PROPAGATION:
Create a Supabase Edge Function `functions/propagate-cost-change/index.ts`:
- Triggered when product.cost_per_recipe_unit changes
- Finds all sub_recipe_ingredients referencing this product
- Recalculates their costs
- Recalculates parent sub_recipes
- Finds all recipe_ingredients referencing affected sub_recipes
- Recalculates their costs
- Recalculates parent recipes
- Uses a recursive CTE to handle multi-level nesting

This should be triggered via a database webhook on product updates, or called explicitly from the client after a product price change.

CIRCULAR REFERENCE CHECK:
```typescript
export function hasCircularReference(
  entityId: string,
  entityType: 'sub_recipe' | 'recipe',
  referencedId: string,
  referencedType: 'sub_recipe' | 'recipe',
  graph: Map<string, string[]> // adjacency list
): boolean {
  // BFS from referencedId to see if we can reach entityId
  const visited = new Set<string>();
  const queue = [referencedId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === entityId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    const children = graph.get(current) || [];
    queue.push(...children);
  }
  return false;
}
```

Integrate all these utilities into the Sub Recipe and Recipe detail pages from Prompts 2.2 and 2.4. The ingredient cost should update in real-time as the user types quantities, and the cost summary cards should reflect changes immediately.
```

**Expected Output:** Complete cost calculation engine with unit conversion, ingredient costing, recipe financials, cost propagation, circular reference detection, and the reusable IngredientCombobox component.

---

#### Prompt 2.6: Recipe Categories Settings Page

```
Build the Recipe Categories settings page at `/settings/recipe-categories`.

PAGE: `src/pages/settings/RecipeCategoriesPage.tsx`

Extend the Settings layout from Prompt 1.5 with a new tab/nav item: "Recipe Categories" (ChefHat icon).

This page is identical in layout to the Product Categories page (Prompt 1.5, Page 2) with these differences:

- Title: "Recipe Categories"
- Categories support hierarchy: each category has an optional parent_id
- Display as an indented tree:
  - Top-level categories at root
  - Child categories indented with ml-6 and a subtle connector line
  - Each category shows: color dot | name (inline editable) | recipe count | drag handle | add child button | delete button
- "Add Category" at top creates a top-level category
- "Add Child" on each row creates a child under that category
- Maximum 2 levels of nesting

SUPABASE:
- Table: recipe_categories
- Fetch: `supabase.from('recipe_categories').select('*, recipes(count)').eq('organization_id', orgId).order('sort_order')`
- Build tree structure in the component from flat data using parent_id

Default seed categories:
- Appetizers
- Soups
- Salads
- Main Courses
  - Meat
  - Poultry
  - Seafood
  - Vegetarian
- Sides
- Desserts
- Beverages
- Breads & Bakery
- Sauces & Dressings
- Breakfast
```

**Expected Output:** Hierarchical recipe category management with drag-reorder, inline editing, parent-child relationships, and recipe count badges.

---

### 2.8 Expected Output Summary

After Phase 2, the application has:

- Full sub recipe system with batch costing
- Full recipe system with mixed ingredient types
- Real-time cost calculations throughout the ingredient hierarchy
- Recipe scaling with proportional adjustments
- Ingredient auto-lookup across products, sub recipes, and recipes
- Section headers for organizing ingredients
- Drag-and-drop ingredient reordering
- Food cost %, contribution margin, and recommended pricing
- Status workflow for recipes
- Hierarchical recipe categories

### 2.9 Dependencies

- Phase 1 complete (auth, products, units, categories, shell)
- Units table populated with standard units
- Products table has data (at least seed data for testing)

---

## Phase 3: Nutrition & Allergens (Weeks 7-8)

### 3.1 Objectives

- Build the nutrition calculation engine that rolls up from products through sub recipes to recipes
- Display nutrition per recipe, per portion, and as % RDA
- Implement allergen management with inheritance chain
- Generate allergen matrices for menus

### 3.2 Database Changes

#### New Tables and Columns

```sql
-- Nutrition profiles for sub recipes and recipes (computed, stored)
-- Products already have nutrition columns from Phase 1

ALTER TABLE sub_recipes ADD COLUMN energy_kcal NUMERIC(10,2) DEFAULT 0;
ALTER TABLE sub_recipes ADD COLUMN energy_kj NUMERIC(10,2) DEFAULT 0;
ALTER TABLE sub_recipes ADD COLUMN protein_g NUMERIC(10,2) DEFAULT 0;
ALTER TABLE sub_recipes ADD COLUMN carbohydrate_g NUMERIC(10,2) DEFAULT 0;
ALTER TABLE sub_recipes ADD COLUMN sugar_g NUMERIC(10,2) DEFAULT 0;
ALTER TABLE sub_recipes ADD COLUMN fat_g NUMERIC(10,2) DEFAULT 0;
ALTER TABLE sub_recipes ADD COLUMN saturated_fat_g NUMERIC(10,2) DEFAULT 0;
ALTER TABLE sub_recipes ADD COLUMN fibre_g NUMERIC(10,2) DEFAULT 0;
ALTER TABLE sub_recipes ADD COLUMN sodium_mg NUMERIC(10,2) DEFAULT 0;

ALTER TABLE recipes ADD COLUMN energy_kcal NUMERIC(10,2) DEFAULT 0;
ALTER TABLE recipes ADD COLUMN energy_kj NUMERIC(10,2) DEFAULT 0;
ALTER TABLE recipes ADD COLUMN protein_g NUMERIC(10,2) DEFAULT 0;
ALTER TABLE recipes ADD COLUMN carbohydrate_g NUMERIC(10,2) DEFAULT 0;
ALTER TABLE recipes ADD COLUMN sugar_g NUMERIC(10,2) DEFAULT 0;
ALTER TABLE recipes ADD COLUMN fat_g NUMERIC(10,2) DEFAULT 0;
ALTER TABLE recipes ADD COLUMN saturated_fat_g NUMERIC(10,2) DEFAULT 0;
ALTER TABLE recipes ADD COLUMN fibre_g NUMERIC(10,2) DEFAULT 0;
ALTER TABLE recipes ADD COLUMN sodium_mg NUMERIC(10,2) DEFAULT 0;

-- Sub recipe allergens (inherited from ingredients)
CREATE TABLE sub_recipe_allergens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sub_recipe_id UUID NOT NULL REFERENCES sub_recipes(id) ON DELETE CASCADE,
  allergen_id UUID NOT NULL REFERENCES allergens(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('contains','may_contain','free_from')) DEFAULT 'contains',
  source_type TEXT NOT NULL CHECK (source_type IN ('inherited','manual')),
  source_product_id UUID REFERENCES products(id),
  source_sub_recipe_id UUID REFERENCES sub_recipes(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(sub_recipe_id, allergen_id)
);

-- Recipe allergens (inherited from ingredients)
CREATE TABLE recipe_allergens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  allergen_id UUID NOT NULL REFERENCES allergens(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('contains','may_contain','free_from')) DEFAULT 'contains',
  source_type TEXT NOT NULL CHECK (source_type IN ('inherited','manual')),
  source_product_id UUID REFERENCES products(id),
  source_sub_recipe_id UUID REFERENCES sub_recipes(id),
  source_recipe_id UUID REFERENCES recipes(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(recipe_id, allergen_id)
);

-- RDA reference values
CREATE TABLE rda_values (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nutrient TEXT NOT NULL UNIQUE,
  daily_value NUMERIC(10,2) NOT NULL,
  unit TEXT NOT NULL,
  source TEXT DEFAULT 'EU Regulation 1169/2011'
);

-- Seed RDA values
INSERT INTO rda_values (nutrient, daily_value, unit) VALUES
  ('energy_kcal', 2000, 'kcal'),
  ('energy_kj', 8400, 'kJ'),
  ('protein_g', 50, 'g'),
  ('carbohydrate_g', 260, 'g'),
  ('sugar_g', 90, 'g'),
  ('fat_g', 70, 'g'),
  ('saturated_fat_g', 20, 'g'),
  ('fibre_g', 25, 'g'),
  ('sodium_mg', 2400, 'mg');
```

### 3.3 UI Changes

| Screen | Route | Description |
|--------|-------|-------------|
| Recipe Nutrition Tab | `/recipes/:id/nutrition` | Nutrition display within recipe detail |
| Allergen Matrix | `/allergens` | Matrix view of all recipes vs allergens |
| Product Allergens | (within product form) | Enhanced allergen section |

### 3.4 Business Logic

#### Nutrition Calculation

```typescript
// Nutrition values are stored per 100g on products
// To calculate for an ingredient row:
// 1. Convert ingredient quantity to grams
// 2. Calculate: (quantity_in_grams / 100) * nutrient_per_100g

function calculateIngredientNutrition(
  quantity: number,
  unitId: string,
  product: Product,
  units: Unit[]
): NutritionValues {
  const qtyInGrams = convertUnits(quantity, unitId, gramUnitId, units);
  const factor = qtyInGrams / 100;
  
  return {
    energy_kcal: product.energy_kcal * factor,
    energy_kj: product.energy_kj * factor,
    protein_g: product.protein_g * factor,
    carbohydrate_g: product.carbohydrate_g * factor,
    sugar_g: product.sugar_g * factor,
    fat_g: product.fat_g * factor,
    saturated_fat_g: product.saturated_fat_g * factor,
    fibre_g: product.fibre_g * factor,
    sodium_mg: product.sodium_mg * factor,
  };
}

// Sub recipe nutrition = sum of all ingredient nutritions
// Recipe nutrition = sum of all ingredient nutritions (including sub recipe ingredients)
// Per portion = total / yield_qty
// % RDA = (per_portion / rda_daily_value) * 100
// Macro energy split:
//   protein_energy = protein_g * 4 (kcal)
//   carb_energy = carbohydrate_g * 4 (kcal)
//   fat_energy = fat_g * 9 (kcal)
//   total = protein_energy + carb_energy + fat_energy
//   each_pct = (each / total) * 100
```

#### Allergen Inheritance

```
Product allergens are the source of truth.
Sub recipe allergens: Union of all ingredient product allergens + manual overrides
Recipe allergens: Union of all ingredient allergens (products + sub recipes + recipes) + manual overrides

Inheritance rules:
- If ANY ingredient "contains" allergen X -> recipe "contains" X
- If ANY ingredient "may_contain" allergen X (and none "contains") -> recipe "may_contain" X
- "free_from" only applies if explicitly set and no ingredient contains/may_contain
- Manual overrides can escalate (may_contain -> contains) but not downgrade (contains -> free_from) unless the ingredient is removed
```

### 3.5 Testing

| Test | Type | Description |
|------|------|-------------|
| Nutrition rollup | Unit | Product -> Sub Recipe -> Recipe nutrition chain |
| Per portion calc | Unit | Total nutrition / yield = per portion |
| RDA percentage | Unit | Per portion / RDA = correct % |
| Macro split | Unit | Protein/carb/fat energy split sums to 100% |
| Allergen inheritance | Unit | Contains/may_contain propagation through chain |
| Allergen override | Integration | Manual override logic |

### 3.6 Acceptance Criteria

- [ ] Product nutrition per 100g is editable on the product form
- [ ] Sub recipe nutrition auto-calculates from product ingredients
- [ ] Recipe nutrition auto-calculates from all ingredients
- [ ] Nutrition displays per recipe total, per portion, and as % RDA
- [ ] Macro energy split (protein/carb/fat) displays as donut chart
- [ ] Allergens inherit through the product -> sub recipe -> recipe chain
- [ ] Allergen matrix shows all recipes vs all allergens in a grid
- [ ] Manual allergen overrides work but cannot downgrade inherited status
- [ ] Nutrition panel within recipe detail shows all 9 values

### 3.7 Lovable Prompts

---

#### Prompt 3.1: Nutrition Display Panel

```
Add a Nutrition tab/panel to the Recipe Detail page (from Prompt 2.4).

INTEGRATION: Add a Tab component (shadcn Tabs) to the recipe detail page with tabs:
- "Ingredients" (default, existing content)
- "Nutrition"
- "Allergens"

NUTRITION TAB CONTENT:

SECTION 1: "Nutrition Summary" (Card)
Two-column layout (stacked on mobile):

LEFT: Nutrition facts table (styled like a food label):
- Black header bar "Nutrition Facts"
- "Per Portion ({portion_weight_g}g)" subtitle
- Thick divider
- Table rows (alternating bg-zinc-50):
  | Nutrient        | Amount   | % RDA |
  |-----------------|----------|-------|
  | Energy          | XXX kcal | XX%   |
  | Energy          | XXXX kJ  | XX%   |
  | Fat             | XX.X g   | XX%   |
  |   Saturated Fat | XX.X g   | XX%   |
  | Carbohydrate    | XX.X g   | XX%   |
  |   Sugars        | XX.X g   | XX%   |
  | Fibre           | XX.X g   | XX%   |
  | Protein         | XX.X g   | XX%   |
  | Sodium          | XXX mg   | XX%   |
- Indented rows (Saturated Fat, Sugars) have ml-4 and text-sm
- % RDA column: progress bar (tiny, inline, 4px height) with percentage
- Red highlight if % RDA > 100%
- Footer: "% Reference Intake of an average adult (8400 kJ / 2000 kcal)"

RIGHT: Macro Energy Split (Donut Chart):
- SVG donut chart (or use recharts PieChart)
- Three segments: Protein (blue), Carbohydrate (amber), Fat (red)
- Center text: total kcal per portion
- Legend below with percentages:
  - Protein: XX% (XX.X g x 4 = XXX kcal)
  - Carbohydrate: XX% (XX.X g x 4 = XXX kcal)
  - Fat: XX% (XX.X g x 9 = XXX kcal)

SECTION 2: "Nutrition by Ingredient" (Card, collapsible)
Table showing each ingredient's nutrition contribution:
Columns:
1. Ingredient name
2. Quantity + unit
3. Weight (g)
4. Energy (kcal)
5. Protein (g)
6. Carbs (g)
7. Fat (g)
8. Sodium (mg)
- Totals row at bottom (font-bold, border-t-2)
- Highlight top 3 calorie contributors

SECTION 3: "Portion Calculator" (Card)
- Input: "Number of portions" (default: recipe yield)
- Display: nutrition values scaled by portion count
- Input: "Custom portion weight (g)" 
- Recalculates all values based on custom weight vs recipe portion weight

CALCULATION ENGINE (use from Prompt 2.5 costEngine.ts, extend):
```typescript
interface NutritionValues {
  energy_kcal: number;
  energy_kj: number;
  protein_g: number;
  carbohydrate_g: number;
  sugar_g: number;
  fat_g: number;
  saturated_fat_g: number;
  fibre_g: number;
  sodium_mg: number;
}

function calculateRecipeNutrition(
  ingredients: RecipeIngredient[],
  units: Unit[]
): NutritionValues {
  return ingredients
    .filter(i => !i.is_section_header)
    .reduce((total, ing) => {
      const ingNutrition = calculateIngredientNutrition(
        ing.quantity, ing.unit_id, ing.ingredientData, units
      );
      return addNutrition(total, ingNutrition);
    }, zeroNutrition());
}

function nutritionPerPortion(total: NutritionValues, portions: number): NutritionValues {
  return scaleNutrition(total, 1 / portions);
}

function nutritionRDA(perPortion: NutritionValues, rdaValues: RDAValues): Record<string, number> {
  // Returns percentage of RDA for each nutrient
}

function macroEnergySplit(perPortion: NutritionValues): { protein: number; carbs: number; fat: number } {
  const proteinKcal = perPortion.protein_g * 4;
  const carbKcal = perPortion.carbohydrate_g * 4;
  const fatKcal = perPortion.fat_g * 9;
  const total = proteinKcal + carbKcal + fatKcal;
  return {
    protein: total > 0 ? (proteinKcal / total) * 100 : 0,
    carbs: total > 0 ? (carbKcal / total) * 100 : 0,
    fat: total > 0 ? (fatKcal / total) * 100 : 0,
  };
}
```

STYLING:
- Nutrition facts table styled to resemble a standard nutrition label
- Use border-black for the thick dividers in the label
- Compact on mobile, side-by-side on desktop
```

**Expected Output:** Nutrition display panel within recipe detail, with food-label-style table, RDA percentages, macro donut chart, per-ingredient breakdown, and portion calculator.

---

#### Prompt 3.2: Allergen Management and Inheritance

```
Add allergen management to the Recipe Detail page (Allergens tab) and build the Allergen Matrix page.

ALLERGENS TAB (in Recipe Detail, third tab):

SECTION 1: "Inherited Allergens" (Card)
- Header: "These allergens are automatically detected from ingredients"
- Grid of allergen cards (3 columns desktop, 2 tablet, 1 mobile):
  Each card:
  - Allergen icon + name
  - Status badge: "Contains" (red bg), "May Contain" (amber bg), "Free From" (green bg), "Not Present" (zinc bg)
  - Source list: which ingredients contribute this allergen
    - e.g., "From: Butter (Dairy), Cream (Dairy)" in text-xs text-zinc-500
  - Cards with "Contains" status: red left border
  - Cards with "May Contain": amber left border

SECTION 2: "Manual Overrides" (Card)
- Toggle: "Enable manual allergen overrides" (Switch)
- When enabled: show override form
  - Same grid, but each allergen has a ToggleGroup: Contains | May Contain | Free From | Auto
  - "Auto" means use inherited value
  - Warning text when trying to downgrade: "Cannot set to 'Free From' while ingredient X contains this allergen"

SECTION 3: "Allergen Statement" (Card)
- Auto-generated text:
  "This dish contains: Gluten, Dairy, Eggs. May contain: Tree Nuts."
- Copy button (clipboard icon)
- Editable override textarea for custom allergen statements

ALLERGEN MATRIX PAGE at `/allergens`:

HEADER:
- Title "Allergen Matrix"
- Subtitle "Cross-reference of all recipes and allergens"
- Filter: Recipe category (Select), Status (Select: Active only default)
- Export button: "Export PDF" and "Export Excel"

MATRIX TABLE:
- Rows: Recipes (sorted by category, then name)
- Columns: All 14 major allergens (header shows icon + abbreviated name, rotated 45deg for space)
- Cell values:
  - "C" in red circle = Contains
  - "M" in amber circle = May Contain
  - Empty = Not present
  - "F" in green circle = Free From (explicitly marked)
- Row grouping: recipes grouped by category with category header rows (collapsible)
- Sticky first column (recipe name) and sticky header row

SUPABASE for inherited allergens:
```typescript
// Calculate inherited allergens for a recipe:
async function calculateRecipeAllergens(recipeId: string) {
  // 1. Get all recipe ingredients with their allergens
  const { data: ingredients } = await supabase
    .from('recipe_ingredients')
    .select(`
      product_id,
      sub_recipe_id,
      ref_recipe_id,
      product:products(product_allergens(allergen_id, status)),
      sub_recipe:sub_recipes(sub_recipe_allergens(allergen_id, status)),
      ref_recipe:recipes(recipe_allergens(allergen_id, status))
    `)
    .eq('recipe_id', recipeId)
    .eq('is_section_header', false);
  
  // 2. Collect all allergen statuses
  // 3. Apply inheritance rules:
  //    - contains > may_contain > free_from
  //    - If ANY source says "contains", result is "contains"
  //    - If ANY source says "may_contain" (and none "contains"), result is "may_contain"
  
  // 4. UPSERT into recipe_allergens with source_type = 'inherited'
}
```

STYLING:
- Matrix cells: w-10 h-10 centered
- Hover on cell: tooltip showing recipe name + allergen name + status + source ingredients
- Print-friendly styles (@media print): hide sidebar, full-width matrix
- Zebra striping on rows for readability
```

**Expected Output:** Allergen tab on recipe detail with inheritance visualization, manual overrides, auto-generated allergen statements, and a full allergen matrix page with cross-reference grid.

---

### 3.8 Expected Output Summary

After Phase 3:

- Complete nutrition calculation from products through the recipe chain
- Nutrition facts display per recipe and per portion
- RDA comparison with progress indicators
- Macro energy split visualization
- Allergen inheritance from products through sub recipes to recipes
- Allergen matrix for all active recipes
- Auto-generated allergen statements

### 3.9 Dependencies

- Phase 2 complete (sub recipes, recipes, ingredients)
- Products have nutrition data populated
- Products have allergen assignments

---

## Phase 4: Pricing & Costing (Weeks 9-10)

### 4.1 Objectives

- Implement comprehensive price management (with and without VAT)
- Build the contribution margin engine
- Add target food cost analysis
- Create a configurable cost formula builder
- Make the security margin configurable per organization

### 4.2 Database Changes

```sql
-- Price history for products
CREATE TABLE product_price_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  old_price NUMERIC(12,4) NOT NULL,
  new_price NUMERIC(12,4) NOT NULL,
  change_percentage NUMERIC(8,2),
  changed_by UUID REFERENCES auth.users(id),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT
);

-- Cost formulas (configurable per organization)
CREATE TABLE cost_formulas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_default BOOLEAN NOT NULL DEFAULT false,
  
  -- Formula components as JSONB
  -- Example: [
  --   {"type": "ingredient_cost", "label": "Ingredient Cost"},
  --   {"type": "percentage", "label": "Security Margin", "value": 5, "base": "ingredient_cost"},
  --   {"type": "percentage", "label": "Labor Cost", "value": 15, "base": "ingredient_cost"},
  --   {"type": "fixed", "label": "Overhead per Portion", "value": 2.00}
  -- ]
  components JSONB NOT NULL DEFAULT '[]',
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, name)
);

-- Organization settings additions
ALTER TABLE organizations ADD COLUMN security_margin_pct NUMERIC(5,2) NOT NULL DEFAULT 5.00;
ALTER TABLE organizations ADD COLUMN default_vat_pct NUMERIC(5,2) NOT NULL DEFAULT 5.00;
ALTER TABLE organizations ADD COLUMN target_food_cost_pct NUMERIC(5,2) NOT NULL DEFAULT 30.00;
ALTER TABLE organizations ADD COLUMN default_cost_formula_id UUID REFERENCES cost_formulas(id);

-- Recipe price history
CREATE TABLE recipe_price_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  old_price NUMERIC(12,2),
  new_price NUMERIC(12,2),
  old_cost NUMERIC(12,4),
  new_cost NUMERIC(12,4),
  old_food_cost_pct NUMERIC(5,2),
  new_food_cost_pct NUMERIC(5,2),
  changed_by UUID REFERENCES auth.users(id),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT
);

CREATE INDEX idx_product_price_history ON product_price_history(product_id, changed_at DESC);
CREATE INDEX idx_recipe_price_history ON recipe_price_history(recipe_id, changed_at DESC);
```

### 4.3 UI Changes

| Screen | Route | Description |
|--------|-------|-------------|
| Pricing Dashboard | `/pricing` | Overview of all recipe pricing |
| Cost Formula Builder | `/settings/cost-formulas` | Configure cost formulas |
| Price Comparison | `/pricing/compare` | Side-by-side recipe cost comparison |

### 4.4 Business Logic

```typescript
// VAT calculations
function priceExclVAT(inclVAT: number, vatPct: number): number {
  return inclVAT / (1 + vatPct / 100);
}

function priceInclVAT(exclVAT: number, vatPct: number): number {
  return exclVAT * (1 + vatPct / 100);
}

// Cost formula engine
interface FormulaComponent {
  type: 'ingredient_cost' | 'percentage' | 'fixed';
  label: string;
  value?: number;
  base?: string; // references another component's type
}

function calculateFormula(
  ingredientCost: number,
  components: FormulaComponent[],
  portionCount: number
): { total: number; breakdown: { label: string; amount: number }[] } {
  const breakdown: { label: string; amount: number }[] = [];
  let runningTotal = 0;
  
  for (const comp of components) {
    let amount: number;
    switch (comp.type) {
      case 'ingredient_cost':
        amount = ingredientCost;
        break;
      case 'percentage':
        const base = comp.base === 'ingredient_cost' ? ingredientCost : runningTotal;
        amount = base * (comp.value! / 100);
        break;
      case 'fixed':
        amount = comp.value! * portionCount;
        break;
    }
    breakdown.push({ label: comp.label, amount });
    runningTotal += amount;
  }
  
  return { total: runningTotal, breakdown };
}

// Target food cost reverse calculation
function suggestedPrice(costPerPortion: number, targetFoodCostPct: number): number {
  return costPerPortion / (targetFoodCostPct / 100);
}
```

### 4.5 Testing

| Test | Type | Description |
|------|------|-------------|
| VAT calc | Unit | Both directions, various rates |
| Formula engine | Unit | All component types, compound formulas |
| Target price | Unit | Reverse calc from target FC% |
| Price history | Integration | History records created on change |
| Margin calc | Unit | Contribution margin at various price points |

### 4.6 Acceptance Criteria

- [ ] Recipe detail shows both excl. and incl. VAT prices
- [ ] Changing VAT% auto-recalculates the other price
- [ ] Organization can set default VAT%, security margin%, target food cost%
- [ ] Cost formula builder allows custom cost components
- [ ] Pricing dashboard shows all recipes sorted by food cost %
- [ ] Recipes over target food cost are highlighted red
- [ ] Price change creates a history record
- [ ] Product price change creates a history record
- [ ] Suggested prices appear at 25%, 30%, 35% food cost

### 4.7 Lovable Prompts

---

#### Prompt 4.1: Pricing Dashboard

```
Build a Pricing Dashboard page at route `/pricing`.

PAGE: `src/pages/PricingDashboardPage.tsx`

HEADER:
- Title "Pricing & Costing" (text-2xl font-bold)
- Subtitle "Analyze food costs, margins, and pricing across all recipes"
- Right: "Cost Formula" Button (outline, Settings icon) -> /settings/cost-formulas

SUMMARY CARDS (grid-cols-5 on desktop, 2-3 on smaller):
1. Total Recipes Priced: count where selling_price > 0 (blue icon)
2. Avg Food Cost %: weighted average (green/amber/red based on vs target)
3. Avg Contribution Margin: AED average (icon TrendingUp)
4. Recipes Over Target: count where food_cost_pct > org.target_food_cost_pct (red if > 0)
5. Target Food Cost %: org setting value, editable inline

CHART SECTION (Card):
- Bar chart (use recharts BarChart):
  - X axis: recipe names (truncated, rotated 45deg)
  - Y axis: percentage (0-100%)
  - Bars: food cost % per recipe
  - Reference line: target food cost % (dashed red line)
  - Bar color: green if under target, amber if within 5% of target, red if over
  - Tooltip on hover: recipe name, food cost %, cost per portion, selling price, margin
- Toggle: "Show All" / "Show Over Target Only"

RECIPE PRICING TABLE (Card):
- Table with sortable columns:
  1. Recipe Name (link to recipe detail)
  2. Category (Badge)
  3. Portions (yield_qty)
  4. Ingredient Cost (AED)
  5. Security Margin (AED, computed)
  6. Total Cost (AED)
  7. Cost/Portion (AED)
  8. Selling Price excl. VAT (AED, editable inline - Input)
  9. Selling Price incl. VAT (AED, computed)
  10. Food Cost % (colored badge: green < target, amber within 5%, red > target)
  11. Contribution Margin (AED)
  12. Suggested Price @30% (AED, text-xs text-zinc-400)

- Inline editing: clicking the selling price cell turns it into an Input. On blur/enter, save to Supabase, recalculate food cost % and margin, record price history.
- Sort by any column
- Filter: category, status, over/under target
- Totals row at bottom: average food cost %, total margin

QUICK ANALYSIS SECTION (Card):
- "What-if Calculator":
  - Select a recipe (Combobox)
  - Current cost per portion: displayed
  - Slider: target food cost % (20-50%, step 1)
  - Calculated selling price at that target
  - Show margin at that price
  - "Apply Price" Button -> updates recipe selling price

SUPABASE:
```typescript
supabase
  .from('recipes')
  .select(`
    id, name, yield_qty, total_cost, cost_per_portion,
    selling_price, selling_price_incl_vat, vat_percentage,
    food_cost_percentage, contribution_margin,
    category:recipe_categories(name, color)
  `)
  .eq('organization_id', orgId)
  .in('status', ['active', 'testing'])
  .order('food_cost_percentage', { ascending: false })
```

RESPONSIVE:
- Cards stack on mobile
- Table scrolls horizontally on mobile with sticky first column
- Chart responsive with recharts ResponsiveContainer
```

**Expected Output:** Comprehensive pricing dashboard with summary stats, food cost bar chart with target line, inline-editable pricing table, and what-if price calculator.

---

#### Prompt 4.2: Cost Formula Builder

```
Build the Cost Formula Builder settings page at `/settings/cost-formulas`.

PAGE: `src/pages/settings/CostFormulasPage.tsx`

Add to Settings navigation: "Cost Formulas" (Calculator icon).

LAYOUT:
- Left panel (w-72): list of saved formulas
- Right panel: formula editor

LEFT PANEL:
- "Formulas" heading
- "New Formula" Button (outline, Plus icon)
- List of formulas as cards:
  - Name (font-medium)
  - Description (text-sm text-zinc-500, truncate)
  - "Default" badge if is_default
  - Click to select and edit in right panel
  - Active formula: bg-brand-50 border-brand-200

RIGHT PANEL - FORMULA EDITOR:
- Name (Input)
- Description (Textarea, 2 rows)
- "Set as Default" Switch

FORMULA COMPONENTS (drag-and-drop sortable list):
- Each component is a Card:

  Type: "Ingredient Cost" (always first, cannot be deleted):
  - Label "Ingredient Cost" (read-only)
  - Shows: "Base cost of all ingredients"
  - Value: "Calculated from recipe ingredients"

  Type: "Percentage":
  - Label (Input, e.g., "Security Margin", "Labor Cost")
  - Percentage value (Input number, suffix "%")
  - Base (Select): "Of Ingredient Cost" or "Of Running Total"
  - Delete button (Trash2 icon)

  Type: "Fixed Amount":
  - Label (Input, e.g., "Overhead per Portion")
  - Amount (Input number, prefix "AED")
  - Per: "per portion" / "per recipe" (Select)
  - Delete button

- "Add Component" Button with dropdown: "Add Percentage" / "Add Fixed Amount"
- Drag handles for reordering

PREVIEW SECTION (Card, bg-zinc-50):
- Title "Formula Preview"
- Example calculation using a sample recipe (or user-selected recipe via Combobox):
  ```
  Ingredient Cost:             AED 45.00
  + Security Margin (5%):      AED  2.25
  + Labor Cost (15%):          AED  6.75
  + Overhead per Portion:      AED  2.00
  ──────────────────────────────────────
  Total Cost per Portion:      AED 56.00
  
  At 30% food cost target:
  Suggested Price:             AED 186.67
  Contribution Margin:         AED 130.67
  ```
- Updates in real-time as formula components change

SAVE:
- Save button persists formula to cost_formulas table
- Components stored as JSONB array
- If "Set as Default" is toggled, update organization.default_cost_formula_id
- Toast on save

DEFAULT FORMULA (seeded on org creation):
```json
{
  "name": "Standard",
  "description": "Ingredient cost plus 5% security margin",
  "is_default": true,
  "components": [
    {"type": "ingredient_cost", "label": "Ingredient Cost"},
    {"type": "percentage", "label": "Security Margin", "value": 5, "base": "ingredient_cost"}
  ]
}
```

RESPONSIVE:
- On mobile: left panel becomes a Select dropdown at top, formula editor below
```

**Expected Output:** Configurable cost formula builder with drag-and-drop components, live preview with sample calculations, and organization-level defaults.

---

### 4.8 Expected Output Summary

After Phase 4:

- Full VAT-aware pricing (excl/incl VAT)
- Configurable cost formulas beyond simple security margin
- Pricing dashboard with food cost analysis
- Inline price editing with history tracking
- What-if price calculator
- Target food cost guidance with suggested pricing

### 4.9 Dependencies

- Phase 2 complete (recipes with costs)
- Phase 3 nice-to-have but not required

---

## Phase 5: Supplier & Purchasing (Weeks 11-12)

### 5.1 Objectives

- Build supplier management (CRUD, contact info, payment terms)
- Link suppliers to products with price tracking
- Implement price history and comparison
- Generate purchase orders from recipes/production needs

### 5.2 Database Changes

```sql
CREATE TABLE suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT,
  contact_name TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  payment_terms TEXT,                -- 'Net 30', 'COD', etc.
  delivery_days TEXT[],              -- ['monday', 'wednesday', 'friday']
  minimum_order NUMERIC(12,2),
  currency TEXT DEFAULT 'AED',
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, code)
);

-- Supplier-product relationship with pricing
CREATE TABLE supplier_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  supplier_sku TEXT,              -- supplier's product code
  supplier_name TEXT,             -- how supplier lists this product
  price NUMERIC(12,4) NOT NULL,
  unit_id UUID NOT NULL REFERENCES units(id),
  unit_qty NUMERIC(10,3) NOT NULL DEFAULT 1,
  is_preferred BOOLEAN NOT NULL DEFAULT false,
  lead_time_days INTEGER,
  minimum_qty NUMERIC(10,3),
  last_ordered_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(supplier_id, product_id)
);

-- Purchase orders
CREATE TABLE purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  supplier_id UUID NOT NULL REFERENCES suppliers(id),
  order_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','confirmed','delivered','cancelled')),
  order_date DATE NOT NULL DEFAULT CURRENT_DATE,
  expected_delivery DATE,
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  vat_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, order_number)
);

CREATE TABLE purchase_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  supplier_product_id UUID REFERENCES supplier_products(id),
  quantity NUMERIC(10,3) NOT NULL,
  unit_id UUID NOT NULL REFERENCES units(id),
  unit_price NUMERIC(12,4) NOT NULL,
  total_price NUMERIC(12,2) NOT NULL,
  received_qty NUMERIC(10,3),
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- Now add the FK from products to suppliers
ALTER TABLE products ADD CONSTRAINT fk_products_supplier 
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL;

CREATE INDEX idx_suppliers_org ON suppliers(organization_id);
CREATE INDEX idx_supplier_products_supplier ON supplier_products(supplier_id);
CREATE INDEX idx_supplier_products_product ON supplier_products(product_id);
CREATE INDEX idx_purchase_orders_org ON purchase_orders(organization_id);
CREATE INDEX idx_purchase_orders_supplier ON purchase_orders(supplier_id);
```

### 5.3 UI Changes

| Screen | Route | Description |
|--------|-------|-------------|
| Suppliers List | `/suppliers` | All suppliers with status |
| Supplier Detail | `/suppliers/:id` | Contact, products, orders |
| Purchase Orders | `/purchase-orders` | PO list with status |
| PO Detail | `/purchase-orders/:id` | PO line items |
| PO Create | `/purchase-orders/new` | Create from supplier |
| Price Comparison | `/suppliers/compare` | Compare supplier prices |

### 5.4 Business Logic

```typescript
// Auto-select cheapest supplier for a product
function cheapestSupplier(
  productId: string,
  supplierProducts: SupplierProduct[]
): SupplierProduct | null {
  const options = supplierProducts
    .filter(sp => sp.product_id === productId)
    .sort((a, b) => a.price / a.unit_qty - b.price / b.unit_qty);
  return options[0] || null;
}

// Generate PO from recipe needs
function generatePurchaseOrder(
  recipes: { recipe: Recipe; portions: number }[],
  suppliers: Supplier[],
  supplierProducts: SupplierProduct[],
  currentInventory: Map<string, number>
): PurchaseOrderDraft[] {
  // 1. Calculate total ingredient needs across all recipes * portions
  // 2. Subtract current inventory
  // 3. Group by preferred supplier (or cheapest)
  // 4. Round up to minimum order quantities
  // 5. Return one PO draft per supplier
}
```

### 5.5 Testing

| Test | Type | Description |
|------|------|-------------|
| Supplier CRUD | Integration | Create, edit, deactivate |
| Supplier-product link | Integration | Link with pricing |
| Price comparison | Unit | Compare across suppliers |
| PO generation | Unit | Generate from recipe needs |
| PO workflow | Integration | Draft -> Sent -> Confirmed -> Delivered |

### 5.6 Acceptance Criteria

- [ ] User can create and manage suppliers
- [ ] User can link products to suppliers with pricing
- [ ] Multiple suppliers can be linked to one product
- [ ] Price comparison view shows all suppliers for a product
- [ ] Preferred supplier is marked per product
- [ ] Purchase orders can be created manually or generated from needs
- [ ] PO workflow (draft -> sent -> confirmed -> delivered)
- [ ] PO total auto-calculates from line items
- [ ] Product price updates when supplier price changes (if preferred)

### 5.7 Lovable Prompts

---

#### Prompt 5.1: Supplier Management

```
Build Supplier management pages.

SUPPLIERS LIST at `/suppliers`:

HEADER:
- Title "Suppliers"
- Subtitle "Manage your ingredient suppliers and pricing"
- "Add Supplier" Button (brand-600, Plus icon)

STATS (3 cards):
1. Total Suppliers (active count)
2. Products with Multiple Suppliers (count of products linked to > 1 supplier)
3. Pending Orders (count of POs in draft/sent status)

TABLE (shadcn Table):
Columns:
1. Name (font-medium, click to navigate)
2. Code (font-mono text-sm)
3. Contact (contact_name, truncate)
4. Phone
5. Products (count of supplier_products)
6. Delivery Days (badges for each day, abbreviated: Mon, Wed, Fri)
7. Payment Terms (text-sm)
8. Status (green dot Active / red dot Inactive)
9. Actions (Edit, View Products, Create PO, Deactivate)

Search by name, code, contact. Filter by status.

SUPPLIER DETAIL at `/suppliers/:id`:

Two-column layout (70/30).

LEFT:

CARD 1: "Supplier Details" (editable form)
- Name* (Input)
- Code (Input)
- Contact Name (Input)
- Email (Input)
- Phone (Input)
- Address (Textarea, 2 rows)
- Payment Terms (Combobox: Net 7, Net 15, Net 30, Net 60, COD, Prepaid + custom)
- Delivery Days (multi-select checkboxes: Mon-Sun)
- Minimum Order Amount (Input number, prefix "AED")
- Notes (Textarea)
- Save / Cancel buttons

CARD 2: "Products Supplied" (table)
- Table columns:
  1. Product Name (link to product detail)
  2. Supplier SKU
  3. Price (AED, per unit)
  4. Unit
  5. Preferred (Star icon, yellow if preferred, click to toggle)
  6. Last Ordered (date)
  7. Actions (Edit Price, Remove)
- "Link Product" Button above table:
  - Opens Dialog with product Combobox search
  - Fields: supplier SKU, price, unit, minimum qty
  - Save links via supplier_products table

CARD 3: "Order History" (table)
- Recent purchase orders with this supplier
- Columns: Order #, Date, Items, Total, Status
- Link to PO detail

RIGHT:

CARD 4: "Quick Stats"
- Total products supplied
- Average lead time
- Last order date
- Total ordered (YTD)

CARD 5: "Price Alerts"
- Products where this supplier is NOT the cheapest option
- Each: product name, this supplier's price vs cheapest price, difference

SUPABASE:
```typescript
// Supplier with products and orders
supabase
  .from('suppliers')
  .select(`
    *,
    supplier_products(
      *,
      product:products(id, name, code, category:product_categories(name, color)),
      unit:units(abbreviation)
    ),
    purchase_orders(id, order_number, status, total, order_date)
  `)
  .eq('id', supplierId)
  .single()
```
```

**Expected Output:** Supplier list page with stats and table, supplier detail page with contact form, linked products table, order history, and price alert cards.

---

#### Prompt 5.2: Purchase Orders

```
Build Purchase Order management pages.

PO LIST at `/purchase-orders`:

HEADER:
- Title "Purchase Orders"
- "New Order" Button (brand-600, Plus icon) opens supplier selection dialog first

FILTER:
- Search (by order number)
- Supplier filter (Select)
- Status filter: All, Draft, Sent, Confirmed, Delivered, Cancelled
- Date range picker (two date inputs: from, to)

TABLE:
1. Order # (font-mono, link to detail)
2. Supplier (name)
3. Order Date
4. Expected Delivery
5. Items (count)
6. Subtotal (AED)
7. VAT (AED)
8. Total (AED, font-medium)
9. Status (Badge: draft=zinc, sent=blue, confirmed=amber, delivered=green, cancelled=red)
10. Actions (View, Edit if draft, Duplicate, Cancel if not delivered)

PO DETAIL at `/purchase-orders/:id` and `/purchase-orders/new`:

HEADER:
- Back button -> /purchase-orders
- Order number (auto-generated: PO-YYYY-NNNN)
- Status badge + status change buttons:
  - Draft: "Send to Supplier" (outline, blue) -> changes to 'sent'
  - Sent: "Mark Confirmed" (outline, amber)
  - Confirmed: "Mark Delivered" (outline, green)
  - Any non-delivered: "Cancel Order" (ghost, red)

TOP INFO (2-column grid):
- Supplier (Select on create, read-only after sent)
- Order Date (date picker)
- Expected Delivery (date picker)
- Notes (Input)

LINE ITEMS TABLE:
- "Add Item" Button (outline, Plus icon)
- Columns:
  1. Product (Combobox - searches products, shows category badge)
     When product selected, auto-fill unit price from supplier_products if exists
  2. Quantity (Input number)
  3. Unit (Select, from units)
  4. Unit Price (Input number, prefix "AED")
  5. Total (computed: qty * unit_price, read-only)
  6. Received Qty (Input number, only visible when status = confirmed/delivered)
  7. Delete (Trash2 icon, only if status = draft)
- Drag-and-drop reordering

TOTALS SECTION (right-aligned, below table):
```
Subtotal:  AED XXX.XX
VAT (5%):  AED  XX.XX
           ──────────
Total:     AED XXX.XX
```

RECEIVING (visible when status = 'confirmed' or 'delivered'):
- Each line item gets a "Received Qty" input
- Color coding: green if received = ordered, amber if partial, red if over
- "Mark All Received" Button (fills all received_qty = quantity)
- Receiving updates product price if the received unit price differs from current product price (with confirmation dialog)

PRINT VIEW:
- "Print" Button (Printer icon) -> generates a clean, printable PO
- Company name and address at top
- Supplier name and address
- Line items table
- Totals
- Notes
- @media print styles

CREATE FLOW:
1. User clicks "New Order"
2. Dialog: select supplier (Combobox)
3. Navigates to /purchase-orders/new?supplier=:id
4. Pre-populate "Suggested Items": products linked to this supplier that are low in stock (if inventory exists) or commonly ordered
5. User adds/removes items, adjusts quantities
6. Save as draft

SUPABASE:
- Insert: purchase_orders + purchase_order_items
- Auto-generate order_number: Edge Function or DB sequence
- Update status transitions with audit
```

**Expected Output:** Purchase order list with status filters, PO detail with line items, receiving workflow, auto-fill from supplier pricing, and print-friendly layout.

---

### 5.8 Expected Output Summary

After Phase 5:

- Complete supplier management
- Supplier-product price linking
- Price comparison across suppliers
- Purchase order creation and lifecycle
- PO receiving with variance tracking
- Auto-suggestion of order items

### 5.9 Dependencies

- Phase 1 complete (products)
- Phase 4 helpful for price history integration

---

## Phase 6: Menu Management (Weeks 13-14)

### 6.1 Objectives

- Build the menu builder with sections and items
- Calculate menu-level costing (aggregate of recipe costs)
- Generate menu engineering matrix (Stars, Puzzles, Plowhorses, Dogs)
- Generate menu allergen matrix
- Provide menu nutrition summary

### 6.2 Database Changes

```sql
CREATE TABLE menus (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  type TEXT CHECK (type IN ('a_la_carte','set_menu','buffet','tasting','brunch','special')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','archived')),
  valid_from DATE,
  valid_until DATE,
  image_url TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);

CREATE TABLE menu_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_id UUID NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
  name TEXT NOT NULL,           -- 'Starters', 'Mains', 'Desserts'
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE menu_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_section_id UUID NOT NULL REFERENCES menu_sections(id) ON DELETE CASCADE,
  recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE RESTRICT,
  display_name TEXT,            -- override recipe name for menu
  display_description TEXT,     -- menu-specific description
  selling_price NUMERIC(12,2), -- override recipe price for this menu
  is_available BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  
  -- Menu engineering data (computed or entered)
  popularity_rank INTEGER,     -- based on sales data or manual entry
  is_signature BOOLEAN DEFAULT false,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_menus_org ON menus(organization_id);
CREATE INDEX idx_menu_sections_menu ON menu_sections(menu_id);
CREATE INDEX idx_menu_items_section ON menu_items(menu_section_id);
CREATE INDEX idx_menu_items_recipe ON menu_items(recipe_id);
```

### 6.3 UI Changes

| Screen | Route | Description |
|--------|-------|-------------|
| Menus List | `/menus` | All menus with status |
| Menu Builder | `/menus/:id` | Drag-and-drop menu builder |
| Menu Create | `/menus/new` | Create new menu |
| Menu Engineering | `/menus/:id/engineering` | BCG-style matrix |
| Menu Allergen Matrix | `/menus/:id/allergens` | Allergens for menu items |
| Menu Nutrition | `/menus/:id/nutrition` | Aggregate nutrition data |

### 6.4 Business Logic

#### Menu Engineering Matrix

```typescript
// BCG-style matrix classification
// X axis: Contribution Margin (high/low split at average)
// Y axis: Popularity (high/low split at average)
//
// High Margin + High Popularity = STAR (keep, promote)
// Low Margin + High Popularity = PLOWHORSE (re-engineer, increase price)
// High Margin + Low Popularity = PUZZLE (promote, reposition)
// Low Margin + Low Popularity = DOG (remove or rework)

function classifyMenuItems(items: MenuItemWithRecipe[]): ClassifiedItem[] {
  const avgMargin = average(items.map(i => i.recipe.contribution_margin));
  const avgPopularity = average(items.map(i => i.popularity_rank || 0));
  
  return items.map(item => ({
    ...item,
    classification: 
      item.recipe.contribution_margin >= avgMargin && item.popularity >= avgPopularity ? 'star' :
      item.recipe.contribution_margin < avgMargin && item.popularity >= avgPopularity ? 'plowhorse' :
      item.recipe.contribution_margin >= avgMargin && item.popularity < avgPopularity ? 'puzzle' :
      'dog'
  }));
}
```

### 6.5 Testing

| Test | Type | Description |
|------|------|-------------|
| Menu CRUD | Integration | Create menu with sections and items |
| Menu costing | Unit | Aggregate costs across menu items |
| Engineering matrix | Unit | Correct classification at boundary |
| Allergen matrix | Integration | All items' allergens displayed |

### 6.6 Acceptance Criteria

- [ ] User can create a menu with sections (Starters, Mains, Desserts, etc.)
- [ ] User can add recipes to menu sections
- [ ] Menu items can override recipe name and price
- [ ] Drag-and-drop reordering of sections and items
- [ ] Menu cost summary shows avg food cost %, total margin
- [ ] Menu engineering matrix classifies items as Star/Puzzle/Plowhorse/Dog
- [ ] Menu allergen matrix shows all items vs all allergens
- [ ] Menu nutrition summary shows range of nutritional values

### 6.7 Lovable Prompts

---

#### Prompt 6.1: Menu Builder

```
Build the Menu Builder page at `/menus/:id` and `/menus/new`.

PAGE: `src/pages/MenuBuilderPage.tsx`

HEADER:
- Back button -> /menus
- Title: menu name (editable inline)
- Status badge + status toggle
- Right: "Preview" Button (Eye icon) + "Save" Button (brand-600)

TOP BAR (Card, p-4):
- Menu Name* (Input)
- Type (Select: A La Carte, Set Menu, Buffet, Tasting, Brunch, Special)
- Valid From (DatePicker)
- Valid Until (DatePicker)
- Description (Input, single line)

MENU BUILDER (main area, mt-4):

Layout: drag-and-drop sections and items using @dnd-kit

SECTION COMPONENT:
- Card with:
  - Drag handle (GripVertical)
  - Section name (Input, inline editable, font-semibold text-lg)
  - Description (Input, text-sm text-zinc-500, optional)
  - "Add Item" Button (Plus icon, text-sm)
  - Collapse/Expand toggle (ChevronDown/Up)
  - Delete section Button (Trash2, requires confirmation if has items)

Within each section, ITEM ROWS (sortable, draggable between sections):
- Drag handle
- Recipe (Combobox searching recipes table, shows recipe name + category badge)
  When selected, auto-fills: display name, price, food cost %, margin
- Display Name (Input, defaults to recipe name, editable for menu)
- Display Description (Input, optional, text-sm)
- Price (Input number, prefix "AED", defaults to recipe.selling_price)
- Food Cost % (read-only, computed from recipe cost vs this menu price, colored)
- Margin (read-only, computed)
- Available toggle (Switch, on by default)
- Signature mark (Star icon, click to toggle, yellow when active)
- Delete (Trash2)

"Add Section" Button below all sections (full width, dashed border, outline variant)

RIGHT SIDEBAR (w-80, sticky top-20, hidden on mobile - accessible via tab):

CARD: "Menu Summary"
- Items: total count
- Avg Food Cost %: weighted average across items (colored)
- Avg Margin: AED average
- Price Range: AED min - AED max
- Sections: count

CARD: "Section Breakdown"
- For each section: name + item count + avg price

CARD: "Quick Allergen Check" (compact)
- List of allergens present in any menu item
- Each: allergen name + count of items containing it
- Click opens full allergen matrix

PREVIEW MODE (opens as Dialog or full-screen overlay):
- Clean, styled menu layout:
  - Menu title in elegant serif font
  - Each section as a heading
  - Items below with name, description, price
  - Allergen indicators as small icons next to items
  - Signature items marked with a small star
  - Print-friendly layout

SAVE:
- UPSERT menu record
- DELETE + INSERT menu_sections with sort_order
- DELETE + INSERT menu_items with sort_order
- TanStack Query invalidation
- Toast

SUPABASE:
```typescript
supabase
  .from('menus')
  .select(`
    *,
    sections:menu_sections(
      *,
      items:menu_items(
        *,
        recipe:recipes(
          id, name, total_cost, cost_per_portion,
          selling_price, food_cost_percentage, contribution_margin,
          category:recipe_categories(name, color),
          recipe_allergens(allergen:allergens(id, name, icon), status)
        )
      )
    )
  `)
  .eq('id', menuId)
  .single()
```

RESPONSIVE:
- On mobile: full-width, sidebar content moves to bottom
- Sections stack vertically
- Items show key info only (name, price, FC%, available toggle)
```

**Expected Output:** Interactive menu builder with drag-and-drop sections and items, recipe linking, price override, food cost coloring, summary sidebar, and printable preview mode.

---

#### Prompt 6.2: Menu Engineering Matrix

```
Build the Menu Engineering Matrix view at `/menus/:id/engineering`.

PAGE: `src/pages/MenuEngineeringPage.tsx`

HEADER:
- Back to menu builder link
- Title: "Menu Engineering: {menu_name}"
- Subtitle: "BCG-style analysis of profitability and popularity"

EXPLANATION CARD (collapsible, default collapsed):
- 2x2 grid explaining the four quadrants:
  - STAR (green): High Margin + High Popularity - "Keep and promote"
  - PUZZLE (blue): High Margin + Low Popularity - "Promote or reposition"
  - PLOWHORSE (amber): Low Margin + High Popularity - "Increase price or reduce cost"
  - DOG (red): Low Margin + Low Popularity - "Remove or rework"

SCATTER PLOT (primary visualization, Card):
- Use recharts ScatterChart
- X axis: Contribution Margin (AED) - label at bottom
- Y axis: Popularity Score - label on left
- Reference lines: dashed lines at average margin (vertical) and average popularity (horizontal), creating 4 quadrants
- Quadrant backgrounds: subtle color fills (very low opacity)
- Data points: circles sized by selling price
  - Green = Star
  - Blue = Puzzle
  - Amber = Plowhorse
  - Red = Dog
- Tooltip on hover: recipe name, price, cost, margin, FC%, popularity
- Click on point: opens recipe detail in new tab
- Labels on points: recipe name (togglable with checkbox)

POPULARITY INPUT (since we may not have sales data):
- Each menu item gets a popularity score input (1-10, or based on sales data if available)
- Table below the chart for entering/adjusting popularity:
  Columns: Item Name | Section | Price | Cost | Margin | FC% | Popularity (editable Input 1-10) | Classification (Badge)
- "Randomize" button for testing (assigns random 1-10 values)
- "Use Sales Data" button [disabled, future feature]

RECOMMENDATIONS PANEL (Card):
- Auto-generated recommendations based on classifications:
  - Stars: "Consider featuring {name} more prominently"
  - Puzzles: "Try promoting {name} with specials or waiter suggestions"
  - Plowhorses: "Consider increasing price of {name} by AED X to improve margin"
  - Dogs: "Review whether {name} should remain on the menu"
- Each recommendation: icon + colored badge + text
- "Export Analysis" Button (outline)

SUMMARY STATS (row of 4 small cards):
1. Stars: count (green)
2. Puzzles: count (blue)
3. Plowhorses: count (amber)
4. Dogs: count (red)

RESPONSIVE:
- Chart fills available width, min height 400px
- On mobile: chart scrolls horizontally, recommendations stack
```

**Expected Output:** Menu engineering analysis page with interactive scatter plot, quadrant classification, popularity input, and auto-generated optimization recommendations.

---

### 6.8 Expected Output Summary

After Phase 6:

- Full menu builder with sections and items
- Drag-and-drop menu organization
- Menu-level cost analysis
- Menu engineering matrix (BCG)
- Menu allergen matrix (reusing Phase 3 allergen component)
- Menu preview and print
- Menu optimization recommendations

### 6.9 Dependencies

- Phase 2 complete (recipes with costs)
- Phase 3 for allergen matrix
- Phase 4 for pricing data

---

## Phase 7: Inventory & Production (Weeks 15-17)

### 7.1 Objectives

- Build inventory management with stock levels
- Mobile-optimized stock counting interface
- Barcode scanning for product lookup
- Production planning from recipes
- Prep list generation for kitchen team
- Waste tracking and reporting

### 7.2 Database Changes

```sql
CREATE TABLE inventory_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                -- 'Walk-in Cooler', 'Dry Store', 'Bar'
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, name)
);

CREATE TABLE inventory_counts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                -- 'Weekly Count - Jul 25'
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed','reviewed')),
  count_date DATE NOT NULL DEFAULT CURRENT_DATE,
  location_id UUID REFERENCES inventory_locations(id),
  counted_by UUID REFERENCES auth.users(id),
  reviewed_by UUID REFERENCES auth.users(id),
  completed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE inventory_count_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_count_id UUID NOT NULL REFERENCES inventory_counts(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  expected_qty NUMERIC(10,3),       -- from last count + purchases - usage
  counted_qty NUMERIC(10,3),
  unit_id UUID NOT NULL REFERENCES units(id),
  variance NUMERIC(10,3),           -- counted - expected
  variance_value NUMERIC(12,2),     -- variance * cost_per_unit
  notes TEXT,
  counted_at TIMESTAMPTZ
);

-- Current stock levels (materialized from latest counts)
CREATE TABLE stock_levels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  location_id UUID REFERENCES inventory_locations(id),
  quantity NUMERIC(10,3) NOT NULL DEFAULT 0,
  unit_id UUID NOT NULL REFERENCES units(id),
  last_counted_at TIMESTAMPTZ,
  reorder_point NUMERIC(10,3),      -- alert when stock below this
  par_level NUMERIC(10,3),          -- target stock level
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(product_id, location_id)
);

-- Production plans
CREATE TABLE production_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  production_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed','in_progress','completed')),
  created_by UUID REFERENCES auth.users(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE production_plan_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  production_plan_id UUID NOT NULL REFERENCES production_plans(id) ON DELETE CASCADE,
  recipe_id UUID REFERENCES recipes(id),
  sub_recipe_id UUID REFERENCES sub_recipes(id),
  CONSTRAINT one_recipe_ref CHECK (
    (recipe_id IS NOT NULL)::int + (sub_recipe_id IS NOT NULL)::int = 1
  ),
  target_qty NUMERIC(10,3) NOT NULL,
  actual_qty NUMERIC(10,3),
  unit_id UUID NOT NULL REFERENCES units(id),
  sort_order INTEGER NOT NULL DEFAULT 0,
  notes TEXT
);

-- Waste log
CREATE TABLE waste_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id),
  recipe_id UUID REFERENCES recipes(id),
  sub_recipe_id UUID REFERENCES sub_recipes(id),
  quantity NUMERIC(10,3) NOT NULL,
  unit_id UUID NOT NULL REFERENCES units(id),
  cost NUMERIC(12,2) NOT NULL,
  reason TEXT CHECK (reason IN ('expired','spoiled','overproduction','prep_waste','damaged','other')),
  notes TEXT,
  logged_by UUID REFERENCES auth.users(id),
  logged_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Barcodes
ALTER TABLE products ADD COLUMN barcode TEXT;
CREATE INDEX idx_products_barcode ON products(barcode);
```

### 7.3 UI Changes

| Screen | Route | Description |
|--------|-------|-------------|
| Inventory Dashboard | `/inventory` | Stock levels, alerts |
| Stock Count | `/inventory/count/:id` | Mobile counting interface |
| New Stock Count | `/inventory/count/new` | Start a new count |
| Production Plans | `/production` | Production planning |
| Production Detail | `/production/:id` | Plan detail with prep list |
| Waste Log | `/inventory/waste` | Record and view waste |
| Barcode Scanner | (component) | Reusable scanner component |

### 7.4 Business Logic

```typescript
// Expected stock = last count + purchases received - recipe usage
function calculateExpectedStock(
  productId: string,
  lastCountQty: number,
  purchasesReceived: number,    // from POs marked delivered
  recipeUsage: number            // from production plans completed
): number {
  return lastCountQty + purchasesReceived - recipeUsage;
}

// Prep list generation
function generatePrepList(
  productionItems: ProductionPlanItem[],
  recipes: Recipe[],
  subRecipes: SubRecipe[]
): PrepListItem[] {
  // 1. For each production item, get the recipe/sub recipe
  // 2. Scale ingredients by target_qty / recipe.yield_qty
  // 3. Group by ingredient across all items
  // 4. Sum quantities
  // 5. Return sorted by category, then name
}

// Stock alerts
function stockAlerts(stockLevels: StockLevel[]): Alert[] {
  return stockLevels
    .filter(s => s.reorder_point && s.quantity <= s.reorder_point)
    .map(s => ({
      product_id: s.product_id,
      current: s.quantity,
      reorder_point: s.reorder_point,
      deficit: s.reorder_point - s.quantity,
    }));
}
```

### 7.5 Testing

| Test | Type | Description |
|------|------|-------------|
| Stock count | Integration | Full count workflow |
| Expected stock | Unit | Calculation with purchases and usage |
| Barcode scan | Integration | Scan -> product lookup |
| Prep list | Unit | Aggregate ingredients across recipes |
| Waste tracking | Integration | Log waste, verify cost |

### 7.6 Acceptance Criteria

- [ ] User can create a stock count and record quantities per product
- [ ] Stock counting works well on mobile (large touch targets, barcode scan)
- [ ] Barcode scanning identifies products
- [ ] Variance (counted vs expected) auto-calculates with cost impact
- [ ] Stock levels update when a count is completed
- [ ] Low stock alerts appear when below reorder point
- [ ] Production plan generates an aggregated prep list
- [ ] Prep list shows total ingredients needed across all planned items
- [ ] Waste can be logged with reason and cost is auto-calculated
- [ ] Inventory dashboard shows stock value and alerts

### 7.7 Lovable Prompts

---

#### Prompt 7.1: Mobile Stock Counting Interface

```
Build a mobile-optimized stock counting interface at `/inventory/count/:id`.

PAGE: `src/pages/StockCountPage.tsx`

This page is designed MOBILE-FIRST. It should work excellently on iPhone/iPad.

HEADER (sticky top, bg-white border-b z-10):
- Back arrow
- Count name (truncate)
- Progress: "12 / 45 counted" + progress bar (thin, brand-600)
- "Complete Count" Button (brand-600, only when all items have values)

SCANNER BAR (sticky, below header):
- Large search/scan input area:
  - Camera icon button (left) -> opens barcode scanner
  - Search input (placeholder "Scan barcode or search product...", text-lg, h-14 for fat finger targets)
  - When barcode scanned or product searched, scroll to that item and highlight it

BARCODE SCANNER COMPONENT `src/components/BarcodeScanner.tsx`:
- Uses html5-qrcode library or @AzureAD/webqrcodescanner
- Opens camera in a modal overlay
- Scans EAN-13, EAN-8, UPC-A, Code128 barcodes
- On scan: look up product by barcode field
- If found: close scanner, scroll to item, focus quantity input
- If not found: show "Product not found" with option to assign barcode to a product
- Haptic feedback on scan (navigator.vibrate if available)

PRODUCT LIST (scrollable, below scanner bar):
- Products grouped by category (Accordion sections, all expanded by default)
- Each category: sticky section header with category name + color bar + count "3/8"

PRODUCT ROW (touch-optimized):
- Layout: flex, items-center, min-h-16 (large touch target), border-b
- Left: 
  - Product name (font-medium)
  - Unit below (text-sm text-zinc-500, e.g., "kg")
  - Expected qty (text-xs text-zinc-400, e.g., "Expected: 5.5 kg")
- Right:
  - Quantity input (Input number, w-24 h-12, text-center text-lg font-medium)
  - Stepper buttons below: [-] [+] (small square buttons, 32x32)
  - Step size depends on unit: kg=0.5, g=100, pc=1, L=0.5
- States:
  - Not counted: bg-white
  - Counted, matches expected (+/- 5%): bg-green-50 left border-green-500
  - Counted, variance > 5%: bg-amber-50 left border-amber-500
  - Counted, variance > 20%: bg-red-50 left border-red-500

VARIANCE DISPLAY (shown after quantity entered):
- Below quantity: "Variance: +2.5 kg (AED 125.00)" or "-1.0 kg (AED -50.00)"
- Color: green for positive (surplus), red for negative (shortage)

BOTTOM BAR (sticky bottom, bg-white border-t, p-4):
- Count progress summary: "Counted: 12/45 | Variance: AED -450.00"
- "Save Progress" Button (outline) - saves in-progress counts
- "Complete Count" Button (brand-600, disabled until all counted)

ON COMPLETE:
- Confirmation dialog: "Complete this count? This will update stock levels."
- Show variance summary: total positive, total negative, net variance in AED
- On confirm: update stock_levels table, mark count as completed

OFFLINE SUPPORT:
- Count data stored in localStorage/IndexedDB as user enters values
- Sync to Supabase when online
- Show offline indicator badge if no connection
- Queue saves for when connection returns

SUPABASE:
```typescript
// Fetch count with items
supabase
  .from('inventory_counts')
  .select(`
    *,
    location:inventory_locations(name),
    items:inventory_count_items(
      *,
      product:products(id, name, code, barcode, category:product_categories(name, color)),
      unit:units(abbreviation)
    )
  `)
  .eq('id', countId)
  .single()
```

RESPONSIVE:
- This is primarily a mobile interface but should work on desktop too
- On desktop: narrower layout (max-w-lg centered) to maintain the mobile feel
- On iPad: 2-column grid for products (side by side)
```

**Expected Output:** Mobile-first stock counting interface with barcode scanning, category-grouped product list, large touch targets, real-time variance display, offline support, and progress tracking.

---

#### Prompt 7.2: Production Planning and Prep Lists

```
Build the Production Planning page at `/production` and Production Detail at `/production/:id`.

PRODUCTION LIST `/production`:

HEADER:
- Title "Production Planning"
- "New Plan" Button (brand-600, Plus icon)
- Date picker to filter by production date

TABLE:
1. Plan Name
2. Date (formatted)
3. Items (count)
4. Status (Badge: draft=zinc, confirmed=blue, in_progress=amber, completed=green)
5. Created By (profile name)
6. Actions (View, Duplicate for next day, Delete if draft)

PRODUCTION DETAIL `/production/:id`:

HEADER:
- Back -> /production
- Title: plan name
- Date (DatePicker, editable if draft)
- Status badge + workflow buttons

TWO SECTIONS (Tabs: "Production Items" | "Prep List"):

TAB 1: "Production Items"
- Table of items to produce:
  Columns:
  1. Recipe/Sub Recipe (Combobox, searches both)
  2. Type badge (Recipe/Sub Recipe)
  3. Target Qty (Input number)
  4. Unit (Select)
  5. Actual Qty (Input number, only when in_progress/completed)
  6. Status (computed: actual/target as %)
  7. Delete
- "Add Item" Button
- Totals: Total planned items

TAB 2: "Prep List" (auto-generated)
This is the key deliverable for kitchen staff.

PREP LIST GENERATION:
1. For each production item, get the recipe/sub recipe
2. Calculate scaling factor: target_qty / recipe.yield_qty
3. Multiply each ingredient quantity by the scaling factor
4. Group identical ingredients across all production items
5. Sum quantities per ingredient
6. Sort by category, then name

PREP LIST DISPLAY:
- Grouped by product category (collapsible sections)
- Each section header: category name + item count

Table per section:
1. Checkbox (for marking as prepped)
2. Product name + code
3. Total Quantity Needed (summed across all recipes, formatted with unit)
4. Current Stock (from stock_levels, text-zinc-500)
5. To Purchase (max(0, needed - stock), highlighted red if > 0)
6. Recipes Using This (list of recipe names + quantities, expandable)

SUMMARY CARD at bottom:
- Total ingredients: count
- Ingredients in stock: count (green)
- Ingredients to purchase: count (red)
- Estimated total cost: sum of (quantity * product.cost_per_recipe_unit)
- "Generate Purchase Order" Button (outline, ShoppingCart icon)
  -> Creates a PO with the "to purchase" items, grouped by preferred supplier

PRINT PREP LIST:
- "Print Prep List" Button (Printer icon)
- Clean layout: date, items grouped by category, checkboxes for each
- Large font for quantities
- @media print styles

RESPONSIVE:
- Prep list on mobile: card layout per ingredient
- Checkbox large touch targets
- Print button sticky bottom on mobile
```

**Expected Output:** Production planning with recipe/sub recipe items, auto-generated aggregated prep list, stock comparison, purchase order generation, and printable prep list for kitchen use.

---

### 7.8 Expected Output Summary

After Phase 7:

- Mobile stock counting with barcode scanning
- Inventory tracking with variance analysis
- Production planning with prep list generation
- Aggregated ingredient needs across multiple recipes
- Stock alerts and reorder triggers
- Waste tracking
- Offline counting support

### 7.9 Dependencies

- Phase 1 (products)
- Phase 2 (recipes, sub recipes)
- Phase 5 (purchase orders for auto-generation)

---

## Phase 8: AI Integration (Weeks 18-20)

### 8.1 Objectives

- Build an AI provider abstraction layer supporting multiple LLMs
- Implement recipe import from PDF, Word documents, and photos
- Build an AI assistant chat interface for cost explanations and recipe help
- Add ingredient substitution suggestions
- Build AI-powered recipe analysis

### 8.2 Database Changes

```sql
-- AI provider configuration
CREATE TABLE ai_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('openai','anthropic','google','apple')),
  api_key_encrypted TEXT,         -- encrypted, or null for Apple Foundation Models
  model TEXT NOT NULL,            -- 'gpt-4o', 'claude-sonnet-4-20250514', 'gemini-2.0-flash'
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_default BOOLEAN NOT NULL DEFAULT false,
  max_tokens INTEGER DEFAULT 4096,
  temperature NUMERIC(3,2) DEFAULT 0.7,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, provider)
);

-- AI conversations
CREATE TABLE ai_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  title TEXT,
  context_type TEXT,              -- 'recipe', 'product', 'cost_analysis', 'general'
  context_id UUID,                -- reference to recipe/product if contextual
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ai_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  content TEXT NOT NULL,
  metadata JSONB,                 -- tokens used, model, etc.
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Recipe import jobs
CREATE TABLE import_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','review','completed','failed')),
  source_type TEXT NOT NULL CHECK (source_type IN ('pdf','docx','image','url','text')),
  source_url TEXT,                -- Supabase Storage URL
  extracted_data JSONB,           -- AI-extracted recipe data
  recipe_id UUID REFERENCES recipes(id), -- created recipe after approval
  error_message TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
```

### 8.3 UI Changes

| Screen | Route | Description |
|--------|-------|-------------|
| AI Chat | `/ai` | Standalone chat interface |
| Recipe Import | `/recipes/import` | Upload and extract recipes |
| AI Settings | `/settings/ai` | Configure AI providers |
| Recipe AI Panel | (within recipe detail) | Contextual AI assistant |

### 8.4 Business Logic

#### AI Abstraction Layer

```typescript
// Provider-agnostic interface
interface AIProvider {
  name: string;
  chat(messages: Message[], options?: ChatOptions): AsyncGenerator<string>;
  extractRecipe(content: string | ArrayBuffer, type: 'text' | 'image'): Promise<ExtractedRecipe>;
  suggestSubstitutions(ingredient: Product, constraints: string[]): Promise<Substitution[]>;
  explainCost(recipe: Recipe): Promise<string>;
}

// Factory
function createAIProvider(config: AIProviderConfig): AIProvider {
  switch (config.provider) {
    case 'openai': return new OpenAIProvider(config);
    case 'anthropic': return new AnthropicProvider(config);
    case 'google': return new GeminiProvider(config);
    case 'apple': return new AppleFoundationProvider(config);
  }
}

// Edge Function handles AI calls (keeps API keys server-side)
// Client sends: { action: 'chat' | 'extract' | 'suggest', payload: ... }
// Edge Function: selects provider, makes API call, streams response
```

#### Recipe Extraction Prompt

```typescript
const RECIPE_EXTRACTION_PROMPT = `
Extract a structured recipe from the following content.
Return JSON matching this schema:
{
  "name": string,
  "description": string,
  "category": string,
  "yield_qty": number,
  "yield_unit": string,
  "prep_time_minutes": number,
  "cook_time_minutes": number,
  "ingredients": [
    {
      "name": string,
      "quantity": number,
      "unit": string,
      "notes": string (optional, e.g., "finely diced")
    }
  ],
  "method": string[] (array of steps),
  "notes": string (optional)
}
Match ingredient names to these existing products where possible: ${productNames}
If an ingredient doesn't match, flag it with "is_new": true.
`;
```

### 8.5 Testing

| Test | Type | Description |
|------|------|-------------|
| Provider abstraction | Unit | All providers implement interface |
| Recipe extraction | Integration | Extract from sample PDF |
| Chat streaming | Integration | Stream response chunks |
| Substitutions | Integration | Generate relevant substitutions |
| Error handling | Unit | Handle API errors, rate limits |

### 8.6 Acceptance Criteria

- [ ] User can configure AI providers in settings (API key, model selection)
- [ ] User can upload a PDF/image and extract a recipe
- [ ] Extracted recipe shows a review form before creating
- [ ] AI matches extracted ingredients to existing products
- [ ] New ingredients are flagged for manual review
- [ ] AI chat interface works with streaming responses
- [ ] Contextual AI assistant available within recipe detail
- [ ] AI can explain recipe cost breakdown in natural language
- [ ] AI can suggest ingredient substitutions with cost comparison
- [ ] AI calls go through Supabase Edge Functions (API keys server-side)

### 8.7 Lovable Prompts

---

#### Prompt 8.1: AI Recipe Import

```
Build the AI-powered Recipe Import page at `/recipes/import`.

PAGE: `src/pages/RecipeImportPage.tsx`

HEADER:
- Title "Import Recipe"
- Subtitle "Upload a recipe document and AI will extract the details"

STEP 1: "Upload Source" (Card)
- Drag-and-drop zone (dashed border, bg-zinc-50, p-12):
  - Upload icon (CloudUpload, text-zinc-400)
  - "Drag & drop a file, or click to browse"
  - Accepted formats: PDF, DOCX, PNG, JPG, HEIC
  - Max file size: 10MB
  - File stored in Supabase Storage bucket "recipe-imports"
- OR: Text input tab (Tabs: "Upload File" | "Paste Text" | "From URL")
  - Paste Text: Textarea (8 rows, paste recipe text)
  - From URL: Input for recipe URL [future feature, disabled]
- After upload: show file preview (thumbnail for images, filename + size for docs)
- "Extract Recipe" Button (brand-600, Sparkles icon)
  - Shows loading state: "AI is reading your recipe..." with animated dots
  - Progress: parsing -> extracting -> matching ingredients

STEP 2: "Review Extracted Data" (Card, shown after extraction)
Split view: original on left, extracted on right.

LEFT (w-1/2): 
- Original document preview:
  - Image: show the image
  - PDF: embedded PDF viewer or page images
  - Text: formatted text display

RIGHT (w-1/2):
- Editable form with extracted data:
  - Name (Input, pre-filled)
  - Category (Select, pre-filled if detected)
  - Yield (Input number + unit Select)
  - Prep Time / Cook Time (Input numbers)
  
  - Ingredients table:
    For each extracted ingredient:
    - Extracted text (text-sm text-zinc-400, original text)
    - Matched Product (Combobox):
      - If AI matched to existing product: pre-selected, green check icon
      - If no match: amber warning icon, "New ingredient" badge
      - User can search and override the match
    - Quantity (Input number, pre-filled)
    - Unit (Select, pre-filled)
    - Notes (Input, pre-filled with any modifiers like "diced")
    - Confidence indicator: green/amber/red dot based on AI match confidence
  
  - Method (Textarea, pre-filled with steps)
  - Notes (Textarea)

- Validation:
  - Highlight low-confidence matches in amber
  - Show "X of Y ingredients matched to existing products"
  - List unmatched ingredients with option to: "Create as New Product" or "Match Manually"

STEP 3: "Create Recipe" (after review)
- "Create Recipe" Button (brand-600)
- For unmatched ingredients marked "Create as New Product":
  - Auto-create product records with name and estimated unit
  - Flag them for price/nutrition data entry later
- Creates recipe with ingredients, method, metadata
- Redirects to /recipes/:newId
- Toast: "Recipe imported successfully. X new products were created and need pricing."

AI CALL:
- Uses Supabase Edge Function `functions/extract-recipe/index.ts`
- Sends file to AI provider (configured in org settings)
- Uses the RECIPE_EXTRACTION_PROMPT with current product list for matching
- Returns structured JSON
- Client receives extraction result and renders review form

EDGE FUNCTION EXAMPLE:
```typescript
// functions/extract-recipe/index.ts
import { serve } from 'https://deno.land/std/http/server.ts'

serve(async (req) => {
  const { file_url, source_type, product_names } = await req.json()
  
  // Get AI provider config from org settings
  // Build prompt with product matching context
  // Call AI API
  // Parse response
  // Return structured recipe data
})
```

RESPONSIVE:
- On mobile: step-by-step flow (one step visible at a time)
- Split view becomes stacked on mobile (original above, extracted below)
```

**Expected Output:** Multi-step recipe import workflow with file upload, AI extraction, side-by-side review, ingredient matching to existing products, confidence indicators, and recipe creation.

---

#### Prompt 8.2: AI Chat Interface

```
Build the AI Chat interface at `/ai` and as a slide-out panel accessible from any page.

STANDALONE PAGE `/ai`:

LAYOUT: full-height, flex column, max-w-3xl mx-auto

SIDEBAR (w-64, hidden on mobile):
- "New Chat" Button (brand-600, Plus icon)
- Conversation history list:
  - Each: title (auto-generated or first message truncated) + date
  - Click to load conversation
  - Delete button on hover
- "Conversations" heading

CHAT AREA:

EMPTY STATE (no messages):
- Welcome message: "Ask me about recipes, costs, or ingredients"
- Suggestion chips (grid of 4 cards, cursor-pointer):
  - "Why is my {recipe} food cost so high?"
  - "Suggest alternatives for {ingredient}"
  - "Help me create a recipe for..."
  - "Explain my cost breakdown"
- Each chip: border, rounded-lg, p-4, hover:bg-zinc-50

MESSAGE DISPLAY (flex flex-col gap-4, overflow-y-auto):
- User messages: bg-zinc-100 rounded-lg p-4, max-w-[80%], self-end
- AI messages: bg-white border rounded-lg p-4, max-w-[80%], self-start
  - AI avatar: small icon (Sparkles) in brand-600
  - Content rendered as Markdown (use react-markdown)
  - Code blocks with syntax highlighting
  - Tables rendered as HTML tables
- Streaming: AI message builds character by character with blinking cursor

INPUT BAR (sticky bottom, p-4, border-t):
- Textarea (auto-grow, min 1 row max 6 rows, placeholder "Ask about recipes, costs, ingredients...")
- Send button (brand-600, ArrowUp icon, disabled when empty)
- Attach button (Paperclip icon): attach a recipe, product, or image for context
- Model indicator: small text showing current model ("Claude Sonnet 4")
- Keyboard: Enter to send, Shift+Enter for newline

CONTEXTUAL PANEL (accessible from recipe/product detail pages):
- Small floating button in bottom-right: Sparkles icon, brand-600, rounded-full, shadow-lg
- Click opens a Sheet (slide from right, w-96):
  - Same chat interface but with pre-loaded context
  - System message includes current recipe/product data
  - E.g., on a recipe page: "You are helping with recipe: {name}. Cost: {cost}. Ingredients: {list}."

FEATURES:
1. Cost explanation: when user asks about cost, AI receives the full cost breakdown and explains in natural language
2. Substitution suggestions: user mentions needing alternatives, AI suggests from existing products with cost comparison
3. Recipe optimization: AI analyzes food cost % and suggests ways to reduce cost
4. Scaling help: "What if I make 200 portions of this?"

SUPABASE INTEGRATION:
- Conversations and messages stored in ai_conversations / ai_messages
- Edge Function `functions/ai-chat/index.ts`:
  - Receives message + conversation history + optional context
  - Builds system prompt with relevant data (recipe, products, costs)
  - Calls AI provider
  - Streams response back using SSE (Server-Sent Events)
  - Saves messages to database

STREAMING:
```typescript
// Client-side streaming
const response = await fetch('/functions/v1/ai-chat', {
  method: 'POST',
  body: JSON.stringify({ messages, context }),
});

const reader = response.body?.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  const chunk = decoder.decode(value);
  // Append to current message display
  setCurrentMessage(prev => prev + chunk);
}
```

RESPONSIVE:
- Mobile: full screen chat, no sidebar (conversations accessible via hamburger)
- Contextual panel: full screen on mobile instead of sheet
```

**Expected Output:** Full AI chat interface with streaming responses, conversation history, contextual awareness (recipe/product data), suggestion chips, markdown rendering, and a slide-out panel for contextual AI from any page.

---

### 8.8 Expected Output Summary

After Phase 8:

- AI provider abstraction layer (OpenAI, Anthropic, Gemini, Apple)
- Recipe import from PDF, images, and text with AI extraction
- Ingredient matching to existing product database
- AI chat with streaming and contextual awareness
- Cost explanation in natural language
- Ingredient substitution suggestions
- AI configuration in settings

### 8.9 Dependencies

- Phase 1-2 complete (products, recipes)
- At least one AI API key configured
- Supabase Edge Functions enabled

---

## Phase 9: Reporting & Analytics (Weeks 21-22)

### 9.1 Objectives

- Build role-specific dashboards (Management, Chef, Purchasing)
- Create standard reports (cost, margin, inventory, waste)
- Implement export to PDF and Excel
- Add cost trend analysis over time

### 9.2 Database Changes

```sql
-- Saved reports configuration
CREATE TABLE saved_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  report_type TEXT NOT NULL,
  filters JSONB NOT NULL DEFAULT '{}',
  created_by UUID REFERENCES auth.users(id),
  is_shared BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cost snapshots (periodic snapshots for trend analysis)
CREATE TABLE cost_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('product','sub_recipe','recipe')),
  entity_id UUID NOT NULL,
  cost NUMERIC(12,4) NOT NULL,
  selling_price NUMERIC(12,2),
  food_cost_pct NUMERIC(5,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Daily/weekly cost snapshot job
CREATE INDEX idx_cost_snapshots_entity ON cost_snapshots(entity_type, entity_id, snapshot_date);
CREATE INDEX idx_cost_snapshots_date ON cost_snapshots(organization_id, snapshot_date);
```

### 9.3 UI Changes

| Screen | Route | Description |
|--------|-------|-------------|
| Management Dashboard | `/dashboard` | KPIs, trends, alerts |
| Chef Dashboard | `/dashboard/chef` | Production, prep, recipes |
| Purchasing Dashboard | `/dashboard/purchasing` | Stock, orders, prices |
| Reports Hub | `/reports` | Report selection and generation |
| Report Viewer | `/reports/:type` | Interactive report display |

### 9.4 Business Logic

```typescript
// Dashboard KPIs
interface ManagementKPIs {
  totalRecipes: number;
  activeRecipes: number;
  avgFoodCostPct: number;
  avgContributionMargin: number;
  recipesOverTarget: number;
  totalInventoryValue: number;
  wasteThisMonth: number;
  topCostRecipes: Recipe[];
  costTrend: { date: string; avgCost: number }[];
}

// Report types
type ReportType =
  | 'recipe_cost_summary'      // All recipes with costs, margins
  | 'food_cost_analysis'       // Recipes grouped by FC% bands
  | 'ingredient_usage'         // Most used ingredients across recipes
  | 'supplier_spend'           // Spend by supplier
  | 'inventory_valuation'      // Current stock value
  | 'waste_report'             // Waste by reason, period
  | 'price_history'            // Price changes over time
  | 'allergen_report'          // Full allergen matrix
  | 'nutrition_report'         // Nutrition across recipes
  | 'menu_profitability'       // Menu item performance
```

### 9.5 Testing

| Test | Type | Description |
|------|------|-------------|
| Dashboard data | Integration | KPIs calculate correctly |
| Report generation | Integration | Each report type renders |
| PDF export | Integration | PDF generates with correct data |
| Excel export | Integration | XLSX generates with correct columns |
| Trend data | Unit | Cost snapshots produce valid trends |

### 9.6 Acceptance Criteria

- [ ] Management dashboard shows key KPIs with trend indicators
- [ ] Chef dashboard shows production and recipe information
- [ ] Purchasing dashboard shows stock levels and order status
- [ ] All standard reports generate correctly
- [ ] Reports can be filtered by date range, category, status
- [ ] PDF export produces a professional document
- [ ] Excel export includes all data with proper formatting
- [ ] Cost trends show historical data over configurable periods

### 9.7 Lovable Prompts

---

#### Prompt 9.1: Management Dashboard

```
Build the Management Dashboard at `/dashboard`.

PAGE: `src/pages/DashboardPage.tsx`

This replaces the placeholder dashboard from Phase 1.

HEADER:
- "Dashboard" title
- Date range selector: "Today", "This Week", "This Month", "This Quarter", "Custom"
- Greeting: "Good morning, {user.full_name}" with current date

KPI CARDS (grid-cols-5 on desktop, grid-cols-2 on mobile + 1 full width):
1. Active Recipes
   - Value: count (text-3xl font-bold)
   - Change: +3 this month (text-sm text-green-600, or red if negative)
   - Icon: ChefHat
   
2. Avg Food Cost %
   - Value: XX.X% (colored: green < 30, amber 30-35, red > 35)
   - Change: -1.2% vs last month
   - Sparkline: mini line chart (last 6 months)
   - Icon: Percent
   
3. Avg Contribution Margin
   - Value: AED XX.XX
   - Change: +AED 2.30
   - Icon: TrendingUp
   
4. Inventory Value
   - Value: AED XX,XXX (formatted with commas)
   - Change: % from last count
   - Icon: Warehouse
   
5. Waste This Month
   - Value: AED X,XXX
   - Change: vs last month %
   - Color: red if higher than last month
   - Icon: Trash2

CHART ROW 1 (2 charts side by side, stacked on mobile):

LEFT: "Food Cost Trend" (Card)
- recharts AreaChart
- X: months (last 12)
- Y: average food cost % across all active recipes
- Area fill: brand-100, stroke: brand-600
- Reference line: target food cost % (dashed red)
- Tooltip: month, avg %, recipe count

RIGHT: "Top 10 Recipes by Margin" (Card)
- recharts BarChart (horizontal)
- Y: recipe names (truncated)
- X: contribution margin (AED)
- Bars colored by food cost band (green/amber/red)
- Tooltip: recipe name, margin, FC%, selling price

CHART ROW 2:

LEFT: "Cost Distribution" (Card)
- recharts PieChart / donut
- Slices: recipes grouped by food cost % bands
  - Under 25% (green)
  - 25-30% (light green)
  - 30-35% (amber)
  - 35-40% (orange)
  - Over 40% (red)
- Center: total recipe count
- Legend below with counts

RIGHT: "Recent Activity" (Card)
- Timeline of recent events:
  - Recipe created/updated
  - Product price changed
  - Stock count completed
  - PO received
  - Waste logged
- Each: icon + description + relative time
- Max 10 items, "View All" link

ALERTS SECTION (Card, below charts):
- Title: "Attention Required" (with warning triangle)
- Alert items:
  - Recipes over target food cost (list, linked)
  - Low stock items (below reorder point)
  - Products with price increases > 10% (last 30 days)
  - Purchase orders pending delivery
- Each alert: colored left border (red/amber/blue) + icon + description + count + "View" link
- If no alerts: "All clear! No items need attention." with green check

QUICK ACTIONS (row of 4 buttons at bottom):
- "New Recipe" (ChefHat)
- "Start Count" (ClipboardList)
- "Create Order" (ShoppingCart)
- "Run Report" (BarChart3)

SUPABASE:
Multiple parallel queries to build dashboard data. Use TanStack Query's useQueries for parallel fetching:
```typescript
const results = useQueries({
  queries: [
    { queryKey: ['kpi-recipes', orgId], queryFn: () => fetchRecipeKPIs(orgId) },
    { queryKey: ['kpi-inventory', orgId], queryFn: () => fetchInventoryKPIs(orgId) },
    { queryKey: ['kpi-waste', orgId], queryFn: () => fetchWasteKPIs(orgId) },
    { queryKey: ['chart-cost-trend', orgId], queryFn: () => fetchCostTrend(orgId) },
    { queryKey: ['chart-top-recipes', orgId], queryFn: () => fetchTopRecipes(orgId) },
    { queryKey: ['recent-activity', orgId], queryFn: () => fetchActivity(orgId) },
    { queryKey: ['alerts', orgId], queryFn: () => fetchAlerts(orgId) },
  ]
})
```

RESPONSIVE:
- KPI cards wrap to 2 columns on mobile
- Charts stack vertically on mobile
- Activity feed scrolls horizontally on mobile
- Quick actions: 2x2 grid on mobile
```

**Expected Output:** Comprehensive management dashboard with KPI cards, trend charts, cost distribution, activity timeline, alerts requiring attention, and quick action buttons.

---

#### Prompt 9.2: Reports Hub and Export

```
Build the Reports Hub at `/reports` and individual report views.

REPORTS HUB `/reports`:

HEADER:
- Title "Reports"
- Subtitle "Generate and export business reports"

REPORT CATEGORIES (grid-cols-3 desktop, 1 mobile):

Category cards, each containing report type cards:

"Costing Reports":
- Recipe Cost Summary: all recipes with full cost breakdown
- Food Cost Analysis: recipes grouped by FC% bands
- Cost Comparison: compare recipe costs over time

"Inventory Reports":
- Inventory Valuation: current stock value by category
- Stock Movement: ins and outs over period
- Waste Report: waste by reason and value

"Purchasing Reports":
- Supplier Spend: total spend by supplier
- Price History: product price changes over time
- Purchase Order Summary: PO totals by period

"Menu Reports":
- Menu Profitability: menu item performance analysis
- Allergen Matrix: full allergen cross-reference
- Nutrition Summary: nutrition across menu items

Each report card:
- Icon + title (font-medium)
- Description (text-sm text-zinc-500)
- Click to navigate to report view
- "Quick Export" buttons: PDF icon + Excel icon (small outline buttons)

INDIVIDUAL REPORT VIEW `/reports/:type`:

HEADER:
- Back -> /reports
- Report title
- Export buttons: "Export PDF" (outline, FileText icon) + "Export Excel" (outline, Sheet icon)

FILTERS BAR (varies by report, all wrapped in Card):
- Date range (always present): From + To date pickers
- Category filter (where applicable)
- Status filter (where applicable)
- "Generate Report" Button (brand-600)

REPORT DISPLAY:
- Summary cards at top (key metrics from report)
- Data table (main report content)
- Chart visualization (where applicable)

Example: "Recipe Cost Summary" report:
- Summary: Total recipes, Avg FC%, recipes over target, total cost
- Chart: bar chart of FC% distribution
- Table:
  | Recipe | Category | Portions | Ingredient Cost | Security Margin | Total Cost | Cost/Portion | Price | FC% | Margin |
  Sortable, filterable columns
  Totals/averages row at bottom

PDF EXPORT:
- Uses @react-pdf/renderer or jspdf
- Professional layout:
  - Company logo + name header
  - Report title + date range
  - Summary metrics in boxes
  - Data table with zebra striping
  - Footer: page numbers + generated date
  - A4 format

EXCEL EXPORT:
- Uses xlsx library (SheetJS)
- Workbook with:
  - Summary sheet (metrics)
  - Data sheet (full table data)
  - Chart data sheet (for Excel chart generation)
  - Headers, column widths, number formatting
  - Currency columns formatted as "AED #,##0.00"
  - Percentage columns formatted as "0.0%"

SAVED REPORTS:
- "Save Report" Button: saves current filters as a named report
- Saved reports appear in a "My Reports" section on the Reports Hub
- Click to re-run with saved filters

RESPONSIVE:
- Report tables scroll horizontally on mobile with sticky first column
- Export buttons accessible on mobile
- Filters collapse into a single "Filters" button on mobile
```

**Expected Output:** Reports hub with categorized report types, individual report views with filters and visualizations, PDF export with professional layout, Excel export with formatted workbook, and saved report configurations.

---

### 9.8 Expected Output Summary

After Phase 9:

- Management dashboard with KPIs and trend charts
- Alert system for items requiring attention
- Standard reports across costing, inventory, purchasing, and menus
- Professional PDF export
- Formatted Excel export
- Saved report configurations
- Cost trend analysis from historical snapshots

### 9.9 Dependencies

- Phases 1-7 for data to report on
- Cost snapshots need a scheduled job (Supabase cron or Edge Function)

---

## Phase 10: Cross-Platform & Polish (Weeks 23-26)

### 10.1 Objectives

- Wrap the web app in Tauri for macOS desktop
- Wrap in Capacitor for iOS/iPadOS
- Implement offline-first data sync
- Build specialized modes: Kitchen Mode, Production Mode
- Integrate Apple native features

### 10.2 Database Changes

```sql
-- Sync metadata
CREATE TABLE sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  device_id TEXT NOT NULL,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sync_status TEXT NOT NULL DEFAULT 'synced' CHECK (sync_status IN ('synced','pending','error')),
  pending_changes INTEGER NOT NULL DEFAULT 0,
  metadata JSONB
);

-- Device registrations for push notifications
CREATE TABLE device_registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  device_type TEXT NOT NULL CHECK (device_type IN ('web','macos','ios','ipados')),
  device_token TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, device_token)
);
```

### 10.3 UI Changes

| Screen | Component | Description |
|--------|-----------|-------------|
| Kitchen Mode | `/kitchen` | Large text, touch-optimized recipe view |
| Production Mode | `/production-mode` | Streamlined production workflow |
| Offline Indicator | (global component) | Sync status bar |
| macOS Menu Bar | (Tauri) | Native macOS menu integration |
| iPadOS Split View | (Capacitor) | Support for Split View multitasking |

### 10.4 Business Logic

```typescript
// Offline sync strategy
// 1. All reads come from local IndexedDB cache first (optimistic)
// 2. Changes are written to local store + queued for sync
// 3. Background sync pushes changes when online
// 4. Conflict resolution: last-write-wins with server timestamp
// 5. Sync state shown in UI (synced, pending, error)

// Kitchen Mode: simplified recipe view
// - Large font (text-2xl for ingredients, text-xl for method)
// - High contrast (black on white)
// - Step-by-step navigation (prev/next buttons)
// - Voice readout (Web Speech API)
// - Timer integration
// - Screen stays awake (Wake Lock API)
```

### 10.5 Testing

| Test | Type | Description |
|------|------|-------------|
| Offline mode | Integration | CRUD operations while offline |
| Sync recovery | Integration | Queue resolves when back online |
| Kitchen mode | Visual | Readable at arm's length |
| Tauri build | Build | macOS app builds and runs |
| Capacitor build | Build | iOS app builds and runs |

### 10.6 Acceptance Criteria

- [ ] macOS app launches via Tauri with native window chrome
- [ ] iOS/iPadOS app installs and works from Capacitor
- [ ] App works offline with queued sync
- [ ] Sync indicator shows pending changes and syncs when reconnected
- [ ] Kitchen Mode shows recipes in large, high-contrast format
- [ ] Kitchen Mode supports step-by-step navigation
- [ ] Kitchen Mode includes built-in timers
- [ ] Production Mode streamlines the production workflow
- [ ] Face ID / Touch ID used for authentication on iOS
- [ ] Handoff works between iOS and macOS for the same recipe

### 10.7 Lovable Prompts

---

#### Prompt 10.1: Kitchen Mode

```
Build Kitchen Mode at `/kitchen`.

This is a specialized view for use on a tablet or screen in the kitchen. It should be readable from several feet away.

PAGE: `src/pages/KitchenModePage.tsx`

ENTRY: Full-screen overlay, dark theme forced.

HEADER (h-16, bg-zinc-900, sticky):
- "Kitchen Mode" badge (green pulse dot + text)
- Current recipe name (text-xl font-bold text-white, truncate)
- Exit button (X icon, top-right) -> returns to normal view
- Clock display (current time, text-lg, updated every second)

RECIPE SELECTOR (if no recipe selected):
- Full-screen grid of recipe cards (grid-cols-3 on iPad, 2 on phone)
- Each card: 
  - Large text (text-xl font-bold)
  - Category badge
  - Image (if available) or gradient placeholder
  - Tap to select
- Search bar at top (large, text-xl, h-16)
- Filter by category (large toggle buttons)

RECIPE VIEW (after selection):

Two modes: "Ingredients" tab and "Method" tab (large tab buttons, h-14)

INGREDIENTS VIEW:
- Full-screen list of ingredients
- Each ingredient row (min-h-20, border-b border-zinc-700):
  - Checkbox (w-8 h-8, for tracking what's been prepped)
  - Ingredient name (text-2xl font-medium text-white)
  - Quantity + unit (text-2xl text-brand-400, right-aligned)
  - Checked items: line-through, opacity-50

SCALE CONTROLS (sticky bottom bar):
- "Portions:" label + large number display
- [-] [+] buttons (w-14 h-14, large touch targets)
- All quantities update in real-time when portions change
- Current portions vs original: "4x" indicator

METHOD VIEW:
- Step-by-step display (one step at a time, full screen):
  - Step number (text-6xl font-bold text-brand-400, top-left)
  - Step text (text-2xl leading-relaxed text-white)
  - Navigation: large Previous/Next buttons (w-full h-20 each, at bottom)
  - Step progress: dots indicator (like a carousel)
  - Swipe gesture support for prev/next

TIMER INTEGRATION:
- Timer button on steps that mention time (auto-detected: "cook for 5 minutes")
- Timer component:
  - Circular display (text-5xl font-bold)
  - Start/Pause/Reset buttons (large)
  - Audio alert when timer completes
  - Multiple concurrent timers supported
  - Timer persists across step navigation

FEATURES:
- Screen wake lock: `navigator.wakeLock.request('screen')` to prevent sleep
- Dark theme: forced dark regardless of system setting
- Large touch targets throughout (minimum 44x44 points, ideally 56x56)
- No small text (minimum text-lg, most text-xl or larger)
- High contrast: white text on dark background
- Haptic feedback on timer events

RESPONSIVE:
- Designed for landscape iPad primarily
- Works on portrait phone but ingredient list scrolls
- No sidebar, no header navigation (full immersive mode)
```

**Expected Output:** Full-screen kitchen mode with large text, step-by-step method navigation, real-time scaling, built-in timers, dark theme, and wake lock -- designed for kitchen tablet use.

---

#### Prompt 10.2: Offline Sync System

```
Build the offline-first sync system and sync status UI.

OFFLINE STORE `src/lib/offlineStore.ts`:
- Uses IndexedDB (via idb library) to cache all data locally
- Database structure mirrors Supabase tables:
  - products, sub_recipes, recipes, etc.
  - sync_queue table for pending changes

SYNC ENGINE `src/lib/syncEngine.ts`:
```typescript
interface SyncEngine {
  // Initialize: download all org data on first launch
  initialize(orgId: string): Promise<void>;
  
  // Read: always from local store first
  read<T>(table: string, query: QueryParams): Promise<T[]>;
  
  // Write: save locally + queue for sync
  write(table: string, operation: 'insert' | 'update' | 'delete', data: any): Promise<void>;
  
  // Sync: push queued changes, pull updates
  sync(): Promise<SyncResult>;
  
  // Status
  getStatus(): SyncStatus;
  getPendingCount(): number;
}

interface SyncStatus {
  isOnline: boolean;
  lastSyncedAt: Date | null;
  pendingChanges: number;
  syncInProgress: boolean;
  errors: SyncError[];
}
```

SYNC STRATEGY:
1. On app load: check online status, pull latest changes
2. All reads: IndexedDB first (instant), then background refresh from Supabase
3. All writes: IndexedDB immediately + add to sync queue
4. Background sync: every 30 seconds when online, push queue then pull changes
5. Conflict resolution: server timestamp wins (last-write-wins)
6. When coming back online: flush entire queue

SYNC QUEUE:
```typescript
interface QueueItem {
  id: string;
  table: string;
  operation: 'insert' | 'update' | 'delete';
  data: any;
  created_at: number;
  retry_count: number;
  last_error?: string;
}
```

SYNC STATUS UI:

COMPONENT: `src/components/SyncIndicator.tsx`
- Shows in the header bar (right side, before user avatar)
- States:
  1. Online + Synced: green dot, "Synced" text (text-sm text-green-600), hidden after 3 seconds
  2. Online + Syncing: blue spinner, "Syncing..." text
  3. Online + Pending: amber dot + count badge, "3 pending" text
  4. Offline: red dot, "Offline" text, pulsing
  5. Error: red dot + exclamation, "Sync error" text, click for details

- Click opens Popover with details:
  - Connection status
  - Last synced: relative time
  - Pending changes: count
  - If errors: list of failed items with retry button
  - "Sync Now" Button (manual trigger)
  - "Clear Queue" Button (destructive, with confirmation)

ONLINE/OFFLINE DETECTION:
```typescript
// Listen for online/offline events
window.addEventListener('online', () => syncEngine.sync());
window.addEventListener('offline', () => updateStatus('offline'));

// Also: periodic fetch to a health endpoint as backup detection
// navigator.onLine can be unreliable
```

BACKGROUND SYNC (Service Worker):
- Register a service worker for background sync
- When queue has items and connection returns: trigger sync
- Show notification when background sync completes

INITIAL DATA DOWNLOAD:
- On first login or when cache is empty:
  - Show progress modal: "Setting up offline access..."
  - Progress bar: "Downloading products... 245/657"
  - Download all org data in batches
  - Store in IndexedDB
  - Mark as initialized

REACT INTEGRATION:
```typescript
// Custom hook wrapping sync-aware reads
function useSyncedQuery<T>(
  table: string,
  query: QueryParams,
  options?: { refetchOnSync?: boolean }
) {
  // 1. Immediately return IndexedDB data
  // 2. If online: also fetch from Supabase in background
  // 3. If Supabase returns newer data: update IndexedDB + re-render
  // 4. If offline: just return cached data with stale indicator
}
```

RESPONSIVE: Sync indicator adapts to mobile (icon only, no text).
```

**Expected Output:** Complete offline-first sync system with IndexedDB caching, sync queue, conflict resolution, background sync, status indicator, and React hooks for sync-aware data access.

---

### 10.8 Expected Output Summary

After Phase 10:

- Tauri macOS desktop app
- Capacitor iOS/iPadOS app
- Offline-first with reliable sync
- Kitchen Mode for in-kitchen tablet use
- Production Mode for prep workflow
- Sync status indicator
- Apple native features (Face ID, Handoff, Spotlight)

### 10.9 Dependencies

- Phases 1-9 complete (full web application)
- Apple Developer account for native builds
- macOS for Tauri development
- Xcode for Capacitor builds

---

## Phase 11: Version Control & Audit (Weeks 27-28)

### 11.1 Objectives

- Implement recipe versioning with diff comparison
- Build audit logging for all data changes
- Create an approval workflow for recipe changes
- Display change history timeline

### 11.2 Database Changes

```sql
-- Recipe versions
CREATE TABLE recipe_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  snapshot JSONB NOT NULL,            -- full recipe data at this version
  change_summary TEXT,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(recipe_id, version_number)
);

-- Sub recipe versions
CREATE TABLE sub_recipe_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sub_recipe_id UUID NOT NULL REFERENCES sub_recipes(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  snapshot JSONB NOT NULL,
  change_summary TEXT,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(sub_recipe_id, version_number)
);

-- Audit log (all changes across the system)
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  table_name TEXT NOT NULL,
  record_id UUID NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('insert','update','delete')),
  old_data JSONB,
  new_data JSONB,
  changed_fields TEXT[],
  user_id UUID REFERENCES auth.users(id),
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Approval workflow
CREATE TABLE approval_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('recipe','sub_recipe','product','menu')),
  entity_id UUID NOT NULL,
  version_id UUID,                    -- which version needs approval
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','withdrawn')),
  requested_by UUID NOT NULL REFERENCES auth.users(id),
  reviewed_by UUID REFERENCES auth.users(id),
  request_note TEXT,
  review_note TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ
);

CREATE INDEX idx_audit_log_entity ON audit_log(table_name, record_id);
CREATE INDEX idx_audit_log_org ON audit_log(organization_id, created_at DESC);
CREATE INDEX idx_recipe_versions_recipe ON recipe_versions(recipe_id, version_number DESC);
CREATE INDEX idx_approval_requests_org ON approval_requests(organization_id, status);
```

### 11.3 UI Changes

| Screen | Route | Description |
|--------|-------|-------------|
| Recipe History | `/recipes/:id/history` | Version timeline and diff |
| Audit Log | `/settings/audit-log` | System-wide audit trail |
| Approvals | `/approvals` | Pending approval requests |

### 11.4 Business Logic

```typescript
// Version diff calculation
function diffRecipeVersions(
  v1: RecipeSnapshot,
  v2: RecipeSnapshot
): RecipeDiff {
  return {
    nameChanged: v1.name !== v2.name,
    ingredientsAdded: v2.ingredients.filter(i => !v1.ingredients.find(i2 => i2.product_id === i.product_id)),
    ingredientsRemoved: v1.ingredients.filter(i => !v2.ingredients.find(i2 => i2.product_id === i.product_id)),
    ingredientsModified: v2.ingredients.filter(i => {
      const prev = v1.ingredients.find(i2 => i2.product_id === i.product_id);
      return prev && (prev.quantity !== i.quantity || prev.unit_id !== i.unit_id);
    }),
    costChange: v2.total_cost - v1.total_cost,
    costChangePercent: ((v2.total_cost - v1.total_cost) / v1.total_cost) * 100,
    priceChanged: v1.selling_price !== v2.selling_price,
    methodChanged: v1.method !== v2.method,
  };
}

// Audit trigger (PostgreSQL function)
// Automatically captures all INSERT/UPDATE/DELETE across key tables
```

### 11.5 Testing

| Test | Type | Description |
|------|------|-------------|
| Version creation | Integration | Saving recipe creates version |
| Diff calculation | Unit | Correct diffs for various changes |
| Audit logging | Integration | All CRUD operations logged |
| Approval workflow | Integration | Request -> Review -> Apply |
| Version restore | Integration | Revert to previous version |

### 11.6 Acceptance Criteria

- [ ] Every recipe save creates a new version
- [ ] User can view version history timeline
- [ ] User can compare any two versions side-by-side
- [ ] Diff highlights added, removed, and changed ingredients
- [ ] Cost impact of changes is shown
- [ ] Audit log captures all data modifications
- [ ] Audit log is searchable by entity, user, date
- [ ] Approval workflow can be enabled per organization
- [ ] Pending approvals appear as notifications
- [ ] Approved changes are applied; rejected changes are marked with reason
- [ ] User can restore a recipe to a previous version

### 11.7 Lovable Prompts

---

#### Prompt 11.1: Recipe Version History and Diff

```
Build Recipe Version History view at `/recipes/:id/history`.

Access from recipe detail page via a "History" tab or button (Clock icon).

PAGE: `src/pages/RecipeHistoryPage.tsx`

HEADER:
- Back to recipe detail
- Title: "Version History: {recipe_name}"
- "Current Version: v{N}" badge

LAYOUT: Two-panel (left timeline, right detail/diff)

LEFT PANEL (w-80, border-r):
- Timeline of versions (vertical timeline component):
  Each version node:
  - Version number badge (v1, v2, v3...)
  - Date + time (text-sm text-zinc-500)
  - Changed by (user avatar + name)
  - Change summary (text-sm, auto-generated or user-provided):
    - "Added 2 ingredients, removed 1"
    - "Changed selling price from AED 45 to AED 50"
    - "Updated method steps"
  - Cost change indicator: "+AED 2.50 (+5.2%)" in green or red
  - Radio buttons for comparison: select two versions to diff
  - Timeline line connecting nodes (vertical, left side)
  - Current version: highlighted with brand-600 border

RIGHT PANEL:

MODE 1: Single version view (when one version selected):
- Full recipe snapshot display:
  - Name, category, yield, pricing
  - Ingredient list with costs
  - Cost summary
  - Method

MODE 2: Diff view (when two versions selected):
- Side-by-side or unified diff display
- Tabs: "Side by Side" | "Unified"

SIDE-BY-SIDE VIEW:
- Two columns: "Version X" | "Version Y"
- Each shows the full recipe

UNIFIED DIFF:
- Single column showing changes:
  
  "Details" section:
  - Changed fields highlighted: old value (red bg, line-through) -> new value (green bg)
  - Unchanged fields shown normally but dimmed
  
  "Ingredients" section:
  - Added ingredients: green bg, + icon
  - Removed ingredients: red bg, - icon, line-through
  - Changed quantities: amber bg, showing old -> new value
    - e.g., "Butter: 200g -> 250g (+25%)"
  - Unchanged ingredients: normal display, dimmed
  
  "Cost Impact" section (Card, bg-zinc-50):
  - Before: AED XX.XX (total cost)
  - After: AED XX.XX
  - Change: +/- AED X.XX (+/-X.X%)
  - Food Cost %: before -> after
  - Contribution Margin: before -> after
  
  "Method" section:
  - Text diff with green highlights (additions) and red strikethrough (deletions)
  - Use a simple text diff algorithm (diff library or custom)

ACTIONS:
- "Restore This Version" Button (outline, RotateCcw icon)
  - Confirmation dialog: "Restore recipe to version X? This will create a new version with the restored data."
  - On confirm: create a new version with the old snapshot's data, update the recipe

VERSION CREATION:
- Auto-create version on every recipe save (triggered from recipe detail save)
- Version snapshot includes: all recipe fields + ingredients + allergens + nutrition
- Auto-generate change summary by comparing with previous version

SUPABASE:
```typescript
supabase
  .from('recipe_versions')
  .select('*, created_by_profile:profiles!recipe_versions_created_by_fkey(full_name, avatar_url)')
  .eq('recipe_id', recipeId)
  .order('version_number', { ascending: false })
```

RESPONSIVE:
- On mobile: timeline is horizontal at top (scrollable), detail below
- Diff view: unified only on mobile (no side-by-side)
```

**Expected Output:** Recipe version history with interactive timeline, side-by-side and unified diff views, cost impact analysis, ingredient change highlighting, and version restore capability.

---

#### Prompt 11.2: Audit Log and Approval Workflow

```
Build the Audit Log page and Approval Workflow.

AUDIT LOG at `/settings/audit-log`:

HEADER:
- Title "Audit Log"
- Subtitle "Complete record of all data changes"
- Export button (CSV)

FILTERS (Card, p-4):
- Date range (From/To date pickers)
- User (Select from profiles)
- Entity type (Select: All, Product, Sub Recipe, Recipe, Menu, Supplier, etc.)
- Action (Select: All, Created, Updated, Deleted)
- Search (text search across old_data and new_data)

TABLE (shadcn Table):
1. Timestamp (formatted datetime)
2. User (avatar + name)
3. Action (Badge: insert=green "Created", update=blue "Updated", delete=red "Deleted")
4. Entity (icon + type + name from data)
5. Changes (expandable summary):
   - Collapsed: "Changed 3 fields: name, price, category"
   - Expanded: table of changed_fields with old -> new values
6. Details (expand row for full old_data / new_data JSON, formatted)

- Infinite scroll or pagination (50 per page)
- Empty state if no audit entries

AUDIT TRIGGER (PostgreSQL):
```sql
-- Generic audit trigger function
CREATE OR REPLACE FUNCTION audit_trigger_func()
RETURNS TRIGGER AS $$
DECLARE
  changed TEXT[];
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Calculate changed fields
    SELECT array_agg(key) INTO changed
    FROM jsonb_each(to_jsonb(NEW)) AS n(key, value)
    JOIN jsonb_each(to_jsonb(OLD)) AS o(key, value) ON n.key = o.key
    WHERE n.value IS DISTINCT FROM o.value;
  END IF;

  INSERT INTO audit_log (
    organization_id, table_name, record_id, action,
    old_data, new_data, changed_fields, user_id
  ) VALUES (
    COALESCE(NEW.organization_id, OLD.organization_id),
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    lower(TG_OP),
    CASE WHEN TG_OP != 'INSERT' THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP != 'DELETE' THEN to_jsonb(NEW) END,
    changed,
    auth.uid()
  );
  
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Apply to key tables
CREATE TRIGGER audit_products AFTER INSERT OR UPDATE OR DELETE ON products
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();
CREATE TRIGGER audit_recipes AFTER INSERT OR UPDATE OR DELETE ON recipes
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();
CREATE TRIGGER audit_sub_recipes AFTER INSERT OR UPDATE OR DELETE ON sub_recipes
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();
-- ... apply to other tables
```

APPROVALS PAGE at `/approvals`:

HEADER:
- Title "Approvals"
- Tabs: "Pending" | "Approved" | "Rejected" | "All"
- Badge on "Pending" tab with count

PENDING APPROVALS LIST:
Each approval request as a Card:
- Entity type badge (Recipe/Product/etc.) + entity name
- Requested by: avatar + name + date
- Request note (if provided)
- Version comparison: link to diff view
- Key changes summary: "Changed 3 ingredients, cost increased by AED 2.50"
- Action buttons:
  - "Approve" (Button, green variant)
  - "Reject" (Button, destructive variant)
  - "View Changes" (Button, outline)
- On approve/reject: dialog for optional review note

APPROVAL WORKFLOW SETTINGS (in `/settings/organization`):
- "Require Approval for Recipe Changes" (Switch)
- "Approval Required For" (checkboxes):
  - Recipe status change to Active
  - Recipe price changes
  - Recipe ingredient changes
  - Menu changes
- "Approvers" (multi-select of users with role manager+)

NOTIFICATION:
- When approval is requested: notification badge on sidebar
- When approval is reviewed: notification to requester
- Use Supabase Realtime to push notifications

RESPONSIVE:
- Audit log table scrolls horizontally on mobile
- Approval cards stack on mobile
```

**Expected Output:** System-wide audit log with filters and expandable change details, PostgreSQL audit triggers, approval workflow with pending/approved/rejected states, and configurable approval settings.

---

### 11.8 Expected Output Summary

After Phase 11:

- Complete recipe versioning with snapshot storage
- Visual diff comparison between any two versions
- Version restore capability
- System-wide audit logging via PostgreSQL triggers
- Configurable approval workflow
- Change notification system

### 11.9 Dependencies

- Phases 1-2 (recipes, sub recipes, products)
- Phase 10 helpful for notifications

---

## Phase 12: Advanced Features (Weeks 29-32)

### 12.1 Objectives

- Add multi-currency support with exchange rates
- Implement multi-location management
- Build advanced formula builder with custom variables
- Create bulk import/export tools
- Expose a REST API for external integrations
- Optimize performance for large datasets

### 12.2 Database Changes

```sql
-- Currencies
CREATE TABLE currencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,         -- 'AED', 'USD', 'EUR'
  name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  decimal_places INTEGER NOT NULL DEFAULT 2,
  is_active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE exchange_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  from_currency TEXT NOT NULL,
  to_currency TEXT NOT NULL,
  rate NUMERIC(18,8) NOT NULL,
  effective_date DATE NOT NULL,
  source TEXT,                       -- 'manual', 'api'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, from_currency, to_currency, effective_date)
);

-- Locations (physical locations within an org)
CREATE TABLE locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  address TEXT,
  timezone TEXT,
  currency TEXT DEFAULT 'AED',
  is_active BOOLEAN NOT NULL DEFAULT true,
  settings JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, name)
);

-- Location-specific pricing
CREATE TABLE location_recipe_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  selling_price NUMERIC(12,2) NOT NULL,
  selling_price_incl_vat NUMERIC(12,2),
  vat_percentage NUMERIC(5,2),
  is_available BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(location_id, recipe_id)
);

-- Import/export jobs
CREATE TABLE import_export_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('import','export')),
  entity_type TEXT NOT NULL,         -- 'products', 'recipes', etc.
  format TEXT NOT NULL CHECK (format IN ('csv','xlsx','json')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed')),
  file_url TEXT,
  result JSONB,                      -- { rows_processed, errors, warnings }
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- API keys for external access
CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL,            -- bcrypt hash of the key
  key_prefix TEXT NOT NULL,          -- first 8 chars for identification
  permissions TEXT[] NOT NULL DEFAULT '{}', -- ['products:read', 'recipes:read']
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 12.3 UI Changes

| Screen | Route | Description |
|--------|-------|-------------|
| Multi-Currency Settings | `/settings/currencies` | Currency and exchange rate management |
| Locations | `/settings/locations` | Multi-location management |
| Bulk Import | `/settings/import` | CSV/Excel import wizard |
| Bulk Export | `/settings/export` | Data export configuration |
| API Keys | `/settings/api` | API key management |
| Performance Dashboard | `/settings/performance` | System health metrics |

### 12.4 Business Logic

```typescript
// Multi-currency conversion
function convertCurrency(
  amount: number,
  fromCurrency: string,
  toCurrency: string,
  rates: ExchangeRate[],
  date?: Date
): number {
  if (fromCurrency === toCurrency) return amount;
  const rate = findRate(fromCurrency, toCurrency, rates, date);
  return amount * rate;
}

// Bulk import mapping
interface ImportMapping {
  sourceColumn: string;
  targetField: string;
  transform?: (value: string) => any;
  required: boolean;
  default?: any;
}

// Performance optimizations
// 1. Database: materialized views for dashboard queries
// 2. Frontend: virtual scrolling for large lists (>1000 items)
// 3. Supabase: edge function caching for expensive calculations
// 4. React: React.memo, useMemo, useCallback for render optimization
// 5. Images: lazy loading, WebP with fallback
```

### 12.5 Testing

| Test | Type | Description |
|------|------|-------------|
| Currency conversion | Unit | Various currencies, date-specific rates |
| Multi-location pricing | Integration | Location-specific prices |
| Bulk import | Integration | CSV with 1000 products |
| API authentication | Integration | Key generation, validation, permissions |
| Performance | Load | 1000 products, 500 recipes, dashboard load time |

### 12.6 Acceptance Criteria

- [ ] User can configure multiple currencies and exchange rates
- [ ] Product costs can be entered in different currencies and converted
- [ ] Multiple locations can be created within an organization
- [ ] Each location can have its own recipe pricing
- [ ] Bulk import supports CSV and Excel for products and recipes
- [ ] Import wizard maps columns and validates data before importing
- [ ] Data can be exported in CSV, Excel, and JSON formats
- [ ] API keys can be generated with specific permissions
- [ ] API endpoints return JSON data for products, recipes, menus
- [ ] Dashboard loads in under 2 seconds with 1000+ recipes
- [ ] Product list handles 5000+ products with virtual scrolling

### 12.7 Lovable Prompts

---

#### Prompt 12.1: Bulk Import Wizard

```
Build the Bulk Import Wizard at `/settings/import`.

PAGE: `src/pages/settings/ImportPage.tsx`

WIZARD STEPS (shadcn Stepper or custom step indicator):
Step 1 -> Step 2 -> Step 3 -> Step 4

STEP 1: "Select Data Type and File"
- Data type selector (large radio cards, grid-cols-3):
  - Products (Package icon): "Import products and ingredients"
  - Sub Recipes (FlaskConical icon): "Import sub recipes with ingredients"
  - Recipes (ChefHat icon): "Import recipes with ingredients"
  - Suppliers (Truck icon): "Import supplier information"
- File upload:
  - Drag-and-drop zone (CSV, XLSX)
  - Or: "Download Template" link for each type (generates a properly formatted template)
- "Next" Button

STEP 2: "Map Columns"
- Split view: left shows detected columns from file, right shows target fields

MAPPING TABLE:
| File Column      | Target Field        | Preview          | Required |
|------------------|---------------------|------------------|----------|
| "Product Name"   | Select: name*       | "Chicken Breast" | Yes (*)  |
| "Cat"            | Select: category    | "Meat"           | No       |
| "Price"          | Select: purchase_... | "25.50"          | Yes (*)  |
| "Unit"           | Select: purchase_... | "kg"             | No       |
| ...              | ...                 | ...              | ...      |

- Auto-detect mappings based on column header names (fuzzy matching)
- Target field dropdown shows all available fields with type hints
- Preview shows first value from file data
- Required fields marked with asterisk
- Unmapped columns shown in amber: "3 columns not mapped (will be ignored)"
- "Next" Button (disabled until required fields are mapped)

STEP 3: "Validate and Review"
- Validation results:
  - Summary card: "247 rows valid, 3 rows with errors, 12 rows with warnings"
  - Tabs: "All" | "Valid (247)" | "Errors (3)" | "Warnings (12)"
  
  Error rows (red background):
  - Row number + original data
  - Error message: "Row 45: Price is not a number: 'twelve'"
  - Fix options: edit inline or skip row
  
  Warning rows (amber background):
  - "Row 12: Category 'Protein' not found - will create new category"
  - "Row 88: Duplicate product code 'CHKN001' - will update existing"
  
  Valid rows: table preview showing mapped data
  
- Data transformations:
  - Unit matching: auto-match "kilograms" -> "kg", "grams" -> "g"
  - Category matching: fuzzy match to existing categories
  - Currency: detect and convert if needed
  - Number parsing: handle commas, different decimal separators

- "Fix All" batch options:
  - "Create missing categories" (checkbox)
  - "Update existing products on duplicate code" (checkbox)
  - "Skip rows with errors" (checkbox)

STEP 4: "Import"
- Progress display:
  - Progress bar with percentage
  - "Importing... 145/247" text
  - Real-time log:
    - "Created: Chicken Breast (CHKN001)"
    - "Updated: Salmon Fillet (SLMN002)"
    - "Skipped: Row 45 (invalid price)"
    - "Created category: Protein"
- On complete:
  - Summary: "Import complete: 244 created, 3 updated, 0 skipped"
  - Errors listed (if any)
  - "View Imported Items" Button -> navigates to list page
  - "Import Another File" Button

TEMPLATE DOWNLOAD:
- Products template (XLSX):
  - Columns: Name*, Code, Brand, Category, Purchase Unit*, Purchase Price*, Recipe Unit, Waste %, Energy (kcal), Protein (g), Fat (g), Carbs (g), Sodium (mg)
  - First row: column headers
  - Second row: example data
  - Third row: field descriptions
  - Data validation dropdowns for Category and Unit columns (from existing data)

SUPABASE:
- Edge Function for import processing:
  1. Parse file (xlsx or csv library)
  2. Apply mappings
  3. Validate each row
  4. Batch insert/update
  5. Return result summary

RESPONSIVE:
- Steps as vertical accordion on mobile
- Mapping table scrolls horizontally
- Import progress full-width
```

**Expected Output:** Multi-step import wizard with file upload, intelligent column mapping, data validation with inline fixes, progress tracking, and downloadable templates for each entity type.

---

#### Prompt 12.2: API Keys and External API

```
Build the API Key management page and external REST API.

API KEYS PAGE at `/settings/api`:

HEADER:
- Title "API Access"
- Subtitle "Generate API keys for external integrations"

EXPLANATION CARD (collapsible):
- "Use API keys to connect CulinaryCore with your POS, accounting, or other systems."
- Base URL display: `https://{project}.supabase.co/functions/v1/api`
- Link to API documentation

KEY LIST (Card):
- Table:
  1. Name (font-medium)
  2. Key prefix ("ck_live_abc12..." with copy button for full key, only shown once on creation)
  3. Permissions (badges: "Products: Read", "Recipes: Read/Write")
  4. Created (date)
  5. Last Used (relative time or "Never")
  6. Expires (date or "Never")
  7. Status (active/revoked)
  8. Actions: Revoke (destructive)

"Generate New Key" Button -> opens Dialog:
- Name (Input, e.g., "POS Integration")
- Permissions (checkbox grid):
  | Entity     | Read | Write |
  |------------|------|-------|
  | Products   | [ ]  | [ ]   |
  | Recipes    | [ ]  | [ ]   |
  | Sub Recipes| [ ]  | [ ]   |
  | Menus      | [ ]  | [ ]   |
  | Inventory  | [ ]  | [ ]   |
  | Suppliers  | [ ]  | [ ]   |
- Expiration (Select: 30 days, 90 days, 1 year, Never)
- "Generate" Button

ON GENERATION:
- Show the full API key ONCE in a highlighted box (bg-green-50):
  - Key value (font-mono, select-all on click)
  - Copy button
  - Warning: "Copy this key now. It won't be shown again."
- Store key_hash (bcrypt) and key_prefix in database

API ENDPOINTS (Supabase Edge Functions):

Base: `POST /functions/v1/api`

Authentication: `Authorization: Bearer ck_live_...`

Endpoints (RESTful, JSON):
```
GET  /api/v1/products                    - List products (paginated)
GET  /api/v1/products/:id                - Get product detail
POST /api/v1/products                    - Create product
PUT  /api/v1/products/:id                - Update product
GET  /api/v1/recipes                     - List recipes
GET  /api/v1/recipes/:id                 - Get recipe with ingredients, costs, nutrition
GET  /api/v1/recipes/:id/scale?portions=N - Get scaled recipe
GET  /api/v1/sub-recipes                 - List sub recipes
GET  /api/v1/sub-recipes/:id             - Get sub recipe detail
GET  /api/v1/menus                       - List menus
GET  /api/v1/menus/:id                   - Get menu with sections and items
GET  /api/v1/inventory/stock-levels      - Current stock levels
POST /api/v1/inventory/stock-counts      - Submit stock count
```

Response format:
```json
{
  "data": { ... },
  "meta": {
    "page": 1,
    "per_page": 20,
    "total": 245
  }
}
```

Error format:
```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid API key"
  }
}
```

RATE LIMITING:
- 100 requests per minute per key
- Return 429 with Retry-After header

API DOCUMENTATION (inline or separate page):
- For each endpoint: method, path, parameters, example request/response
- Authentication instructions
- Rate limit information
- Code examples (curl, JavaScript, Python)

RESPONSIVE: Key management works on mobile, API docs have code blocks with horizontal scroll.
```

**Expected Output:** API key management with permission-based access, secure key generation (show once), Supabase Edge Function API endpoints, rate limiting, and inline API documentation.

---

### 12.8 Expected Output Summary

After Phase 12:

- Multi-currency support with exchange rates
- Multi-location management with location-specific pricing
- Bulk import wizard with column mapping and validation
- Bulk export in CSV, Excel, JSON
- REST API with API key authentication
- Performance optimization for large datasets
- Virtual scrolling for large lists

### 12.9 Dependencies

- All previous phases complete
- Performance testing environment
- API documentation tooling

---

## Appendix A: Supabase Schema Summary

### Table Count by Phase

| Phase | Tables Added | Running Total |
|-------|-------------|---------------|
| 1 | 7 (organizations, profiles, product_categories, units, products, allergens, product_allergens) | 7 |
| 2 | 5 (sub_recipes, sub_recipe_ingredients, recipes, recipe_categories, recipe_ingredients) | 12 |
| 3 | 3 (sub_recipe_allergens, recipe_allergens, rda_values) | 15 |
| 4 | 3 (product_price_history, cost_formulas, recipe_price_history) | 18 |
| 5 | 5 (suppliers, supplier_products, purchase_orders, purchase_order_items) | 23 |
| 6 | 3 (menus, menu_sections, menu_items) | 26 |
| 7 | 6 (inventory_locations, inventory_counts, inventory_count_items, stock_levels, production_plans, production_plan_items, waste_log) | 33 |
| 8 | 4 (ai_providers, ai_conversations, ai_messages, import_jobs) | 37 |
| 9 | 2 (saved_reports, cost_snapshots) | 39 |
| 10 | 2 (sync_log, device_registrations) | 41 |
| 11 | 3 (recipe_versions, audit_log, approval_requests) | 44 |
| 12 | 6 (currencies, exchange_rates, locations, location_recipe_prices, import_export_jobs, api_keys) | 50 |

### Entity Relationship Summary

```
organizations (1) --< profiles (N)
organizations (1) --< products (N)
organizations (1) --< sub_recipes (N)
organizations (1) --< recipes (N)
organizations (1) --< menus (N)
organizations (1) --< suppliers (N)

products (1) --< sub_recipe_ingredients (N)
products (1) --< recipe_ingredients (N)
products (1) --< product_allergens (N)
products (1) --< supplier_products (N)

sub_recipes (1) --< sub_recipe_ingredients (N)
sub_recipes (1) --< recipe_ingredients (N)

recipes (1) --< recipe_ingredients (N)
recipes (1) --< menu_items (N)
recipes (1) --< recipe_versions (N)

menus (1) --< menu_sections (N)
menu_sections (1) --< menu_items (N)

suppliers (1) --< supplier_products (N)
suppliers (1) --< purchase_orders (N)
purchase_orders (1) --< purchase_order_items (N)
```

---

## Appendix B: Lovable Prompt Writing Guidelines

### Structure Template

Every Lovable prompt should follow this structure:

```
1. WHAT: Name and route of the page/component
2. LAYOUT: Overall structure (columns, grids, stacking behavior)
3. COMPONENTS: Exact shadcn/ui component names
4. DATA: Supabase table names, columns, and query structure
5. INTERACTIONS: Click handlers, form submissions, navigation
6. STATES: Loading, empty, error, success states
7. RESPONSIVE: Mobile, tablet, desktop breakpoints
8. VALIDATION: Form validation rules
9. STYLING: Specific Tailwind classes for critical elements
```

### shadcn/ui Component Reference

Always use these exact names in prompts:

| Need | Component |
|------|-----------|
| Buttons | Button (variants: default, destructive, outline, secondary, ghost, link) |
| Inputs | Input, Textarea, Select, Combobox, Switch, Checkbox, RadioGroup |
| Layout | Card (CardHeader, CardTitle, CardDescription, CardContent, CardFooter) |
| Data | Table (TableHeader, TableBody, TableRow, TableHead, TableCell) |
| Feedback | Alert, Toast (via Sonner), Badge, Skeleton |
| Navigation | Tabs, Breadcrumb, DropdownMenu, NavigationMenu |
| Overlay | Dialog, Sheet, Popover, Tooltip, AlertDialog |
| Forms | Form (with react-hook-form), Label |
| Command | CommandDialog (cmdk-based) |

### Tailwind Patterns

Standard spacing and sizing used throughout:

```
Page padding: p-6 (desktop), p-4 (mobile)
Card gaps: gap-4 or gap-6
Max content width: max-w-7xl mx-auto
Form max width: max-w-4xl
Font sizes: text-sm (helper), text-base (body), text-lg (subtitle), text-2xl (title), text-3xl+ (KPI values)
Colors: brand-600 (primary), zinc-500 (muted text), green-600 (success), red-600 (error), amber-500 (warning)
```

### Common Patterns

```typescript
// Data fetching pattern
const { data, isLoading, error } = useQuery({
  queryKey: ['entity', orgId, filters],
  queryFn: () => supabase.from('table').select('*').eq('organization_id', orgId),
})

// Mutation pattern
const mutation = useMutation({
  mutationFn: (data) => supabase.from('table').upsert(data),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['entity'] })
    toast.success('Saved successfully')
  },
  onError: (error) => toast.error(error.message),
})

// Form pattern
const form = useForm<FormData>({
  resolver: zodResolver(schema),
  defaultValues: existingData || defaults,
})
```

---

## Phase 13: Operations Control, Workforce & Finance Integration (Weeks 33–38)

### 13.1 Objectives

Implement the operational-control layer required for enterprise deployment: HACCP/traceability, workforce execution, purchase-to-pay, inter-site transfers, integration health and a safe accounting/payment boundary. This phase follows—not replaces—the recipe, inventory, costing and audit foundations.

### 13.2 Database changes

Add the CPSM/DOC2 operational extension tables: employee/skill/certification/availability/shift/time/leave/training; HACCP/check/corrective-action/temperature/lot/recall/label; requisition/receipt/invoice/match-exception/credit-note/accounting-export; transfers/approval-policy/cost-centre/GL mapping; and integration connection/sync/event/external-ID tables. Apply RLS, immutable audit history, tenant indexes, foreign keys, data-retention classifications and migration/rollback scripts.

### 13.3 UI changes

Build the operations command centre, schedule/labour workspace, HACCP/mobile check flow, lot/recall workspace, receiving/invoice-match screen, transfer/commissary flow and integration-health screen according to DOC4 section 29. Do not build raw card-payment capture; show provider payment state only.

### 13.4 Business logic

- Implement theoretical-versus-actual variance, FEFO/FIFO lot issue, blocked-lot enforcement, recall impact graph and auditable corrective-action closure.
- Implement requisition approvals, PO/GRN/invoice lifecycle, configurable two/three-way match tolerances, credit-note processing and idempotent accounting export.
- Implement schedule conflict warnings, training/certification eligibility, planned-versus-actual labour and connector-driven time-clock import.
- Implement scoped POS, accounting, payroll and IoT integration adapters with retries, dead-letter visibility, data freshness and external-ID idempotency.

### 13.5 Testing

Test tenant isolation and negative permissions; offline recovery; duplicate webhook and reprocessing protection; expired/recalled lot blocking; invoice tolerance/approval paths; accounting-export reconciliation; schedule conflict warning; HACCP evidence/corrective action; and AI extraction review boundaries. Run security, accessibility, visual and end-to-end tests.

### 13.6 Acceptance criteria

1. A received lot can be traced to affected production, recipe/menu exposure and every location, then blocked/recalled with action evidence.
2. A requisition can proceed through approval, PO, goods receipt, invoice and configurable three-way exception to an idempotent accounting export.
3. A shift can be created only with visible conflicts; actual time updates labour variance without exposing payroll-sensitive fields unnecessarily.
4. A failed external sync is visible, safely retryable and never creates duplicate financial/inventory records.
5. All affected workflows meet RBAC/RLS, audit, mobile, offline/recovery and accessibility requirements.

### 13.7 Lovable prompt

```text
Implement CulinaryCoreOS Phase 13 only. Before coding, read DOC1 Appendix H, DOC2 section 22, DOC3 section 21, DOC4 section 29, DOC5 section 8 and the CPSM architecture/security/AI rules.

Build the operations-control, workforce, food-safety traceability and purchase-to-pay workflows strictly on the existing React/TypeScript/Supabase architecture. Reuse existing semantic tokens and components. Add migrations, RLS policies, typed contracts, audit events, tests and documentation.

Do not implement a new POS, payroll engine or raw payment processing. Integrate through scoped, idempotent provider adapters and store only approved status/references. AI outputs are reviewable drafts; they may not post invoices, schedule staff autonomously, release blocked food or close safety actions.

Demonstrate the four acceptance flows in Phase 13. Report changed files, migrations, test results, permission checks, rollback plan, and unresolved decisions. Stop if a required external integration credential or legal/compliance decision is missing.
```

## Deployment Readiness Gate

Full deployment may begin only after the following evidence is attached to the release record:

- Approved production architecture, data-processing/privacy decisions, ADRs and operational runbooks.
- Successful staging migration, restore rehearsal, performance/load check and security/RLS test report.
- End-to-end demonstrations for recipe-to-COGS, lot-to-recall, requisition-to-accounting-export and schedule/task/training.
- Verified integration credentials, rate limits, error handling, monitoring, alerting and owner/support escalation.
- Pilot-location training, parallel-run reconciliation, sign-off from culinary, procurement, finance, operations and security owners.
- Explicit release scope: integrations and geographic compliance profiles that are live versus deferred.

## Mandatory Architecture Reset: Platform Core (Phase 0)

Before any new Procurement or People feature is built, complete a Phase 0 architecture reset. It creates the shared organisation hierarchy, scoped authorisation, data classification, workflow/approval engine, SOD enforcement, audit/evidence contract, integration hub and global My Work inbox described in `CulinaryCoreOS_PLATFORM_RESTRUCTURE_ANALYSIS.md`.

**Exit criteria:** approved access matrix; policy catalogue; RLS and server-side negative permission tests; delegation/self-approval/SOD tests; restricted-data masking/export tests; and a migration plan that does not break existing recipe/inventory access.

## Phase 14: Procurement & People Workspaces (Post-Foundation)

### Objectives

Build two secure workspaces on the Platform Core: Supply Chain (source-to-pay) and People (workforce foundation). Do not build a standalone procurement or HR application.

### Scope

- Supply Chain: supplier onboarding, catalogue, requisition, policy approval, PO, receiving, lot capture, invoice OCR review, two/three-way match, contracts, budget commitment and accounting export.
- People: employee master, organisation/manager assignment, skills/certifications, availability, roster, time-clock integration, leave, training and employee/manager self-service.
- Shared: a role-scoped approval centre, documents/evidence, notifications, integration health and command-centre links.

### Exclusions

Raw payment capture/execution, raw biometric storage, country-specific payroll calculation/tax filing, autonomous AI people decisions and unreviewed supplier/payment decisions are excluded until separately approved by ADR, privacy/compliance review and provider integration plan.

### Acceptance criteria

1. Procurement and People visibility respects scope, department and data classification at API/RLS level.
2. A policy can route a request by cost centre, amount, category and risk while preventing self-approval and SOD conflicts.
3. Employee skills/training constrain station assignment without exposing restricted HR data to kitchen users.
4. Accounting/payroll/POS/time-clock/IoT connectors use idempotent sync, external ID mapping, reconciliation status and visible failures.
5. The Command Centre drills from an aggregated metric to its source-domain record according to the viewer’s permission.

### Lovable prompt

```text
Implement CulinaryCoreOS Phase 0 and Phase 14 only after reading the Platform Restructure Analysis, CPSM, DOC1 Appendix I, DOC2 section 23, DOC3 section 22, DOC4 section 30 and DOC5 section 9.

Create shared platform services first. Then implement scoped Supply Chain and People workspaces using typed contracts, Supabase RLS, server-side policy checks, immutable audit events, data classification, semantic design tokens and existing components. Never create a duplicate user, approval, document, notification or connector subsystem.

Do not implement payroll/payment execution, raw biometric storage or autonomous AI decisions. Implement provider boundaries and explicit UI states instead. Add migrations, tests and runbooks. Demonstrate scope isolation, SOD prevention, restricted-data masking, delegation, and end-to-end purchase/roster workflows before declaring the phase complete.
```

## Plan status and estimation

The original 38-week, 13-phase estimate applies only to the pre-restructure culinary scope. Phase 0 and Phase 14 add material Platform Core, Procurement and People work; they must be estimated after the approved hierarchy, launch jurisdiction, integration choices and access-policy catalogue are known. The final table and screen count must be generated from approved migrations and UI inventory rather than estimated in prose. Each Lovable prompt is designed to generate production-quality code incrementally, with a review gate before the next phase.

The original 22 major prompts across Phases 1–12 are supplemented by the Phase 13 prompt. Run prompts in sequence, verify output and acceptance evidence before proceeding, and do not begin full deployment until the Deployment Readiness Gate passes.

## End of Document 6
