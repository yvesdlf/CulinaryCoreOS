# DOCUMENT 4: UI/UX SPECIFICATION

> **Status: original design intent, captured 2026-07-26.**
> Written before implementation began and not revised since. The build has
> since diverged in places — currency is IDR with Indonesian PPN rather than
> AED with VAT, and the schema has gained multi-tenancy and row level security.
> Treat this as the reasoning behind the design, not a description of what
> currently exists. `docs/PROGRESS.md` is the living record of what is built.


## CulinaryCore -- Recipe & Hospitality Management Platform

**Version:** 1.0.0
**Classification:** Internal -- Commercial Product
**Last Updated:** 2026-07-25

---

## Table of Contents

1. [Design Philosophy & Principles](#1-design-philosophy--principles)
2. [Design System Foundation](#2-design-system-foundation)
3. [Typography](#3-typography)
4. [Color System](#4-color-system)
5. [Spacing & Layout Grid](#5-spacing--layout-grid)
6. [Iconography & Imagery](#6-iconography--imagery)
7. [Responsive Breakpoints & Platform Targets](#7-responsive-breakpoints--platform-targets)
8. [Navigation & Application Shell](#8-navigation--application-shell)
9. [Authentication & Onboarding](#9-authentication--onboarding)
10. [Dashboard Views](#10-dashboard-views)
11. [Recipe Management](#11-recipe-management)
12. [Sub Recipe Management](#12-sub-recipe-management)
13. [Product / Ingredient Management](#13-product--ingredient-management)
14. [Supplier Management](#14-supplier-management)
15. [Menu Builder](#15-menu-builder)
16. [Cost Analysis](#16-cost-analysis)
17. [Inventory](#17-inventory)
18. [Production](#18-production)
19. [Reports & Analytics](#19-reports--analytics)
20. [AI Assistant](#20-ai-assistant)
21. [Settings & Administration](#21-settings--administration)
22. [Version History & Audit](#22-version-history--audit)
23. [Special Modes](#23-special-modes)
24. [Platform-Specific Designs](#24-platform-specific-designs)
25. [Keyboard Shortcuts Reference](#25-keyboard-shortcuts-reference)
26. [Accessibility Specification](#26-accessibility-specification)
27. [Animation & Motion](#27-animation--motion)
28. [Error States & Empty States](#28-error-states--empty-states)

---

## 1. Design Philosophy & Principles

> **Authority note:** The CulinaryCoreOS Platform Standards Manual (CPSM) is the authoritative source for design tokens, colour semantics, typography, accessibility and platform behaviour. Where this specification contains an older or conflicting visual value, the CPSM prevails. New Platform Core, Supply Chain and People screens must use the CPSM without exception.

### 1.1 Core Philosophy

CulinaryCore is designed for chefs, not accountants. Every interface decision prioritizes speed, clarity, and professional-grade aesthetics. The application must feel as refined as the cuisine it manages -- a precision instrument that disappears into the workflow.

### 1.2 Design Principles

**P1 -- Speed Above All**
Every primary action is reachable within two interactions. Data entry flows are optimized for keyboard-first input with zero-friction auto-lookup. No modal should require more than one confirmation step.

**P2 -- Professional Minimalism**
Remove everything that does not serve the current task. Dense information displays use hierarchy and whitespace rather than decoration. Every pixel earns its place.

**P3 -- Context Preservation**
Users never lose their place. Navigation maintains scroll position. Editing states persist across tab switches. The system remembers where you were and what you were doing.

**P4 -- Progressive Disclosure**
Show the 20% of controls used 80% of the time. Advanced features surface through deliberate interaction -- menus, panels, command palette -- never cluttering the primary view.

**P5 -- Platform Authenticity**
On macOS, feel like a native Mac app. On iPadOS, feel like it was built for iPad. On iOS, feel like a premium iPhone app. Never force desktop paradigms onto touch devices or vice versa.

**P6 -- Kitchen Durability**
Interfaces used in kitchens must withstand grease, water, heat, and stress. Large touch targets, high contrast, forgiving gestures, and no accidental-delete paths.

**P7 -- Offline Confidence**
Users must always know whether they are online or offline, and must always be able to continue working. Sync state is visible but unobtrusive.

### 1.3 Design Language

The visual language draws from three sources:

- **Apple Human Interface Guidelines**: SF Pro typography, system-native controls, vibrancy/translucency, platform conventions
- **Professional Kitchen Equipment**: Stainless steel metaphor -- clean surfaces, precise edges, functional beauty
- **Fine Dining Presentation**: Generous whitespace, typographic hierarchy, restrained color, intentional composition

---

## 2. Design System Foundation

### 2.1 Component Library

Built on **shadcn/ui** with custom theme tokens. All components follow the shadcn/ui architecture (Radix UI primitives + Tailwind CSS styling) with CulinaryCore-specific extensions.

#### Base Components (from shadcn/ui)

| Component | Usage in CulinaryCore |
|---|---|
| Button | Primary actions, toolbar controls, form submission |
| Input | Text entry, numeric entry, search fields |
| Select | Dropdowns for category, supplier, unit selection |
| Combobox | Auto-lookup fields (ingredient search, product search) |
| Dialog | Confirmations, quick-add forms, settings panels |
| Sheet | Side panels (AI assistant, filters, detail views) |
| Table | Recipe ingredient tables, product lists, reports |
| Tabs | Recipe editor sections, dashboard views |
| Card | Dashboard KPIs, recipe cards in grid view |
| Badge | Status indicators, allergen labels, category tags |
| Toast | Success/error notifications, sync status |
| Command | Command palette (Cmd+K) |
| Popover | Inline editing, quick info, color pickers |
| Tooltip | Icon labels, truncated text, help hints |
| Accordion | Settings groups, FAQ, collapsible sections |
| Calendar | Date pickers for reports, production planning |
| Progress | Upload progress, sync progress, batch operations |
| Skeleton | Loading placeholders |
| Switch | Toggle settings, boolean options |
| Slider | Scaling multiplier, portion adjustment |

#### Custom Components (CulinaryCore-specific)

| Component | Purpose |
|---|---|
| IngredientRow | 26-field ingredient entry with auto-lookup, inline editing |
| CostSummary | Real-time cost breakdown panel with configurable formula |
| NutritionPanel | Macro/micro nutrient display with RDA percentages |
| RecipeCard | Grid-view recipe thumbnail with cost/status overlay |
| AllergenBadge | Standardized allergen indicator with icon and color |
| KitchenTimer | Countdown/count-up timer with alarm |
| ScalingSlider | Batch multiplier with linked quantity recalculation |
| FormulaEditor | Drag-and-drop cost formula builder |
| SyncIndicator | Online/offline status with pending change count |
| ProductRow | Spreadsheet-style row with inline editing for all 31 fields |
| MenuSection | Drag-and-drop menu section container |
| VersionDiff | Side-by-side or inline diff view for recipe changes |
| ApprovalBadge | Workflow state indicator with action buttons |
| ChatBubble | AI assistant message with source citations |
| BarcodeOverlay | Camera viewfinder with barcode detection highlight |

### 2.2 Design Tokens

All visual properties are tokenized for theme switching (Light, Dark, Kitchen, Production modes).

```
// Naming convention: --cc-{category}-{property}-{variant}
// Example: --cc-surface-primary, --cc-text-secondary, --cc-border-subtle
```

Token categories:
- `color` -- All color values
- `spacing` -- Margins, padding, gaps
- `radius` -- Border radii
- `shadow` -- Box shadows, elevation
- `font` -- Font families, sizes, weights, line heights
- `motion` -- Durations, easing curves
- `z` -- Z-index layers
- `size` -- Component dimensions, icon sizes

---

## 3. Typography

### 3.1 Type Scale

Following Apple HIG, using SF Pro (system font stack) with fallbacks.

```css
font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text",
             "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
```

| Token | Size | Weight | Line Height | Usage |
|---|---|---|---|---|
| `display-lg` | 34px | 700 | 1.2 | Dashboard headlines, empty states |
| `display-md` | 28px | 700 | 1.25 | Page titles |
| `display-sm` | 22px | 600 | 1.3 | Section headers |
| `title-lg` | 20px | 600 | 1.3 | Card titles, modal headers |
| `title-md` | 17px | 600 | 1.35 | Subsection headers |
| `title-sm` | 15px | 600 | 1.4 | List item titles, table headers |
| `body-lg` | 17px | 400 | 1.5 | Primary body text |
| `body-md` | 15px | 400 | 1.5 | Secondary body text, form labels |
| `body-sm` | 13px | 400 | 1.45 | Captions, helper text, metadata |
| `mono-md` | 15px | 500 | 1.4 | Numeric values, costs, quantities |
| `mono-sm` | 13px | 500 | 1.4 | Table cell numbers, codes |
| `label` | 12px | 500 | 1.3 | Form labels, badges, tags |
| `overline` | 11px | 600 | 1.3 | Section overlines, category labels (uppercase, letter-spaced) |

### 3.2 Numeric Typography

All monetary and quantity values use tabular (monospace) numerals for column alignment in tables. Currency symbol (AED) is set in `body-sm` weight, value in `mono-md` weight.

```
AED 42.50  -- currency symbol lighter, value emphasized
0.750 kg   -- value bold, unit lighter
```

### 3.3 Kitchen Mode Typography

All sizes scale up by 1.5x in Kitchen Mode. Minimum tap-target text is 20px.

---

## 4. Color System

### 4.1 Semantic Color Tokens

Colors are defined semantically (by function, not hue) to support theme switching.

#### Light Mode

| Token | Value | Usage |
|---|---|---|
| `--cc-bg-primary` | `#FFFFFF` | Page background |
| `--cc-bg-secondary` | `#F5F5F7` | Sidebar, card backgrounds |
| `--cc-bg-tertiary` | `#E8E8ED` | Hover states, subtle fills |
| `--cc-bg-elevated` | `#FFFFFF` | Modals, popovers, sheets |
| `--cc-surface-primary` | `#FFFFFF` | Card surfaces, input backgrounds |
| `--cc-surface-secondary` | `#F9F9FB` | Table row alternating, subtle surfaces |
| `--cc-text-primary` | `#1D1D1F` | Primary content text |
| `--cc-text-secondary` | `#6E6E73` | Secondary text, labels, placeholders |
| `--cc-text-tertiary` | `#AEAEB2` | Disabled text, hints |
| `--cc-border-primary` | `#D2D2D7` | Input borders, dividers |
| `--cc-border-secondary` | `#E5E5EA` | Subtle dividers, card borders |
| `--cc-accent-primary` | `#0071E3` | Primary actions, links, focus rings |
| `--cc-accent-hover` | `#0077ED` | Hover state for primary accent |

#### Dark Mode

| Token | Value | Usage |
|---|---|---|
| `--cc-bg-primary` | `#000000` | Page background |
| `--cc-bg-secondary` | `#1C1C1E` | Sidebar, card backgrounds |
| `--cc-bg-tertiary` | `#2C2C2E` | Hover states, subtle fills |
| `--cc-bg-elevated` | `#2C2C2E` | Modals, popovers, sheets |
| `--cc-surface-primary` | `#1C1C1E` | Card surfaces |
| `--cc-surface-secondary` | `#242426` | Table row alternating |
| `--cc-text-primary` | `#F5F5F7` | Primary text |
| `--cc-text-secondary` | `#98989D` | Secondary text |
| `--cc-text-tertiary` | `#636366` | Disabled text |
| `--cc-border-primary` | `#38383A` | Input borders, dividers |
| `--cc-border-secondary` | `#2C2C2E` | Subtle dividers |
| `--cc-accent-primary` | `#0A84FF` | Primary actions (iOS blue, brighter for dark) |
| `--cc-accent-hover` | `#409CFF` | Hover state |

#### Kitchen Mode

| Token | Value | Usage |
|---|---|---|
| `--cc-bg-primary` | `#0A0A0A` | Deep black background (anti-glare) |
| `--cc-bg-secondary` | `#1A1A1A` | Card backgrounds |
| `--cc-text-primary` | `#FFFFFF` | Maximum contrast text |
| `--cc-text-secondary` | `#B0B0B0` | Secondary text |
| `--cc-accent-primary` | `#FF9F0A` | Amber -- high visibility under kitchen lighting |
| `--cc-accent-danger` | `#FF453A` | Alerts, allergens -- bright red |
| `--cc-accent-success` | `#30D158` | Completion, checkmarks |

#### Production Mode

| Token | Value | Usage |
|---|---|---|
| `--cc-bg-primary` | `#F2F2F7` | Light background for readability under fluorescent lighting |
| `--cc-text-primary` | `#000000` | Maximum contrast |
| `--cc-accent-primary` | `#007AFF` | Actions |
| `--cc-accent-progress` | `#FF9500` | In-progress items |
| `--cc-accent-complete` | `#34C759` | Completed items |

### 4.2 Functional Colors

| Function | Light | Dark | Usage |
|---|---|---|---|
| Success | `#34C759` | `#30D158` | Save confirmations, completed status |
| Warning | `#FF9500` | `#FF9F0A` | Price alerts, expiring items |
| Danger | `#FF3B30` | `#FF453A` | Delete actions, allergen alerts, cost overruns |
| Info | `#5AC8FA` | `#64D2FF` | Tips, informational notices |

### 4.3 Category Colors

Each recipe category has an assigned color for visual identification across the interface (cards, tags, filters, charts).

| Category | Color | Hex |
|---|---|---|
| BITES | Coral | `#FF6B6B` |
| SALADS | Green | `#51CF66` |
| COLD | Sky Blue | `#74C0FC` |
| HOT | Orange | `#FFA94D` |
| MAINS | Deep Blue | `#5C7CFA` |
| GRILL | Warm Red | `#E64980` |
| SIDES | Teal | `#38D9A9` |
| BREAD | Wheat | `#D4A574` |
| PIZZA | Tomato Red | `#F06543` |
| DESSERT | Pink | `#DA77F2` |
| KIDS MENU | Yellow | `#FFD43B` |
| HAPPY HOUR | Purple | `#9775FA` |

### 4.4 Status Colors

| Status | Color | Badge Style |
|---|---|---|
| ACTIVE | Green (`#34C759`) | Solid fill |
| Actual | Blue (`#007AFF`) | Solid fill |
| Pending | Amber (`#FF9500`) | Outline |
| Update | Orange (`#FF6B00`) | Outline, pulsing dot |
| NEW | Purple (`#AF52DE`) | Solid fill |

### 4.5 Allergen Colors

All 14 major allergens have distinct colors and icons for unambiguous identification:

| Allergen | Icon | Color |
|---|---|---|
| Gluten | Wheat stalk | `#D4A574` |
| Crustaceans | Shrimp | `#FF6B6B` |
| Eggs | Egg | `#FFD43B` |
| Fish | Fish | `#74C0FC` |
| Peanuts | Peanut | `#C68642` |
| Soybeans | Bean pod | `#8BC34A` |
| Milk | Milk drop | `#E3F2FD` border `#90CAF9` |
| Tree Nuts | Nut | `#A1887F` |
| Celery | Celery stalk | `#66BB6A` |
| Mustard | Mustard jar | `#FBC02D` |
| Sesame | Seeds | `#D7CCC8` border `#A1887F` |
| Sulphites | SO2 text | `#CE93D8` |
| Lupin | Flower | `#7E57C2` |
| Molluscs | Shell | `#4DB6AC` |

---

## 5. Spacing & Layout Grid

### 5.1 Spacing Scale

Based on a 4px base unit, following Apple HIG conventions:

| Token | Value | Usage |
|---|---|---|
| `space-0` | 0px | No spacing |
| `space-1` | 4px | Tight inline spacing, icon padding |
| `space-2` | 8px | Compact element spacing |
| `space-3` | 12px | Standard element spacing |
| `space-4` | 16px | Standard section padding |
| `space-5` | 20px | Medium section spacing |
| `space-6` | 24px | Large section spacing |
| `space-8` | 32px | Section dividers |
| `space-10` | 40px | Page section spacing |
| `space-12` | 48px | Major section spacing |
| `space-16` | 64px | Page margins on large screens |

### 5.2 Layout Grid

**Desktop (macOS/Web > 1280px)**
- 12-column grid
- Column gutter: 24px
- Page margin: 64px (or sidebar width)
- Content max-width: 1440px
- Sidebar width: 260px (collapsed: 64px)

**Tablet (iPadOS 768px -- 1279px)**
- 8-column grid
- Column gutter: 20px
- Page margin: 24px
- Sidebar: overlay or split view (320px)

**Mobile (iOS < 768px)**
- 4-column grid
- Column gutter: 16px
- Page margin: 16px
- No persistent sidebar (bottom tab bar navigation)

### 5.3 Component Spacing Rules

- **Card padding**: 16px (mobile), 20px (tablet), 24px (desktop)
- **Table cell padding**: 8px vertical, 12px horizontal
- **Form field spacing**: 16px between fields, 24px between groups
- **Button spacing**: 8px between adjacent buttons
- **Toolbar height**: 44px (mobile/tablet touch), 36px (desktop)
- **Sidebar item height**: 36px (desktop), 44px (touch)
- **Minimum touch target**: 44x44 points (Apple HIG requirement)
- **Kitchen Mode minimum touch target**: 64x64 points

---

## 6. Iconography & Imagery

### 6.1 Icon System

Primary icon set: **SF Symbols** (Apple) with fallback to **Lucide Icons** (open source, used by shadcn/ui).

| Context | Icon Source | Size |
|---|---|---|
| Navigation | SF Symbols / Lucide | 20px (desktop), 24px (touch) |
| Toolbar actions | SF Symbols / Lucide | 16px (desktop), 20px (touch) |
| Inline indicators | SF Symbols / Lucide | 14px |
| Status badges | Custom SVG | 8px dot, 12px icon |
| Allergen icons | Custom SVG set | 16px (inline), 24px (badge), 32px (detail) |
| Empty states | Custom illustrations | 120--200px |
| Kitchen Mode | SF Symbols / Lucide | 28--32px (all icons scale up) |

### 6.2 Recipe Imagery

- **Thumbnail**: 1:1 aspect ratio, 80x80px (list), 200x200px (grid card)
- **Hero image**: 16:9 aspect ratio, max-width 800px
- **Step photos**: 4:3 aspect ratio, max-width 600px
- **Placeholder**: Gradient with category color + utensil icon
- **Format**: WebP with JPEG fallback, lazy loaded
- **Max file size**: 2MB (auto-compressed on upload)

---

## 7. Responsive Breakpoints & Platform Targets

### 7.1 Breakpoint Definitions

| Breakpoint | Width | Target |
|---|---|---|
| `xs` | < 390px | iPhone SE, small phones |
| `sm` | 390px -- 767px | Standard iPhone |
| `md` | 768px -- 1023px | iPad portrait, small tablets |
| `lg` | 1024px -- 1279px | iPad landscape, small laptops |
| `xl` | 1280px -- 1535px | Standard desktop, MacBook |
| `2xl` | >= 1536px | Large desktop, external monitors |

### 7.2 Platform-Specific Considerations

| Platform | Primary Input | Layout Strategy | Key Constraint |
|---|---|---|---|
| macOS Web/App | Keyboard + Mouse | Multi-column, dense tables | Spreadsheet-speed editing |
| iPadOS | Touch + Apple Pencil | Adaptive columns, large targets | Kitchen environment (wet hands, heat) |
| iOS | Touch (thumb zone) | Single column, bottom nav | Quick lookup, one-hand use |

### 7.3 Orientation Support

- **macOS**: Landscape only (standard desktop)
- **iPadOS**: Landscape (primary for kitchen display) + Portrait (recipe reading, inventory)
- **iOS**: Portrait (primary) + Landscape (data tables, barcode scanning)

---

## 8. Navigation & Application Shell

### 8.1 Application Shell Structure

#### Desktop Layout (macOS / Web >= 1024px)

```
+-----------------------------------------------------------+
|  Traffic Lights  |  Drag Region / Title Bar  |  Controls  |
+-----------------------------------------------------------+
|          |                                    |            |
| Sidebar  |  Main Content Area                | Side Panel |
| 260px    |  (dynamic width)                  | (optional) |
|          |                                    | 360px      |
| [Logo]   |  +------------------------------+ |            |
| [Search] |  | Toolbar / Breadcrumbs        | |  AI Chat   |
| [Nav]    |  +------------------------------+ |  Details   |
|          |  |                              | |  Filters   |
|          |  | Content                      | |            |
|          |  |                              | |            |
|          |  |                              | |            |
|          |  +------------------------------+ |            |
|          |  | Status Bar (sync, user, mode)| |            |
+-----------------------------------------------------------+
```

**Components:**

- **Title Bar**: Native macOS traffic lights (close/minimize/maximize), draggable region, app title with current context. On web: custom title bar matching macOS style.
- **Sidebar (260px, collapsible to 64px)**:
  - Organization logo/name (top)
  - Search field (Cmd+K trigger)
  - Navigation groups with section headers
  - Collapse/expand toggle
  - User avatar + role badge (bottom)
  - Sync status indicator (bottom)
- **Main Content Area**: Dynamic width, scrollable, contextual toolbar at top
- **Side Panel (360px, optional)**: AI assistant, detail views, filter panels. Slides in from right.
- **Status Bar (optional, bottom)**: Sync status, current mode indicator, keyboard shortcut hints

#### Tablet Layout (iPadOS 768px -- 1023px)

```
+-------------------------------------------+
|  Status Bar (system)                       |
+-------------------------------------------+
|  Navigation Bar (title, back, actions)     |
+-------------------------------------------+
|                                            |
|  Content Area (full width)                 |
|                                            |
|                                            |
+-------------------------------------------+
|  Tab Bar (5 primary destinations)          |
+-------------------------------------------+
```

- **Navigation Bar**: Back button, title, action buttons (max 3). Follows iOS navigation conventions.
- **Tab Bar**: 5 primary tabs (Dashboard, Recipes, Products, Production, More)
- **Sidebar**: Accessible via swipe-from-left or menu button in landscape mode. In Split View or Stage Manager, sidebar can be pinned.
- **Side Panel**: Sheet presentation (bottom sheet or side sheet in landscape)

#### Mobile Layout (iOS < 768px)

```
+---------------------------+
|  Status Bar (system)      |
+---------------------------+
|  Nav Bar (title, actions) |
+---------------------------+
|                           |
|  Content (full width)     |
|  Single column            |
|                           |
+---------------------------+
|  Tab Bar                  |
+---------------------------+
```

- **Tab Bar**: 5 tabs with SF Symbol icons and labels
- **Navigation**: Stack-based (push/pop), swipe-back gesture
- **Action sheets**: Bottom-presented for destructive or multi-option actions

### 8.2 Sidebar Navigation Structure

```
CULINARYCORE [logo]
[Search...] (Cmd+K)

OVERVIEW
  Dashboard
  Notifications (badge count)

RECIPES
  All Recipes
  Sub Recipes
  Categories
  Allergen Matrix

MENU
  Menu Builder
  Menu Engineering

PRODUCTS
  Product List
  Suppliers
  Import

OPERATIONS
  Production
  Inventory
  Waste Log

ANALYTICS
  Reports
  Cost Analysis
  Menu Performance

SETTINGS (bottom-pinned)
  Settings
  Help & Support
```

**Sidebar Behavior:**
- Collapsible to icon-only mode (64px) via toggle or Cmd+\
- Sections are collapsible (state persists)
- Active item highlighted with accent color left border
- Hover reveals tooltip for collapsed items
- Badge counts for notifications, pending approvals
- Right-click on nav item shows contextual menu (New Recipe, Recent, Favorites)
- Drag-and-drop reordering of favorites (pinned section)

### 8.3 Command Palette (Cmd+K)

**Purpose:** Universal quick access to any action, page, or entity in the system.

**Activation:** Cmd+K (macOS), Ctrl+K (web), or tap search field in sidebar.

**Layout:**
```
+-------------------------------------------+
| [Search icon] Search CulinaryCore...      |
+-------------------------------------------+
| RECENT                                    |
|   Caesar Salad (Recipe)                   |
|   Product List (Page)                     |
|   John Doe (Supplier)                     |
+-------------------------------------------+
| QUICK ACTIONS                             |
|   New Recipe                    Cmd+N     |
|   New Sub Recipe                Cmd+Shift+N|
|   Import Products               --        |
|   Generate Report                --        |
+-------------------------------------------+
| NAVIGATION                               |
|   Dashboard                     Cmd+1     |
|   Recipes                       Cmd+2     |
|   Products                      Cmd+3     |
+-------------------------------------------+
```

**Behavior:**
- Opens centered modal overlay with backdrop blur
- Type-ahead search across recipes, sub recipes, products, suppliers, pages, actions
- Results grouped by type with icons
- Keyboard navigation: Arrow keys to browse, Enter to select, Esc to dismiss
- Fuzzy matching (e.g., "csr sld" matches "Caesar Salad")
- Results show entity type icon, name, and metadata (category, cost, status)
- Recent items shown when search is empty
- Max 10 results per group, scroll for more

**State Management:**
- Recent searches persisted per user (last 20)
- Frequently accessed items promoted to top
- Search is debounced (150ms)

**Accessibility:**
- Role: `dialog` with `aria-label="Command palette"`
- Search input: `role="combobox"` with `aria-expanded`, `aria-activedescendant`
- Results: `role="listbox"` with `role="option"` items
- Announced: "X results found" on search update

### 8.4 Global Search

**Purpose:** Deep search across all entities with filters, available from sidebar search field or Command Palette.

**Layout (Desktop):**

Full-page search results view with filter sidebar:

```
+-----------------------------------------------------------+
| Sidebar | [Search field: "chicken"]                       |
|         | Filters: [All] [Recipes] [Products] [Suppliers]  |
|         +--------------------------------------------------+
|         | 47 results for "chicken"                         |
|         |                                                  |
|         | RECIPES (12)                                     |
|         |  Grilled Chicken Breast -- MAINS, AED 45.00     |
|         |  Chicken Caesar Salad -- SALADS, AED 38.00      |
|         |  ...                                             |
|         |                                                  |
|         | PRODUCTS (28)                                    |
|         |  Chicken Breast Fillet -- Bidfood, AED 32.50/kg |
|         |  ...                                             |
|         |                                                  |
|         | SUB RECIPES (5)                                  |
|         |  Chicken Stock -- AED 2.10/L                    |
|         |  ...                                             |
|         |                                                  |
|         | SUPPLIERS (2)                                    |
|         |  Al Rawabi Poultry                               |
|         |  ...                                             |
+-----------------------------------------------------------+
```

**Behavior:**
- Real-time results as user types (debounced 200ms)
- Results grouped by entity type with counts
- Each result shows: icon, name, key metadata (category, cost, supplier)
- Click result to navigate to entity detail
- Cmd+Enter opens in new tab/window
- Filter pills at top to narrow by type
- Sort options: Relevance, Name A-Z, Recently Modified

**Keyboard Shortcuts:**
- `/` -- Focus search from anywhere
- `Esc` -- Clear search / exit search view
- Arrow Up/Down -- Navigate results
- `Enter` -- Open selected result
- `Cmd+Enter` -- Open in new tab

### 8.5 Notification Center

**Purpose:** Centralized feed of system events, approvals, alerts, and updates.

**Activation:** Bell icon in sidebar (desktop) or tab bar (mobile). Badge shows unread count.

**Layout (Desktop -- Sheet from Right):**

```
+------------------------------------------+
| Notifications                   [Mark All]|
+------------------------------------------+
| [All] [Approvals] [Alerts] [Updates]     |
+------------------------------------------+
| TODAY                                     |
|                                           |
| [!] Price Alert: Salmon increased 15%     |
|     2 minutes ago                         |
|                                           |
| [v] Recipe Approved: Wagyu Tartare       |
|     Ahmed approved -- 1 hour ago          |
|                                           |
| YESTERDAY                                 |
|                                           |
| [i] 3 products updated by supplier sync  |
|     Yesterday at 14:30                    |
+------------------------------------------+
```

**Notification Types:**
- **Approvals**: Recipe submitted for review, approved, rejected
- **Price Alerts**: Ingredient cost change exceeding threshold
- **System**: Sync completed, import finished, export ready
- **Production**: Prep list assigned, task overdue
- **Inventory**: Low stock alert, count discrepancy

**Behavior:**
- Real-time push (WebSocket) on desktop/tablet; push notification on iOS
- Swipe left to archive (touch devices)
- Click to navigate to relevant entity
- Filter by type via segmented control
- Group by date (Today, Yesterday, This Week, Earlier)
- Mark all as read button
- Settings link to configure notification preferences

### 8.6 User Menu

**Location:** Bottom of sidebar (desktop), within "More" tab (mobile).

**Content:**
```
+---------------------------+
| [Avatar] Yves de la F.    |
| Executive Chef            |
+---------------------------+
| My Profile                |
| Preferences               |
| Switch Organization       |
+---------------------------+
| Appearance: [Auto/L/D/K]  |
| Kitchen Mode              |
+---------------------------+
| Help & Support             |
| Keyboard Shortcuts         |
+---------------------------+
| Sign Out                   |
+---------------------------+
```

**Behavior:**
- Popover on desktop (click avatar)
- Full-screen menu on mobile
- Appearance toggle switches between Light/Dark/Kitchen/Auto
- Organization switcher shows list of accessible organizations
- Profile shows user details and role

---

## 9. Authentication & Onboarding

### 9.1 Login Screen

**Purpose:** Authenticate returning users with minimal friction.

**Layout (All Platforms):**

Centered card on a full-bleed background (subtle gradient using brand colors or a high-quality culinary photograph, dimmed).

```
+-----------------------------------------------+
|                                               |
|           [CulinaryCore Logo]                 |
|           Recipe & Cost Management             |
|                                               |
|  +---------------------------------------+    |
|  |                                       |    |
|  |  [Apple icon] Continue with Apple     |    |
|  |                                       |    |
|  |  ---- or ----                         |    |
|  |                                       |    |
|  |  Email                                |    |
|  |  [________________________]           |    |
|  |                                       |    |
|  |  Password                             |    |
|  |  [________________________] [show]    |    |
|  |                                       |    |
|  |  [Remember me]     Forgot password?   |    |
|  |                                       |    |
|  |  [      Sign In      ]               |    |
|  |                                       |    |
|  |  Don't have an account? Register      |    |
|  |                                       |    |
|  +---------------------------------------+    |
|                                               |
|           (c) 2026 CulinaryCore               |
+-----------------------------------------------+
```

**Components:**
- Logo and tagline (centered, above card)
- Sign in with Apple button (top priority per Apple HIG -- dark button, full width)
- Divider with "or" text
- Email input (`type="email"`, autocomplete="email")
- Password input (`type="password"`, show/hide toggle, autocomplete="current-password")
- Remember me checkbox
- Forgot password link
- Sign In primary button (full width)
- Registration link

**Interaction Patterns:**
- Tab order: Apple Sign-In > Email > Password > Remember Me > Sign In > Forgot Password > Register
- Enter key submits form
- Invalid email shows inline validation after blur
- Wrong credentials show toast error: "Invalid email or password"
- Rate limiting: 5 attempts, then 30-second cooldown with countdown
- Face ID / Touch ID prompt on iOS/macOS if previously authenticated

**State Management:**
- `isLoading` -- Shows spinner on Sign In button, disables form
- `error` -- Error message string, displayed as banner above form
- `rememberMe` -- Persists email in local storage

**iPadOS/iOS Specific:**
- Face ID button appears if biometric is enrolled and user has previously signed in
- Layout adjusts for keyboard appearance (card scrolls up)
- Apple Sign-In uses native AuthenticationServices framework

**Keyboard Shortcuts:**
- `Enter` -- Submit form
- `Tab` / `Shift+Tab` -- Navigate fields
- `Cmd+Backspace` -- Clear field (macOS)

**Accessibility:**
- `aria-label="Sign in to CulinaryCore"` on form
- Error messages linked via `aria-describedby`
- Focus trapped within login card
- High contrast mode support
- Screen reader: "Sign in form. Email field. Password field. Sign in button."

### 9.2 Registration Screen

**Purpose:** Create a new user account with organization association.

**Layout:**

Similar centered card layout to Login, but taller with additional fields.

```
+-----------------------------------------------+
|           [CulinaryCore Logo]                 |
|                                               |
|  +---------------------------------------+    |
|  |  Create Your Account                  |    |
|  |                                       |    |
|  |  [Apple icon] Continue with Apple     |    |
|  |                                       |    |
|  |  ---- or ----                         |    |
|  |                                       |    |
|  |  Full Name                            |    |
|  |  [________________________]           |    |
|  |                                       |    |
|  |  Email                                |    |
|  |  [________________________]           |    |
|  |                                       |    |
|  |  Password                             |    |
|  |  [________________________]           |    |
|  |  [strength meter: ||||____]           |    |
|  |  Must be 8+ characters               |    |
|  |                                       |    |
|  |  Organization                         |    |
|  |  [Join existing v] or [Create new]    |    |
|  |                                       |    |
|  |  Invitation Code (if joining)         |    |
|  |  [________________________]           |    |
|  |                                       |    |
|  |  [      Create Account      ]         |    |
|  |                                       |    |
|  |  Already have an account? Sign in     |    |
|  +---------------------------------------+    |
+-----------------------------------------------+
```

**Components:**
- Apple Sign-In (top priority)
- Full Name input
- Email input with real-time availability check
- Password input with strength meter (4 segments: Weak, Fair, Good, Strong)
- Organization toggle: "Join existing" or "Create new"
  - Join: Invitation code field
  - Create: Leads to Organization Setup (next screen)
- Terms & Privacy checkbox (link to docs)
- Create Account button
- Sign In link

**Validation:**
- Name: Required, min 2 characters
- Email: Required, valid format, not already registered (async check on blur)
- Password: Min 8 chars, strength meter updates on keypress, requirements listed below field
- Invitation code: 6-character alphanumeric, validated on blur

### 9.3 Organization Setup

**Purpose:** Configure a new organization during first registration.

**Layout:** Multi-step wizard (4 steps) with progress indicator.

**Step 1 -- Organization Details:**
```
Step 1 of 4: Organization Details

  Organization Name
  [________________________]

  Type
  [Restaurant v] [Hotel] [Catering] [Group]

  Number of Outlets
  [1-5 v]

  Primary Currency
  [AED - UAE Dirham v]

  Country
  [United Arab Emirates v]

  [Continue ->]
```

**Step 2 -- Team Setup:**
```
Step 2 of 4: Invite Your Team

  Invite team members (optional, can do later)

  [Email________________] [Role: Chef v]  [+ Add]

  Invited:
    sarah@restaurant.com -- Sous Chef    [x]
    ahmed@restaurant.com -- Manager      [x]

  [<- Back]  [Continue ->]  [Skip for now]
```

**Step 3 -- Cost Configuration:**
```
Step 3 of 4: Cost Formula

  How do you calculate food cost?

  ( ) Simple: Food Cost = Ingredient Cost
  (x) Standard: Food Cost = Ingredient Cost + Waste + Sub Recipe Overhead
  ( ) Custom: I'll configure my own formula

  Default Target Food Cost %
  [30___] %

  Default VAT Rate
  [5____] %

  [<- Back]  [Continue ->]
```

**Step 4 -- Data Import:**
```
Step 4 of 4: Import Data (Optional)

  Start with your existing data:

  [Upload icon] Drop Excel/CSV file here
  or click to browse

  Supported: .xlsx, .csv, .json
  We'll map your columns automatically

  [<- Back]  [Get Started]  [Skip for now]
```

**Behavior:**
- Progress bar at top shows current step (1/4, 2/4, etc.)
- Back button available from step 2 onward
- Skip available for optional steps (team, import)
- Organization name checked for uniqueness
- Currency selection sets default for all monetary displays
- Cost formula selection pre-configures the formula builder

### 9.4 First-Run Wizard

**Purpose:** Orient new users after account creation. Shown once on first login.

**Layout:** Full-screen overlay with spotlighting, sequential.

**Steps:**
1. **Welcome**: "Welcome to CulinaryCore. Let's take a quick tour." [Start Tour] [Skip]
2. **Dashboard**: Spotlight on dashboard area. "This is your command center. See costs, recipes, and alerts at a glance."
3. **Recipe Creation**: Spotlight on "New Recipe" button. "Create your first recipe. Start from scratch or import from a file."
4. **Product List**: Spotlight on Products nav. "Your ingredient database. Import your product list or add items as you go."
5. **Command Palette**: "Press Cmd+K anytime to search, navigate, or take action."
6. **AI Assistant**: Spotlight on AI icon. "Your AI sous chef. Import recipes from photos, get cost suggestions, and more."
7. **Complete**: "You're ready to cook. Need help? Press ? anytime." [Start Cooking]

**Behavior:**
- Overlay dims all content except spotlighted area
- Tooltip-style callout with text and Next/Skip buttons
- Can be dismissed at any step
- "Show again" option in Help menu
- Progress dots at bottom

---

## 10. Dashboard Views

### 10.1 Management Dashboard

**Purpose:** Executive overview of cost performance, recipe portfolio health, and operational KPIs. Primary view for Executive Chef and Restaurant Manager.

**Layout (Desktop):**

```
+-----------------------------------------------------------+
| Sidebar | Management Dashboard                  [Date Range v] [Export] |
|         +--------------------------------------------------+
|         | KPI CARDS (4-column grid)                         |
|         | [Total Food Cost %] [Avg Recipe Cost] [Active     |
|         |  28.4% (-1.2%)      AED 32.50        Recipes: 147|
|         |  vs target 30%]     (+3.5% MoM)]     +12 new]    |
|         |                                                  |
|         | [Price Alerts]                                    |
|         |  5 items above                                   |
|         |  threshold]                                      |
|         +--------------------------------------------------+
|         | CHARTS (2-column)                                 |
|         | +----------------------+ +----------------------+ |
|         | | Food Cost Trend      | | Cost by Category     | |
|         | | (Line chart, 12mo)   | | (Horizontal bar)     | |
|         | +----------------------+ +----------------------+ |
|         +--------------------------------------------------+
|         | TOP/BOTTOM RECIPES (2-column)                     |
|         | +----------------------+ +----------------------+ |
|         | | Most Profitable      | | Cost Alert Recipes   | |
|         | | 1. Wagyu Tartare     | | 1. Lobster Bisque    | |
|         | | 2. Caesar Salad      | |    FC: 38% (>30%)    | |
|         | | ...                  | | ...                  | |
|         | +----------------------+ +----------------------+ |
|         +--------------------------------------------------+
|         | RECENT ACTIVITY                                   |
|         | - Ahmed updated "Grilled Salmon" (2 min ago)      |
|         | - Sarah added new recipe "Mango Sorbet" (1 hr)    |
|         | - Price alert: Wagyu beef +22% (3 hr)             |
+-----------------------------------------------------------+
```

**Component Inventory:**

1. **Date Range Selector** (top right)
   - Presets: Today, This Week, This Month, This Quarter, YTD, Last 12 Months, Custom
   - Custom: Calendar date picker with range selection
   - Persists across dashboard tabs

2. **KPI Cards** (4-column grid, responsive to 2x2 on tablet, stack on mobile)
   - Each card: Title, primary value (large `mono-md`), trend indicator (up/down arrow + percentage), comparison text
   - Cards:
     - **Total Food Cost %**: Current weighted average food cost. Green if below target, red if above.
     - **Average Recipe Cost**: Mean cost across all active recipes. MoM trend.
     - **Active Recipes**: Count of recipes with ACTIVE status. Badge showing new additions.
     - **Price Alerts**: Count of ingredients with price changes above threshold. Tap to see list.
   - Click any card to drill down to filtered detail view

3. **Food Cost Trend Chart** (line chart)
   - X-axis: Time (months)
   - Y-axis: Food Cost %
   - Lines: Actual FC%, Target FC% (dashed)
   - Hover tooltip shows exact value and date
   - Click data point to see contributing recipes

4. **Cost by Category Chart** (horizontal bar)
   - Categories (BITES, SALADS, etc.) on Y-axis
   - Average food cost % on X-axis
   - Bars colored by category color
   - Target line overlay
   - Click bar to filter to category

5. **Most Profitable Recipes** (ranked list)
   - Top 10 recipes by margin (AED)
   - Columns: Rank, Name, Category (badge), Margin (AED), Food Cost %
   - Click row to open recipe

6. **Cost Alert Recipes** (ranked list)
   - Recipes exceeding target food cost %
   - Sorted by overage (highest first)
   - Columns: Name, Current FC%, Target FC%, Overage, Last Updated
   - Red highlight for > 5% over target
   - Click row to open recipe cost analysis

7. **Recent Activity Feed**
   - Chronological list of system events
   - Each item: Icon (type), Description, Actor, Timestamp
   - Types: Recipe created/updated/approved, Product price change, Import completed, User action
   - Click to navigate to relevant entity
   - "View All" link to Activity Log

**Interaction Patterns:**
- Drag to rearrange dashboard widgets (desktop only)
- Double-click KPI card to set custom target
- Right-click chart for export options (PNG, CSV)
- Pull-to-refresh on mobile/tablet

**State Management:**
- `dateRange` -- Selected time period (persisted per user)
- `kpiData` -- Fetched KPI values with loading/error states
- `chartData` -- Time series data for charts
- `recentActivity` -- Paginated activity feed
- `isRefreshing` -- Pull-to-refresh state

**Keyboard Shortcuts:**
- `1` -- Focus KPI cards
- `2` -- Focus charts
- `R` -- Refresh dashboard data
- `E` -- Export dashboard as PDF

**Accessibility:**
- KPI cards are `role="status"` with `aria-live="polite"` for value updates
- Charts include `aria-label` with textual summary (e.g., "Food cost trend chart showing 28.4% in July, down from 29.6% in June")
- Data tables within charts accessible via keyboard
- Color is never the only differentiator (icons/patterns accompany colors)

### 10.2 Chef Dashboard

**Purpose:** Operational view for chefs focused on today's production, pending tasks, and recipe workflow.

**Layout (Desktop):**

```
+-----------------------------------------------------------+
| Sidebar | Chef Dashboard                        Good morning, Chef |
|         +--------------------------------------------------+
|         | TODAY'S OVERVIEW                                  |
|         | [Production Tasks] [Recipes to Review] [My Recent |
|         |  12 items           3 pending          Edits: 7]  |
|         +--------------------------------------------------+
|         | TODAY'S PRODUCTION (left 60%)   | PENDING REVIEWS  |
|         | +------------------------------+ (right 40%)      |
|         | | Prep List                    | +---------------+|
|         | | [ ] Chicken Stock (5L batch) | | Wagyu Tartare ||
|         | | [x] Caesar Dressing (2L)     | | by Ahmed      ||
|         | | [ ] Pizza Dough (10 batches) | | [Review]      ||
|         | | [ ] Mango Puree (3L)         | |               ||
|         | | ...                          | | Grilled Salmon||
|         | +------------------------------+ | by Sarah      ||
|         |                                  | [Review]      ||
|         | MY RECENT RECIPES                | +---------------+|
|         | [Card] [Card] [Card] [Card]                       |
|         | (Horizontal scroll)                               |
|         +--------------------------------------------------+
|         | QUICK ACTIONS                                     |
|         | [+ New Recipe] [Import Recipe] [Start Timer]      |
+-----------------------------------------------------------+
```

**Components:**

1. **Greeting Header**: Time-aware greeting ("Good morning, Chef"), current date, weather (optional integration)

2. **Quick Stats Row** (3 cards):
   - Production Tasks: Count of today's assigned prep tasks. Tap to view production list.
   - Recipes to Review: Count of recipes pending this user's approval. Badge on sidebar.
   - My Recent Edits: Recipes modified by current user in last 7 days.

3. **Today's Production Panel**:
   - Checklist of prep tasks assigned for today
   - Each item: Checkbox, recipe/sub recipe name, batch quantity, estimated time
   - Checked items move to bottom with strikethrough
   - Progress bar at top (e.g., "4/12 tasks complete")
   - "View Full Production Plan" link

4. **Pending Reviews Panel**:
   - Stack of recipe cards awaiting approval
   - Each card: Recipe name, author, category, date submitted
   - "Review" button opens recipe in review mode
   - "Approve" / "Request Changes" quick actions

5. **My Recent Recipes** (horizontal card scroll):
   - Last 8 recipes edited by current user
   - Each card: Thumbnail, name, category badge, last modified date, status badge
   - Click to open in editor

6. **Quick Actions Bar** (bottom):
   - New Recipe (Cmd+N)
   - Import Recipe (opens AI import wizard)
   - Start Timer (opens kitchen timer)

### 10.3 Purchasing Dashboard

**Purpose:** Procurement-focused view showing pending orders, price movements, and supplier status.

**Layout (Desktop):**

```
+-----------------------------------------------------------+
| Sidebar | Purchasing Dashboard                  [Date Range] |
|         +--------------------------------------------------+
|         | KPI CARDS                                         |
|         | [Total Spend MTD] [Price Alerts] [Pending Orders] |
|         |  AED 45,200       8 items       3 orders         |
|         +--------------------------------------------------+
|         | PRICE MOVEMENT (full width chart)                 |
|         | [Line chart: Top 10 volatile ingredients]         |
|         +--------------------------------------------------+
|         | ALERTS             | SUPPLIER STATUS              |
|         | Salmon +15%        | Bidfood: Active, 47 products |
|         | Wagyu +22%         | Barakat: Active, 23 products |
|         | Olive Oil -8%      | ...                          |
|         +--------------------------------------------------+
```

**Components:**

1. **KPI Cards**: Total spend MTD, Active price alerts, Pending purchase orders, Inventory value

2. **Price Movement Chart**: Multi-line chart showing price trends for most volatile ingredients. Selectable time range. Toggle individual ingredient lines on/off.

3. **Active Alerts Table**: Ingredients with recent price changes exceeding configurable threshold (default 10%). Columns: Product, Supplier, Old Price, New Price, % Change, Date, Affected Recipes count. Click row to see impact analysis.

4. **Supplier Status List**: Active suppliers with product counts, last order date, and status indicator. Click to open supplier detail.

### 10.4 Admin Dashboard

**Purpose:** System health, user activity, and audit overview for administrators.

**Layout (Desktop):**

```
+-----------------------------------------------------------+
| Sidebar | Admin Dashboard                                   |
|         +--------------------------------------------------+
|         | SYSTEM HEALTH                                     |
|         | [Storage Used] [API Calls] [Active Users] [Sync]  |
|         |  2.4GB / 10GB  12,450/mo   8 online     OK       |
|         +--------------------------------------------------+
|         | USER ACTIVITY (left)     | AUDIT LOG (right)      |
|         | [Bar chart: actions/day] | [Timeline of events]   |
|         +--------------------------------------------------+
|         | RECENT USERS                                      |
|         | Name, Role, Last Active, Actions (7d)             |
+-----------------------------------------------------------+
```

**Components:**

1. **System Health Cards**: Storage usage (progress bar), API usage, Active users (now), Sync status
2. **User Activity Chart**: Bar chart showing daily actions per user over the last 30 days
3. **Audit Log**: Chronological list of all system events with filters (user, action type, date range)
4. **User Table**: All users with role, last active timestamp, action count

---

## 11. Recipe Management

### 11.1 Recipe List

**Purpose:** Browse, search, filter, and manage the complete recipe catalog. Primary landing page for the Recipes section.

**Layout (Desktop):**

```
+-----------------------------------------------------------+
| Sidebar | Recipes (147)                [Grid|List] [+ New Recipe] |
|         +--------------------------------------------------+
|         | [Search...] [Category v] [Status v] [Allergens v] |
|         | [Cost Range: AED 0-100] [Sort: Name A-Z v]       |
|         +--------------------------------------------------+
|         |                                                  |
|         | LIST VIEW:                                       |
|         | +----------------------------------------------+ |
|         | | Name          | Cat   | Cost  | FC% | Status| |
|         | |---------------+-------+-------+-----+-------| |
|         | | Caesar Salad  | SALAD | 12.30 | 27% | ACTIVE| |
|         | | Wagyu Tartare | BITES | 35.20 | 31% | ACTIVE| |
|         | | Mango Sorbet  | DESRT | 8.50  | 22% | NEW   | |
|         | | ...                                          | |
|         | +----------------------------------------------+ |
|         |                                                  |
|         | GRID VIEW:                                       |
|         | +--------+ +--------+ +--------+ +--------+      |
|         | |[Image] | |[Image] | |[Image] | |[Image] |      |
|         | |Caesar  | |Wagyu   | |Mango   | |Grilled |      |
|         | |Salad   | |Tartare | |Sorbet  | |Salmon  |      |
|         | |AED 12  | |AED 35  | |AED 8.5 | |AED 28  |      |
|         | |27% [A] | |31% [A] | |22% [N] | |29% [A] |      |
|         | +--------+ +--------+ +--------+ +--------+      |
|         |                                                  |
|         | Showing 1-20 of 147            [< 1 2 3 ... 8 >] |
+-----------------------------------------------------------+
```

**Component Inventory:**

1. **Page Header**:
   - Title: "Recipes" with count badge
   - View toggle: Grid / List (icon buttons, persisted per user)
   - New Recipe button (primary, Cmd+N)

2. **Filter Bar**:
   - Search field: Fuzzy search across recipe name, ingredients, method
   - Category filter: Multi-select dropdown with category color dots
   - Status filter: Multi-select (ACTIVE, Actual, Pending, Update, NEW)
   - Allergen filter: Multi-select with allergen icons (show recipes containing / excluding selected allergens)
   - Cost range: Dual-handle slider (AED 0 -- max cost, with input fields)
   - Sort: Dropdown (Name A-Z, Name Z-A, Cost Low-High, Cost High-Low, Recently Modified, Food Cost %)
   - Active filter count badge on filter button
   - "Clear All" link when filters are active

3. **List View** (Table):
   - Columns: Thumbnail (40x40), Name, Category (colored badge), Cost (AED, right-aligned mono), Food Cost % (colored: green < target, red > target), Price (AED), Margin (AED), Status (colored badge), Last Modified (relative date)
   - Row hover: Subtle highlight, quick action icons appear (Edit, Duplicate, Delete)
   - Row click: Opens recipe in viewer
   - Row double-click: Opens recipe in editor
   - Column resize: Drag column borders
   - Column sort: Click header to sort
   - Multi-select: Checkbox column for bulk operations
   - Bulk actions bar (appears when items selected): Delete, Change Status, Export, Change Category

4. **Grid View** (Card Grid):
   - Cards: 4 columns (desktop), 3 (tablet), 2 (mobile)
   - Each card: Recipe image (or category gradient placeholder), recipe name, category badge, cost (AED), food cost %, status badge
   - Hover: Elevation increase, quick action overlay (Edit, View, Duplicate)
   - Click: Opens recipe viewer
   - Allergen icons row at bottom of card (if present)

5. **Pagination**:
   - 20 items per page (configurable: 20, 50, 100)
   - Page numbers with prev/next arrows
   - "Showing X-Y of Z" text
   - Cmd+Left/Right to page

**Interaction Patterns:**
- Type in search field to filter instantly (debounced 200ms)
- Cmd+Click to select multiple recipes
- Drag recipe card to category in sidebar to re-categorize (desktop)
- Right-click recipe for context menu (Edit, Duplicate, Delete, Copy Link, Export PDF)
- Keyboard: Arrow keys navigate rows, Enter opens selected, Delete key with confirmation

**State Management:**
- `recipes` -- Paginated recipe list with loading state
- `filters` -- Active filter selections (persisted in URL params for shareability)
- `viewMode` -- 'grid' | 'list' (persisted per user)
- `sortBy` -- Current sort field and direction
- `selectedRecipes` -- Array of selected recipe IDs for bulk operations
- `page` -- Current page number

**Keyboard Shortcuts:**
- `Cmd+N` -- New recipe
- `Cmd+F` -- Focus search
- `G` then `L` -- Switch to list view
- `G` then `G` -- Switch to grid view
- `Enter` -- Open selected recipe
- `E` -- Edit selected recipe
- `D` -- Duplicate selected recipe
- `Backspace` -- Delete selected (with confirmation)

**Accessibility:**
- List view: `role="table"` with `role="row"` and `role="cell"`
- Grid view: `role="grid"` with `role="gridcell"`
- Filters: `role="search"` region with `aria-label="Recipe filters"`
- Sort: `aria-sort` attribute on sorted column header
- Status badges: `aria-label` includes full text (e.g., "Status: Active")
- Category colors supplemented with text labels

### 11.2 Recipe Editor

**Purpose:** Create and edit recipes with ingredient entry, cost calculation, nutrition tracking, method documentation, and media attachment. This is the most complex and most-used screen in the application.

**Layout (Desktop -- Full Width):**

```
+-----------------------------------------------------------+
| Sidebar | Caesar Salad [ACTIVE] [SALADS]   [Save] [More v] |
|         +--------------------------------------------------+
|         | [Details] [Ingredients] [Method] [Nutrition] [Media] [History] |
|         +--------------------------------------------------+
|         |                                                  |
|         | TAB: INGREDIENTS (default view)                  |
|         |                                                  |
|         | Servings: [4___] | Scale: [1x] [2x] [4x] [___x] |
|         |                                                  |
|         | INGREDIENT TABLE                                 |
|         | +----------------------------------------------+ |
|         | |# |Ingredient    |Qty |Unit|Gross|Ref%|Cost | |
|         | |--+--------------+----+----+-----+----+-----| |
|         | |1 |Romaine       |200 |g   |222  |10% |1.20 | |
|         | |2 |Parmesan      |30  |g   |30   |0%  |3.50 | |
|         | |3 |Caesar Dress* |0.1 |L   |0.1  |0%  |2.10 | |
|         | |4 |Croutons*     |50  |g   |52.5 |5%  |0.80 | |
|         | |  |[+ Add ingredient...]                     | |
|         | +----------------------------------------------+ |
|         | * = sub recipe (linked)                          |
|         |                                                  |
|         | COST SUMMARY (right panel or bottom)             |
|         | +---------------------+                          |
|         | | Ingredient Cost     |  AED  7.60              |
|         | | Waste Allowance     |  AED  0.38              |
|         | | Total Food Cost     |  AED  7.98              |
|         | | Cost per Portion    |  AED  2.00              |
|         | |---------------------|                          |
|         | | Selling Price       |  AED 38.00              |
|         | | VAT (5%)            |  AED  1.90              |
|         | | Margin              |  AED 28.12              |
|         | | Food Cost %         |  21.0%  [green]         |
|         | | Target FC %         |  30.0%                  |
|         | +---------------------+                          |
+-----------------------------------------------------------+
```

**Component Inventory:**

1. **Recipe Header**:
   - Recipe name (editable inline, `display-md` weight)
   - Status badge (clickable to change status)
   - Category badge (clickable to change category)
   - Save button (Cmd+S, shows "Saved" with timestamp after save)
   - More menu: Duplicate, Export PDF, Print, Archive, Delete, Copy Link, Version History

2. **Tab Bar** (horizontal, scrollable on mobile):
   - Details -- Basic info (name, description, category, status, allergens, image)
   - Ingredients -- Ingredient table with auto-lookup (default/primary tab)
   - Method -- Step-by-step preparation instructions
   - Nutrition -- Calculated nutrition panel
   - Media -- Photos and videos
   - History -- Version timeline

3. **Details Tab**:
   ```
   Recipe Name:        [Caesar Salad________________]
   Description:        [Classic caesar with romaine, aged parmesan,
                        house-made croutons and caesar dressing___]
   Category:           [SALADS v]
   Status:             [ACTIVE v]
   Servings:           [4___]
   Prep Time:          [15___] min
   Cook Time:          [0____] min
   Difficulty:         [Easy v]
   Allergens:          [Gluten] [Milk] [Eggs] [Fish] [+ Add]
   Tags:               [lunch] [signature] [+ Add]
   Notes:              [Internal notes, not printed___________]
   ```

4. **Ingredient Table** (custom `IngredientRow` component):

   26-row capacity (matching Excel), dynamic row addition.

   | Column | Width | Type | Behavior |
   |---|---|---|---|
   | # | 40px | Auto | Row number, drag handle for reorder |
   | Ingredient | 200px | Combobox | Auto-lookup against Product List. Type to search, select to populate Unit, Ref%, and Cost automatically. Shows product name, supplier, and cost in dropdown. |
   | Qty | 80px | Number input | Net quantity needed. Tab to enter. |
   | Unit | 70px | Auto-filled | Populated from product data. Can be overridden. |
   | Gross Qty | 80px | Calculated | = Qty / (1 - Ref%). Read-only, grey background. |
   | Ref % | 60px | Auto-filled | Waste/reference percentage from product data. Editable override. |
   | Cost | 90px | Calculated | = Gross Qty x Unit Cost. Read-only, mono font, right-aligned. |
   | Sub Recipe | 24px | Icon | Link icon if ingredient is a sub recipe. Click to open sub recipe. |
   | Actions | 40px | Icon buttons | Delete row (trash icon), shown on hover |

   **Row behavior:**
   - Empty last row always present for adding new ingredient
   - Tab from last field in row advances to Ingredient field of next row
   - Enter in Ingredient field commits selection and advances to Qty
   - Drag-and-drop rows to reorder (drag handle on row number)
   - Right-click row for context menu: Insert Above, Insert Below, Duplicate, Remove, View Product
   - Paste from clipboard: Supports pasting ingredient name (triggers lookup)
   - Sub recipe ingredients show italic name with asterisk and link icon
   - Total row at bottom: Bold, shows total ingredient cost

   **Auto-lookup behavior (critical UX):**
   - User types in Ingredient field
   - Dropdown appears after 2 characters, showing matching products from Product List
   - Each result shows: Product Name, Supplier, Unit, Cost per Unit
   - Arrow keys navigate results, Enter selects
   - On selection: Unit, Ref%, and Cost per Unit auto-populate from product data
   - If product not found: Option to "Add new product" at bottom of dropdown
   - Recently used ingredients appear at top when field is empty/focused

5. **Cost Summary Panel** (sticky right sidebar on desktop, bottom panel on mobile):
   - All values update in real-time as ingredients change
   - Fields:
     - Ingredient Cost: Sum of all row costs
     - Waste Allowance: Based on formula configuration
     - Total Food Cost: Ingredient Cost + Waste Allowance (+ any configured overhead)
     - Cost per Portion: Total Food Cost / Servings
     - Selling Price: Manual entry (AED)
     - VAT: Calculated from configured rate
     - Margin: Selling Price - Total Food Cost - VAT
     - Food Cost %: (Total Food Cost / Selling Price) x 100
     - Target FC %: From settings or manual override
   - Food Cost % displayed with color coding:
     - Green: Below target
     - Amber: Within 3% of target
     - Red: Above target
   - "View Formula" link opens formula breakdown popover
   - "What-if" button enables sensitivity mode (adjust prices to see impact)

6. **Scaling Controls**:
   - Preset buttons: 1x, 2x, 4x
   - Custom multiplier input
   - When scaled: All quantities multiply, costs recalculate, portion count updates
   - Visual indicator shows current scale factor
   - "Reset to 1x" button

7. **Method Tab**:
   ```
   Step 1:
   [Rich text editor with formatting toolbar]
   Wash and dry romaine lettuce. Tear into bite-sized pieces.
   [+ Add Photo] [Timer: 0 min]

   Step 2:
   Prepare caesar dressing (see sub recipe: Caesar Dressing).
   [Link to sub recipe] [Timer: 5 min]

   Step 3:
   Toss lettuce with dressing. Top with shaved parmesan and croutons.
   [+ Add Photo] [Timer: 2 min]

   [+ Add Step]
   ```
   - Each step: Numbered, rich text (bold, italic, lists), optional photo, optional timer
   - Drag-and-drop step reordering
   - Link to sub recipes inline
   - Timer buttons that launch kitchen timer
   - Voice-to-text input (microphone button) on mobile/tablet

8. **Nutrition Tab**:
   ```
   NUTRITION PANEL (per serving)

   MACRONUTRIENTS
   +------------------+--------+---------+
   | Nutrient         | Amount | % RDA   |
   +------------------+--------+---------+
   | Calories (K.Cal) | 320    | 16%     |
   | Fat              | 18.5g  | 28%     |
   | Carbohydrates    | 22.0g  | 8%      |
   | Protein          | 15.2g  | 30%     |
   +------------------+--------+---------+

   MICRONUTRIENTS
   +------------------+--------+---------+
   | Vitamin A        | 245 IU | 5%      |
   | Vitamin C        | 12 mg  | 20%     |
   | Calcium          | 180 mg | 18%     |
   | Iron             | 2.1 mg | 12%     |
   | Sodium           | 680 mg | 30%     |
   +------------------+--------+---------+

   [Nutrition calculated from ingredient data]
   [Last updated: when ingredients changed]
   ```
   - Values auto-calculated from ingredient nutrition data
   - Visual bar graphs for RDA percentages
   - Allergen summary at top
   - Export nutrition label (PDF)
   - Manual override option for each value (with "calculated" / "manual" indicator)

9. **Media Tab**:
   - Hero image (drag-and-drop upload, crop tool)
   - Additional photos (gallery grid)
   - Drag-and-drop reorder
   - Photo metadata: Caption, step association
   - Camera capture button (mobile/tablet)
   - Maximum 10 photos per recipe

10. **History Tab**:
    - Version timeline (vertical)
    - Each version: Timestamp, author, change summary
    - Click version to view that snapshot
    - Compare button to open diff view between versions
    - Restore button to revert to a previous version

**Interaction Patterns:**
- Auto-save every 30 seconds and on tab switch (visual indicator: "Saving..." / "Saved")
- Cmd+S to save immediately
- Cmd+Z / Cmd+Shift+Z for undo/redo (tracks all field changes)
- Tab key navigates through ingredient table cells (left to right, then next row)
- Escape exits current field without saving change
- Cmd+D duplicates selected ingredient row
- Cmd+Backspace deletes selected row (with confirmation if row has data)

**State Management:**
- `recipe` -- Complete recipe object with all fields
- `originalRecipe` -- Snapshot for dirty-checking and undo
- `isDirty` -- Boolean, true if unsaved changes exist
- `activeTab` -- Current tab selection
- `scaleFactor` -- Current scaling multiplier
- `undoStack` / `redoStack` -- For undo/redo operations
- `isAutoSaving` -- Auto-save in progress
- `validationErrors` -- Map of field-level validation errors

**Keyboard Shortcuts:**
- `Cmd+S` -- Save recipe
- `Cmd+Z` -- Undo
- `Cmd+Shift+Z` -- Redo
- `Cmd+N` -- New recipe (from recipe list)
- `Cmd+D` -- Duplicate current recipe
- `Cmd+P` -- Print / PDF export
- `Tab` -- Next field in ingredient table
- `Shift+Tab` -- Previous field
- `Enter` -- Confirm ingredient selection / advance to next field
- `Escape` -- Cancel current edit / close dropdown
- `Cmd+1` through `Cmd+6` -- Switch tabs (Details through History)

**Accessibility:**
- Ingredient table: `role="grid"` with `aria-colcount`, `aria-rowcount`
- Each cell: `role="gridcell"` with `aria-colindex`, `aria-rowindex`
- Combobox: Full ARIA combobox pattern (expanded, activedescendant, listbox)
- Cost summary: `role="region"` with `aria-label="Cost summary"`, `aria-live="polite"` for value updates
- Tab bar: `role="tablist"` with `role="tab"` and `role="tabpanel"`
- Validation errors: `aria-invalid="true"` and `aria-describedby` linking to error message
- Status changes announced via live region
- Focus management: Focus returns to trigger element when closing modals/dropdowns

### 11.3 Recipe Viewer / Print View

**Purpose:** Read-only recipe display optimized for reading and printing. Used for recipe review, kitchen reference, and PDF export.

**Layout:**

```
+-------------------------------------------+
| [Back] Caesar Salad    [Edit] [Print] [PDF]|
+-------------------------------------------+
|                                           |
| [Hero Image - full width]                 |
|                                           |
| Caesar Salad                              |
| SALADS | ACTIVE | Serves 4               |
| Prep: 15 min | Cook: 0 min               |
|                                           |
| Allergens: [Gluten] [Milk] [Eggs] [Fish]  |
|                                           |
| INGREDIENTS                               |
| ---------------------------------------- |
| 200g  Romaine Lettuce                     |
| 30g   Parmesan (aged)                     |
| 100ml Caesar Dressing*                    |
| 50g   Croutons*                           |
| ---------------------------------------- |
|                                           |
| METHOD                                    |
| 1. Wash and dry romaine lettuce...        |
| 2. Prepare caesar dressing...             |
| 3. Toss lettuce with dressing...          |
|                                           |
| COST SUMMARY           NUTRITION (per serving)|
| Ingredient: AED 7.60   Calories: 320     |
| Food Cost:  AED 7.98   Fat: 18.5g        |
| Price:      AED 38.00  Carbs: 22.0g      |
| FC%:        21.0%      Protein: 15.2g    |
+-------------------------------------------+
```

**Print Optimizations:**
- Clean layout without navigation chrome
- Single column for narrow printing
- Category and status in text (not colored badges)
- Cost summary and nutrition side-by-side on desktop, stacked on mobile
- High contrast for kitchen printing
- QR code linking to digital version (bottom of page)
- Page breaks after method section

### 11.4 Recipe Comparison

**Purpose:** Side-by-side comparison of two recipe versions or two different recipes.

**Layout (Desktop):**

```
+-----------------------------------------------------------+
| Sidebar | Recipe Comparison                                 |
|         +--------------------------------------------------+
|         | LEFT: [Select recipe v]  |  RIGHT: [Select recipe v] |
|         +--------------------------+--------------------------+
|         | Caesar Salad v3          | Caesar Salad v2           |
|         | Modified: Today          | Modified: 3 days ago      |
|         +--------------------------+--------------------------+
|         | INGREDIENTS              | INGREDIENTS               |
|         | 200g Romaine             | 200g Romaine              |
|         | 30g Parmesan [CHANGED]   | 25g Parmesan [CHANGED]    |
|         | 100ml Caesar Dress.      | 100ml Caesar Dress.       |
|         | 50g Croutons [NEW]       |                           |
|         +--------------------------+--------------------------+
|         | COST                     | COST                      |
|         | AED 7.98 (+0.80)         | AED 7.18                  |
|         | FC% 21.0% (+2.1%)        | FC% 18.9%                 |
|         +--------------------------+--------------------------+
```

**Behavior:**
- Select any two recipes or two versions of the same recipe
- Differences highlighted: Green for additions, red for removals, amber for changes
- Ingredient rows aligned for comparison
- Cost delta shown with arrow indicators
- "Use Left" / "Use Right" buttons to apply a version
- Synchronized scrolling between panels

### 11.5 Recipe Versioning (Diff View)

**Purpose:** Show detailed changes between recipe versions with approval workflow.

**Layout:**

```
+-----------------------------------------------------------+
| Recipe: Caesar Salad -- Version History                    |
+-----------------------------------------------------------+
| Version Timeline:                                          |
| v5 (Current) -- Today, 14:30 -- Chef Yves                 |
| v4 -- Yesterday, 09:00 -- Sous Chef Ahmed                 |
| v3 -- Jul 20, 16:45 -- Chef Yves                          |
| v2 -- Jul 18, 11:00 -- Chef Yves                          |
| v1 -- Jul 15, 10:00 -- Chef Yves (Created)                |
+-----------------------------------------------------------+
| Comparing v4 -> v5 (Current)                               |
|                                                            |
| CHANGES:                                                   |
| - Parmesan qty: 25g -> 30g                                 |
| + Added: Croutons (50g)                                    |
| ~ Selling Price: AED 35.00 -> AED 38.00                   |
| ~ Food Cost %: 20.5% -> 21.0%                             |
|                                                            |
| [Restore v4] [Approve v5] [Request Changes]                |
+-----------------------------------------------------------+
```

**Diff Format:**
- `+` Added (green)
- `-` Removed (red)
- `~` Changed (amber, shows old -> new)
- Unchanged fields hidden by default (toggle to show all)

---

## 12. Sub Recipe Management

### 12.1 Sub Recipe List

**Purpose:** Browse and manage sub recipes (stocks, sauces, doughs, dressings) that are components of main recipes.

**Layout:** Same as Recipe List (Section 11.1) with additional columns:

| Column | Description |
|---|---|
| Batch Size | Quantity produced (e.g., 5L, 2kg) |
| Cost per Unit | Cost per unit of batch (e.g., AED 2.10/L) |
| Used In | Count of recipes using this sub recipe |

**Filter additions:**
- "Used in active recipes" filter
- "Orphaned" filter (sub recipes not used in any recipe)

### 12.2 Sub Recipe Editor

**Purpose:** Create and edit sub recipes with batch costing, yield calculation, and cost-per-unit output.

**Layout:** Same structure as Recipe Editor (Section 11.2) with key differences:

**Header:**
```
Caesar Dressing [SUB RECIPE] [ACTIVE]    [Save] [More v]
```

**Batch & Yield Section (above ingredient table):**
```
BATCH SIZING
  Batch Yield:    [2____] [L v]    (total output of this batch)
  Batch Count:    [1____]          (number of batches to make)
  Cost per Unit:  AED 2.10 / L     (auto-calculated)
```

**Cost Summary differences:**
```
COST SUMMARY
  Ingredient Cost:     AED  4.20
  Waste Allowance:     AED  0.21
  Total Batch Cost:    AED  4.41
  Batch Yield:         2 L
  Cost per L:          AED  2.21
  Cost per 100ml:      AED  0.22
```

No selling price, margin, or food cost % fields (these are calculated at the parent recipe level).

**Scaling behavior:**
- Batch count multiplier scales all quantities and total cost
- Cost per unit remains constant (it is the ratio)
- When used as an ingredient in a recipe, the recipe pulls cost per unit

### 12.3 Sub Recipe Dependencies

**Purpose:** Show which recipes use a given sub recipe, for impact analysis before changes.

**Layout:**

```
+-------------------------------------------+
| Caesar Dressing -- Used In (8 recipes)     |
+-------------------------------------------+
| Recipe Name      | Category | Qty Used    |
|------------------+----------+-------------|
| Caesar Salad     | SALADS   | 100ml       |
| Chicken Caesar   | MAINS    | 120ml       |
| Caesar Wrap      | HOT      | 80ml        |
| ...                                       |
+-------------------------------------------+
| Impact of Cost Change:                     |
| If cost increases by 10%:                  |
| - Caesar Salad FC%: 21.0% -> 21.6%       |
| - Chicken Caesar FC%: 24.5% -> 25.1%     |
+-------------------------------------------+
```

**Behavior:**
- Automatically shown when editing a sub recipe (collapsible panel)
- Warning banner if sub recipe is used in 5+ recipes: "Changes will affect X recipes"
- Impact calculator: Enter hypothetical cost change to see effect on all parent recipes

---

## 13. Product / Ingredient Management

### 13.1 Product List

**Purpose:** Manage the master ingredient database (657+ products). Spreadsheet-style interface optimized for bulk viewing and editing, matching the density and efficiency of the original Excel Product List.

**Layout (Desktop -- Full Width, Spreadsheet Mode):**

```
+-----------------------------------------------------------+
| Sidebar | Products (657)           [+ Add] [Import] [Export]|
|         +--------------------------------------------------+
|         | [Search...] [Category v] [Supplier v] [Active Only]|
|         +--------------------------------------------------+
|         | SPREADSHEET TABLE (horizontally scrollable)       |
|         | +------------------------------------------------+|
|         | |Cat |Name      |Brand |Supplier|Pack |Unit|Cost ||
|         | |----+----------+------+--------+-----+----+-----||
|         | |Meat|Chicken Br|      |Bidfood |1kg  |kg  |32.50||
|         | |Fish|Salmon Fil|Norw. |Barakat |200g |g   |85.00||
|         | |Veg |Romaine   |Local |Fresh M.|500g |g   |4.50 ||
|         | |... |...       |...   |...     |...  |... |...  ||
|         | +------------------------------------------------+|
|         |                                                  |
|         | Showing 1-50 of 657                     [< 1...14>]|
+-----------------------------------------------------------+
```

**Column Definitions (all 31 fields from Product List):**

| # | Column | Type | Width | Editable | Description |
|---|---|---|---|---|---|
| 1 | Category | Select | 100px | Yes | Product category (Meat, Fish, Vegetable, Dairy, etc.) |
| 2 | Sub Category | Select | 100px | Yes | Sub-categorization |
| 3 | Supplier | Select | 120px | Yes | Primary supplier name |
| 4 | Product Code | Text | 90px | Yes | Supplier product code |
| 5 | Product Name | Text | 200px | Yes | Full product name (primary sort field) |
| 6 | Brand | Text | 100px | Yes | Brand name |
| 7 | Description | Text | 200px | Yes | Product description |
| 8 | Pack Size | Text | 80px | Yes | Packaging size (e.g., "1kg", "500ml") |
| 9 | Pack Unit | Select | 60px | Yes | Unit of packaging (kg, g, L, ml, each) |
| 10 | Units per Case | Number | 70px | Yes | Number of packs per case |
| 11 | Case Price | Number (AED) | 90px | Yes | Price per case |
| 12 | Unit Price | Calculated | 90px | No | Case Price / Units per Case |
| 13 | Price per kg/L | Calculated | 90px | No | Normalized cost per standard unit |
| 14 | Yield % | Number | 70px | Yes | Usable percentage after waste/trim |
| 15 | Waste % | Calculated | 70px | No | 100% - Yield % |
| 16 | Effective Cost | Calculated | 90px | No | Unit Price adjusted for waste |
| 17 | Ref % | Number | 60px | Yes | Reference waste percentage for recipes |
| 18 | Storage | Select | 80px | Yes | Dry, Chiller, Freezer |
| 19 | Shelf Life (days) | Number | 70px | Yes | Days of shelf life |
| 20 | Origin | Text | 80px | Yes | Country/region of origin |
| 21 | Organic | Boolean | 50px | Yes | Checkbox |
| 22 | Halal | Boolean | 50px | Yes | Checkbox |
| 23 | Allergens | Multi-select | 120px | Yes | Allergen tags |
| 24 | Calories (per 100g) | Number | 70px | Yes | K.Cal per 100g |
| 25 | Fat (per 100g) | Number | 60px | Yes | Grams per 100g |
| 26 | Carbs (per 100g) | Number | 60px | Yes | Grams per 100g |
| 27 | Protein (per 100g) | Number | 60px | Yes | Grams per 100g |
| 28 | Sodium (per 100g) | Number | 60px | Yes | Milligrams per 100g |
| 29 | Active | Boolean | 50px | Yes | Whether product is currently available |
| 30 | Last Price Update | Date | 90px | No | Date of last price change |
| 31 | Notes | Text | 200px | Yes | Free-text notes |

**Spreadsheet Behavior:**
- **Frozen columns**: Category, Name frozen to left (always visible during horizontal scroll)
- **Column visibility**: Toggle columns on/off via column header right-click menu or settings gear
- **Column reorder**: Drag column headers to rearrange
- **Column resize**: Drag column border to resize
- **Inline editing**: Double-click or press Enter on a cell to edit. Tab advances to next cell.
- **Bulk paste**: Select cell range, Cmd+V to paste from clipboard (Excel/CSV compatible)
- **Cell selection**: Click to select, Shift+Click for range, Cmd+Click for multi-select
- **Copy**: Cmd+C copies selected cells in TSV format
- **Row selection**: Click row number to select entire row
- **Alternating row colors**: Subtle background alternation for readability
- **Sort**: Click column header to sort. Shift+Click for secondary sort.
- **Filter per column**: Funnel icon in column header for column-specific filter

**Bulk Operations:**
- Select multiple rows (Shift+Click, Cmd+Click, or lasso select)
- Bulk actions toolbar appears: Delete, Change Category, Change Supplier, Change Active Status, Export Selected
- "Fill Down" on selected cells (Cmd+D) -- applies first cell's value to all selected

**State Management:**
- `products` -- Virtualized list (only visible rows rendered for performance)
- `visibleColumns` -- Array of visible column IDs (persisted per user)
- `columnOrder` -- Array of column IDs in display order
- `editingCell` -- Currently active cell coordinates {row, col}
- `selectedCells` -- Set of selected cell coordinates
- `clipboardData` -- For cut/copy/paste operations
- `sortConfig` -- Array of {column, direction} for multi-sort
- `filterConfig` -- Map of column filters

**Keyboard Shortcuts:**
- Arrow keys -- Navigate cells
- `Enter` -- Edit selected cell / confirm edit
- `Escape` -- Cancel cell edit
- `Tab` -- Move to next cell
- `Shift+Tab` -- Move to previous cell
- `Cmd+C` -- Copy selected cells
- `Cmd+V` -- Paste into selected cells
- `Cmd+D` -- Fill down
- `Cmd+A` -- Select all
- `Delete` -- Clear selected cells
- `Cmd+Z` -- Undo
- `Cmd+Shift+Z` -- Redo
- `Cmd+F` -- Find in table
- `Cmd+H` -- Find and replace

**Accessibility:**
- `role="grid"` with full ARIA grid navigation
- `aria-colcount`, `aria-rowcount` for virtual scrolling context
- Column headers: `role="columnheader"` with `aria-sort`
- Editable cells: `aria-readonly="false"`
- Calculated cells: `aria-readonly="true"` with `aria-label` including formula explanation
- Selection: `aria-selected="true"` on selected cells
- Status bar: `aria-live="polite"` announcing selection changes

### 13.2 Product Detail

**Purpose:** Full detail view for a single product, showing all 31 fields with edit capability, price history, and usage information.

**Layout (Desktop):**

```
+-----------------------------------------------------------+
| Sidebar | Chicken Breast Fillet        [Edit] [Save] [Delete]|
|         +--------------------------------------------------+
|         | [General] [Pricing] [Nutrition] [Usage] [History] |
|         +--------------------------------------------------+
|         |                                                  |
|         | GENERAL                    | PRICING              |
|         | Category: Meat             | Case Price: AED 130  |
|         | Supplier: Bidfood          | Units/Case: 4        |
|         | Brand: --                  | Unit Price: AED 32.50|
|         | Pack: 1kg                  | Price/kg: AED 32.50  |
|         | Storage: Chiller           | Yield: 85%           |
|         | Shelf Life: 5 days         | Effective: AED 38.24 |
|         | Origin: Brazil             |                      |
|         | Organic: No                | PRICE HISTORY        |
|         | Halal: Yes                 | [Sparkline chart]    |
|         |                            | Jul: AED 32.50       |
|         | ALLERGENS                  | Jun: AED 30.00 (+8%) |
|         | None                       | May: AED 30.00       |
|         |                                                  |
|         | USED IN RECIPES (12)                             |
|         | Caesar Salad, Chicken Caesar, Grilled Chicken... |
+-----------------------------------------------------------+
```

**Tabs:**
- **General**: All descriptive fields in a form layout
- **Pricing**: Cost data, yield/waste, price history chart
- **Nutrition**: Per-100g nutrition values with edit capability
- **Usage**: List of recipes and sub recipes using this product, with quantities
- **History**: Price change log with timestamps and source (manual, import, supplier sync)

### 13.3 Product Import

**Purpose:** Bulk import products from Excel/CSV files with column mapping.

**Layout (3-step wizard):**

**Step 1 -- Upload:**
```
Import Products

[Drop zone: Drag & drop your file here]
[or click to browse]

Supported formats: .xlsx, .csv
Maximum: 10,000 rows
```

**Step 2 -- Column Mapping:**
```
Map Your Columns

Your File Column    ->    CulinaryCore Field
[Product Name v]    ->    Product Name
[Price v]           ->    Case Price
[Category v]        ->    Category
[-- Skip -- v]      ->    Brand
...

[Auto-detect] [Reset]

Preview (first 5 rows):
| Your Data          | Mapped Field    |
| Chicken Breast     | Product Name    |
| 32.50              | Case Price      |
```

**Step 3 -- Review & Import:**
```
Import Summary

657 products to import
  - 620 new products
  - 37 updates (matched by product code)
  - 0 errors

[x] Skip rows with errors
[ ] Update existing products

[Cancel] [Import 657 Products]
```

**Behavior:**
- AI-assisted column mapping (auto-detects common column names)
- Preview shows first 5 rows with mapping applied
- Validation highlights errors (missing required fields, invalid data types)
- Progress bar during import
- Post-import summary with link to view imported products

### 13.4 Allergen Matrix

**Purpose:** Cross-reference view showing which allergens are present in which recipes, for menu planning and compliance.

**Layout (Desktop -- Full Width):**

```
+-----------------------------------------------------------+
| Sidebar | Allergen Matrix                        [Export]   |
|         +--------------------------------------------------+
|         | [Filter by category v] [Show: Active recipes only]|
|         +--------------------------------------------------+
|         | MATRIX TABLE (scrollable)                         |
|         | +------------------------------------------------+|
|         | |Recipe       |GLU|CRU|EGG|FSH|PNT|SOY|MLK|...  ||
|         | |-------------+---+---+---+---+---+---+---+---   ||
|         | |Caesar Salad | X |   | X | X |   |   | X |     ||
|         | |Wagyu Tartare|   |   | X |   |   |   |   |     ||
|         | |Pizza Marg.  | X |   |   |   |   |   | X |     ||
|         | |...                                             ||
|         | +------------------------------------------------+|
|         |                                                  |
|         | Legend: X = Contains, T = May contain traces      |
+-----------------------------------------------------------+
```

**Behavior:**
- Rows: Recipes (sorted by category, then name)
- Columns: 14 major allergens (abbreviated headers with full name tooltip)
- Cells: "X" for contains, "T" for traces, empty for free
- Click cell to toggle (in edit mode)
- Column sort: Click allergen header to sort recipes by that allergen
- Row click: Navigate to recipe detail
- Export: PDF allergen report for regulatory compliance

---

## 14. Supplier Management

### 14.1 Supplier Directory

**Purpose:** Master list of all suppliers with contact info, product counts, and status.

**Layout (Desktop):**

```
+-----------------------------------------------------------+
| Sidebar | Suppliers (24)                        [+ Add Supplier]|
|         +--------------------------------------------------+
|         | [Search...] [Status: All v]                       |
|         +--------------------------------------------------+
|         | SUPPLIER TABLE                                    |
|         | +----------------------------------------------+ |
|         | |Name          |Products|Last Order|Status    | |
|         | |--------------+--------+----------+----------| |
|         | |Bidfood       |47      |Jul 20    |Active    | |
|         | |Barakat Fresh |23      |Jul 22    |Active    | |
|         | |Al Rawabi     |12      |Jul 18    |Active    | |
|         | |Gulf Seafood  |8       |Jun 30    |Inactive  | |
|         | +----------------------------------------------+ |
+-----------------------------------------------------------+
```

**Columns:** Name, Contact Person, Email, Phone, Product Count, Last Order Date, Status (Active/Inactive), Rating (1-5 stars)

### 14.2 Supplier Detail & Products

**Purpose:** Full supplier profile with product catalog and order history.

**Layout:**

```
+-----------------------------------------------------------+
| Sidebar | Bidfood                              [Edit] [Deactivate]|
|         +--------------------------------------------------+
|         | [Details] [Products (47)] [Price History] [Orders]|
|         +--------------------------------------------------+
|         |                                                  |
|         | DETAILS                                          |
|         | Contact: John Smith                              |
|         | Email: john@bidfood.ae                           |
|         | Phone: +971 4 XXX XXXX                           |
|         | Address: Dubai Investment Park                    |
|         | Payment Terms: Net 30                            |
|         | Delivery Days: Mon, Wed, Fri                     |
|         |                                                  |
|         | PRODUCTS (47)                                    |
|         | [Search products...] [Export]                     |
|         | Name          | Code   | Unit  | Price     |    |
|         | Chicken Breast| BF-001 | kg    | AED 32.50 |    |
|         | Salmon Fillet | BF-042 | 200g  | AED 85.00 |    |
+-----------------------------------------------------------+
```

### 14.3 Price History & Comparison

**Purpose:** Track ingredient price trends and compare prices across suppliers.

**Layout:**

```
+-----------------------------------------------------------+
| Sidebar | Price Comparison: Chicken Breast Fillet           |
|         +--------------------------------------------------+
|         | PRICE TREND (line chart)                          |
|         | [Chart showing price over time per supplier]       |
|         +--------------------------------------------------+
|         | SUPPLIER COMPARISON                               |
|         | +----------------------------------------------+ |
|         | |Supplier    |Unit Price|Pack    |Min Order|Best||
|         | |------------+----------+--------+---------+----||
|         | |Bidfood     |AED 32.50 |1kg     |5 units  | *  ||
|         | |Al Rawabi   |AED 34.00 |1kg     |3 units  |    ||
|         | |Metro       |AED 31.00 |1.5kg   |10 units |    ||
|         | +----------------------------------------------+ |
|         |                                                  |
|         | * = Currently selected supplier                   |
|         | [Switch to cheapest] [Set price alert]             |
+-----------------------------------------------------------+
```

---

## 15. Menu Builder

### 15.1 Menu Editor

**Purpose:** Compose menus by organizing recipes into sections with drag-and-drop arrangement, pricing, and allergen overview.

**Layout (Desktop):**

```
+-----------------------------------------------------------+
| Sidebar | Dinner Menu -- Summer 2026       [Preview] [Publish]|
|         +--------------------------------------------------+
|         | [Menu Details] [Builder] [Costing] [Allergens]    |
|         +--------------------------------------------------+
|         |                                                  |
|         | BUILDER (drag-and-drop)                          |
|         |                                                  |
|         | BITES                          [+ Add Item] [...]  |
|         | +----------------------------------------------+ |
|         | | [::] Wagyu Tartare        AED 65   FC: 31%   | |
|         | | [::] Tuna Crudo           AED 55   FC: 28%   | |
|         | | [::] Burrata              AED 48   FC: 24%   | |
|         | +----------------------------------------------+ |
|         |                                                  |
|         | SALADS                         [+ Add Item] [...]  |
|         | +----------------------------------------------+ |
|         | | [::] Caesar Salad         AED 38   FC: 21%   | |
|         | | [::] Quinoa Bowl          AED 42   FC: 26%   | |
|         | +----------------------------------------------+ |
|         |                                                  |
|         | [+ Add Section]                                   |
|         |                                                  |
|         | MENU SUMMARY                                     |
|         | Items: 24 | Avg FC%: 27.2% | Avg Price: AED 52  |
+-----------------------------------------------------------+
```

**Components:**

1. **Menu Sections**: Named containers (BITES, SALADS, etc.) that hold menu items
   - Drag-and-drop to reorder sections
   - Click section header to rename
   - "..." menu: Delete section, Move up/down, Add divider

2. **Menu Items**: Recipes placed within sections
   - Drag handle (::) for reorder within and across sections
   - Shows: Recipe name, menu price, food cost %
   - Click to edit menu-specific details (price override, description override)
   - "Add Item" opens recipe picker (search/filter)
   - Drag from recipe list to menu section
   - Food cost % colored (green/amber/red relative to target)

3. **Add Item Dialog**: Search and select from existing recipes
   - Search field with category filter
   - Grid of recipe cards
   - Click or drag to add to section

4. **Menu Summary Bar** (bottom, sticky):
   - Total item count
   - Average food cost %
   - Average selling price
   - Worst-performing item (highest FC%)
   - Warning badges for items above target FC%

**Interaction Patterns:**
- Drag-and-drop within and across sections
- Double-click item to edit menu-specific price/description
- Right-click for context menu (Remove from menu, Edit recipe, View cost breakdown)
- Cmd+Z to undo reorder operations
- Auto-save on every change

### 15.2 Menu Engineering Matrix

**Purpose:** Boston Consulting Group-style matrix classifying menu items by popularity and profitability.

**Layout (Desktop):**

```
+-----------------------------------------------------------+
| Sidebar | Menu Engineering Matrix                [Export]    |
|         +--------------------------------------------------+
|         | [Menu: Dinner v] [Period: Last 30 days v]          |
|         +--------------------------------------------------+
|         |                                                  |
|         |  HIGH PROFIT                                     |
|         |  ^                                               |
|         |  |  PUZZLES          |  STARS                    |
|         |  |  (High margin,   |  (High margin,            |
|         |  |   low popularity)|   high popularity)         |
|         |  |  * Wagyu Tartare |  * Caesar Salad            |
|         |  |  * Tuna Crudo    |  * Grilled Salmon          |
|         |  |                  |  * Margherita Pizza        |
|         |  |------------------+------------------------    |
|         |  |  DOGS            |  PLOWHORSES               |
|         |  |  (Low margin,   |  (Low margin,              |
|         |  |   low popularity)|   high popularity)         |
|         |  |  * Lobster Bisque|  * Chicken Caesar          |
|         |  |  * Foie Gras     |  * Kids Pasta              |
|         |  |                                               |
|         |  LOW PROFIT          LOW POP -----> HIGH POP     |
|         |                                                  |
|         +--------------------------------------------------+
|         | RECOMMENDATIONS                                   |
|         | - Consider increasing price on Plowhorses         |
|         | - Promote Puzzles with table-side recommendations |
|         | - Review Dogs for potential removal or rework     |
+-----------------------------------------------------------+
```

**Components:**

1. **Scatter Plot Matrix**: Four quadrants with menu items plotted
   - X-axis: Popularity (order count or sales volume)
   - Y-axis: Profitability (contribution margin in AED)
   - Quadrant lines: Adjustable thresholds (drag to reposition)
   - Dot size: Proportional to revenue contribution
   - Dot color: Category color
   - Hover: Item name, price, margin, order count, FC%
   - Click: Navigate to recipe detail

2. **Quadrant Tables** (below chart): Expandable lists per quadrant
   - Stars: Keep and promote
   - Plowhorses: Increase price or reduce cost
   - Puzzles: Increase visibility / promotion
   - Dogs: Remove, rework, or reprice

3. **AI Recommendations Panel**: Generated suggestions based on matrix analysis
   - Pricing recommendations
   - Menu placement suggestions
   - Cost reduction opportunities

### 15.3 Menu Costing Summary

**Purpose:** Complete financial overview of menu items with aggregate statistics.

**Layout:**

```
+-----------------------------------------------------------+
| Sidebar | Menu Costing: Dinner Menu               [Export]  |
|         +--------------------------------------------------+
|         | SUMMARY STATS                                     |
|         | [Total Items: 24] [Avg FC%: 27.2%] [Avg Margin: AED 35.20] |
|         +--------------------------------------------------+
|         | ITEM TABLE (sortable)                              |
|         | +----------------------------------------------+ |
|         | |Section|Recipe    |Cost  |Price |Margin|FC%  | |
|         | |-------+----------+------+------+------+-----| |
|         | |BITES  |Wagyu     |20.15 |65.00 |42.95 |31.0%| |
|         | |BITES  |Tuna Crudo|15.40 |55.00 |37.70 |28.0%| |
|         | |SALADS |Caesar    |7.98  |38.00 |28.12 |21.0%| |
|         | |...                                          | |
|         | +----------------------------------------------+ |
|         |                                                  |
|         | SECTION AVERAGES                                  |
|         | BITES:   FC% 28.5% | SALADS: FC% 23.1%          |
|         | MAINS:   FC% 31.2% | DESSERT: FC% 18.4%         |
+-----------------------------------------------------------+
```

### 15.4 Allergen Matrix for Menu

**Purpose:** Customer-facing allergen reference for a specific menu.

Same layout as Section 13.4 (Allergen Matrix) but filtered to items on the selected menu, with menu section grouping. Exportable as a formatted PDF for printing and display.

---

## 16. Cost Analysis

### 16.1 Cost Breakdown (Configurable Formula View)

**Purpose:** Detailed breakdown of how recipe cost is calculated, with ability to view and modify the cost formula.

**Layout (Desktop):**

```
+-----------------------------------------------------------+
| Sidebar | Cost Breakdown: Caesar Salad                      |
|         +--------------------------------------------------+
|         |                                                  |
|         | FORMULA VISUALIZATION                            |
|         | +----------------------------------------------+ |
|         | |                                              | |
|         | | Ingredient Cost                              | |
|         | | [====== AED 7.60 ======]                     | |
|         | |          +                                   | |
|         | | Waste Allowance (5%)                         | |
|         | | [= AED 0.38 =]                              | |
|         | |          =                                   | |
|         | | Total Food Cost                              | |
|         | | [======= AED 7.98 =======]                  | |
|         | |                                              | |
|         | | Selling Price: AED 38.00                     | |
|         | | - Food Cost:   AED  7.98                     | |
|         | | - VAT (5%):    AED  1.90                     | |
|         | | = Margin:      AED 28.12                     | |
|         | |                                              | |
|         | | Food Cost %:   21.0%                         | |
|         | +----------------------------------------------+ |
|         |                                                  |
|         | INGREDIENT BREAKDOWN                             |
|         | [Horizontal stacked bar showing cost per ingredient]|
|         | Romaine (15%) | Parmesan (44%) | Dressing (26%) | Croutons (10%) | Waste (5%) |
|         |                                                  |
|         | [Edit Formula] [What-If Analysis]                 |
+-----------------------------------------------------------+
```

**Components:**

1. **Formula Visualization**: Step-by-step visual breakdown of the cost calculation, showing each component with its value and how it feeds into the total. Uses a waterfall-style display.

2. **Ingredient Breakdown Bar**: Proportional stacked bar showing each ingredient's contribution to total cost. Hover for exact amounts.

3. **Edit Formula Button**: Opens Formula Builder (Settings, Section 21.4)

4. **What-If Button**: Opens sensitivity analysis mode

### 16.2 Target Food Cost Calculator

**Purpose:** Reverse-calculate the required selling price or maximum ingredient cost to achieve a target food cost percentage.

**Layout:**

```
+-------------------------------------------+
| Target Food Cost Calculator                |
+-------------------------------------------+
|                                           |
| Current Recipe: Caesar Salad              |
| Current FC%: 21.0%                        |
|                                           |
| SCENARIO 1: Target a selling price        |
| Target FC%:    [30___] %                  |
| Current Cost:  AED 7.98                   |
| = Min Price:   AED 26.60                  |
|                                           |
| SCENARIO 2: Target a max cost             |
| Target FC%:    [30___] %                  |
| Selling Price: AED 38.00                  |
| = Max Cost:    AED 11.40                  |
| = Headroom:    AED 3.42 above current     |
|                                           |
| SCENARIO 3: What if price changes?        |
| New Price:     [42.00_] AED               |
| = New FC%:     19.0%                      |
| = New Margin:  AED 32.12                  |
+-------------------------------------------+
```

### 16.3 Sensitivity Analysis

**Purpose:** Model the impact of ingredient price changes on recipe cost and profitability.

**Layout:**

```
+-----------------------------------------------------------+
| Sidebar | Sensitivity Analysis: Caesar Salad                |
|         +--------------------------------------------------+
|         |                                                  |
|         | ADJUST INGREDIENT PRICES                         |
|         | +----------------------------------------------+ |
|         | |Ingredient  |Current |Change  |New Cost      | |
|         | |------------+--------+--------+--------------| |
|         | |Romaine     |AED 4.50| [+10%] |AED 4.95      | |
|         | |Parmesan    |AED 45.0| [+25%] |AED 56.25     | |
|         | |Caesar Dr.  |AED 2.10| [ 0% ] |AED 2.10      | |
|         | +----------------------------------------------+ |
|         |                                                  |
|         | IMPACT                                           |
|         | Current FC%:   21.0%                              |
|         | Projected FC%: 24.8% (+3.8%)                      |
|         | Margin Change: -AED 2.88                          |
|         |                                                  |
|         | [Tornado chart: Impact per ingredient]             |
|         | Parmesan    [=========>] +2.8%                     |
|         | Romaine     [==>] +0.6%                            |
|         | Caesar Dr.  [=>] +0.4%                             |
|         |                                                  |
|         | RECOMMENDATIONS                                   |
|         | - Parmesan is the primary cost driver              |
|         | - Consider alternative supplier (Metro: AED 42/kg) |
|         | - A 3% price increase would offset projected changes|
+-----------------------------------------------------------+
```

**Components:**

1. **Price Adjustment Table**: Slider or input per ingredient for hypothetical price changes (percentage or absolute)
2. **Impact Summary**: Real-time recalculation showing new FC%, margin, and delta
3. **Tornado Chart**: Rank-ordered horizontal bar chart showing which ingredients have the most impact on cost
4. **AI Recommendations**: Generated suggestions for cost optimization

### 16.4 Price Recommendation Engine

**Purpose:** AI-assisted pricing recommendations based on food cost targets, competitor analysis, and margin optimization.

**Layout:**

```
+-------------------------------------------+
| Price Recommendations                      |
+-------------------------------------------+
| Target FC%: [30%]                          |
|                                           |
| UNDER-PRICED (FC% > Target)               |
| Lobster Bisque: AED 55 -> AED 62 (FC: 38%->34%) |
| Wagyu Tartare:  AED 65 -> AED 68 (FC: 31%->30%) |
|                                           |
| OVER-PRICED (FC% well below Target)       |
| Mango Sorbet:   AED 35 -> AED 28 (FC: 22%->27%) |
|                                           |
| [Apply All] [Apply Selected]              |
+-------------------------------------------+
```

---

## 17. Inventory

### 17.1 Stock Count Interface

**Purpose:** Mobile-optimized interface for conducting physical inventory counts. Designed for use in storage areas (walk-in coolers, dry stores, freezers) with one hand, potentially wet or gloved.

**Layout (iOS / iPadOS -- Primary Platform):**

```
+---------------------------+
| Stock Count               |
| Walk-in Cooler | Jul 25   |
+---------------------------+
| [Scan Barcode]            |
| [Search product...]       |
+---------------------------+
|                           |
| Chicken Breast            |
| Bidfood | 1kg packs       |
| On hand: [____] packs     |
| [1] [2] [3] [+] [-]      |
|                           |
| Salmon Fillet             |
| Barakat | 200g packs      |
| On hand: [12__] packs     |
| [1] [2] [3] [+] [-]      |
|                           |
| ...                       |
+---------------------------+
| Progress: 45/120 items    |
| [============----] 38%    |
| [Save & Continue]         |
+---------------------------+
```

**Components:**

1. **Header**: Count name, location, date
2. **Barcode Scanner Button**: Opens camera with barcode overlay. Scans EAN/UPC codes to find product. Haptic feedback on scan.
3. **Search Field**: Type-ahead search for products (by name, code, supplier)
4. **Product Count Cards** (scrollable list):
   - Product name (large, bold)
   - Supplier and pack size (secondary text)
   - Quantity input: Large number input with stepper buttons (+/-)
   - Quick-add buttons: [1] [2] [3] for common counts
   - Full-case and partial-case entry
   - Last count reference (greyed): "Last count: 10 packs (Jul 18)"
5. **Progress Bar**: Items counted / total items, percentage
6. **Save Button**: Persists current count (works offline)

**Touch Targets:**
- All buttons: Minimum 64x64 points (kitchen glove-friendly)
- Quantity input: Large numeric field, 48px height
- Stepper buttons: 56x56 points
- Generous padding between interactive elements

**Offline Behavior:**
- Full product list cached locally
- Counts saved to local storage immediately
- Sync indicator: "Saved locally. Will sync when online."
- Queue of pending syncs visible in status bar

**iPadOS Landscape Mode:**
- Two-column layout: Product list (left), count entry (right)
- Product list scrollable, selection highlights current item
- Count entry panel shows larger input area with numeric keypad

### 17.2 Inventory Dashboard

**Purpose:** Overview of current inventory levels, value, and alerts.

**Layout (Desktop):**

```
+-----------------------------------------------------------+
| Sidebar | Inventory Dashboard                  [New Count]  |
|         +--------------------------------------------------+
|         | KPI CARDS                                         |
|         | [Total Value] [Items in Stock] [Low Stock] [Expiring]|
|         | AED 125,400   487            12          5       |
|         +--------------------------------------------------+
|         | STOCK BY CATEGORY (bar chart)                     |
|         | [Meat: AED 35K] [Seafood: AED 28K] [Produce: AED 15K]|
|         +--------------------------------------------------+
|         | LOW STOCK ALERTS                                  |
|         | Salmon Fillet -- 3 packs remaining (min: 10)      |
|         | Wagyu Beef -- 2 packs remaining (min: 5)          |
|         +--------------------------------------------------+
|         | RECENT COUNTS                                     |
|         | Walk-in Cooler -- Jul 25, 14:30 -- 120 items      |
|         | Dry Store -- Jul 24, 09:00 -- 200 items           |
+-----------------------------------------------------------+
```

### 17.3 Waste Tracking

**Purpose:** Record and analyze food waste for cost control and sustainability reporting.

**Layout:**

```
+-----------------------------------------------------------+
| Sidebar | Waste Log                          [+ Record Waste]|
|         +--------------------------------------------------+
|         | WASTE SUMMARY (this month)                        |
|         | [Total: AED 2,340] [% of Food Cost: 3.2%]        |
|         +--------------------------------------------------+
|         | WASTE BY REASON (pie chart)                       |
|         | Spoilage: 45% | Over-prep: 30% | Returns: 15% | Other: 10%|
|         +--------------------------------------------------+
|         | RECENT ENTRIES                                    |
|         | Jul 25: 2kg Salmon -- Spoilage -- AED 65.00       |
|         | Jul 24: 500g Romaine -- Over-prep -- AED 2.25     |
+-----------------------------------------------------------+
```

**Record Waste Dialog:**
```
+-------------------------------------------+
| Record Waste                               |
+-------------------------------------------+
| Product:  [Search product...   v]          |
| Quantity: [____] [kg v]                    |
| Reason:   [Spoilage v]                     |
|           (Spoilage, Over-prep, Return,    |
|            Damaged, Expired, Other)        |
| Cost:     AED 65.00 (auto-calculated)      |
| Notes:    [________________________]       |
| Photo:    [Take Photo] [Upload]            |
|                                           |
| [Cancel] [Record]                          |
+-------------------------------------------+
```

---

## 18. Production

### 18.1 Production Planning

**Purpose:** Plan daily/weekly production of sub recipes and prep items based on expected covers and menu requirements.

**Layout (Desktop):**

```
+-----------------------------------------------------------+
| Sidebar | Production Plan                   [Date: Jul 25 v]|
|         +--------------------------------------------------+
|         | [+ Add Item] [Auto-Plan] [Print Prep List]        |
|         +--------------------------------------------------+
|         | SERVICE: LUNCH                                    |
|         | Expected Covers: [80__]                           |
|         |                                                  |
|         | +----------------------------------------------+ |
|         | |Item           |Recipe    |Batch|Qty   |Assign ||
|         | |---------------+----------+-----+------+-------||
|         | |Caesar Dressing|Sub Recipe|2x   |4L    |Ahmed  ||
|         | |Pizza Dough    |Sub Recipe|10x  |10pcs |Sarah  ||
|         | |Chicken Stock  |Sub Recipe|1x   |5L    |Line   ||
|         | +----------------------------------------------+ |
|         |                                                  |
|         | SERVICE: DINNER                                   |
|         | Expected Covers: [120_]                           |
|         | (similar table)                                   |
+-----------------------------------------------------------+
```

**Components:**

1. **Date Selector**: Calendar date picker, defaults to tomorrow
2. **Service Periods**: Lunch, Dinner, or custom periods
3. **Expected Covers Input**: Drives auto-plan calculations
4. **Production Table**:
   - Item name (links to sub recipe)
   - Batch multiplier (editable)
   - Total quantity (calculated from multiplier x batch size)
   - Assigned to (user picker)
   - Status: Not Started / In Progress / Complete
5. **Auto-Plan Button**: AI calculates production needs based on covers, historical usage, and current inventory
6. **Print Prep List**: Generates formatted prep list for kitchen display/print

### 18.2 Prep Lists

**Purpose:** Printable/displayable checklist of production tasks for kitchen staff.

**Layout (Print-optimized and Kitchen Display):**

```
+-------------------------------------------+
| PREP LIST -- July 25, 2026                 |
| Service: Dinner | Covers: 120             |
+-------------------------------------------+
|                                           |
| ASSIGNED TO: AHMED                        |
| [ ] Caesar Dressing -- 4L (2 batches)    |
|     > See recipe: Caesar Dressing         |
| [ ] Lemon Vinaigrette -- 2L (1 batch)    |
|     > See recipe: Lemon Vinaigrette       |
|                                           |
| ASSIGNED TO: SARAH                        |
| [ ] Pizza Dough -- 10 pieces (10 batches) |
|     > See recipe: Pizza Dough             |
| [ ] Bread Rolls -- 40 pieces (4 batches)  |
|                                           |
| UNASSIGNED                                |
| [ ] Chicken Stock -- 5L (1 batch)         |
| [ ] Mango Puree -- 3L (2 batches)         |
+-------------------------------------------+
```

**Behavior:**
- Grouped by assigned user
- Checkboxes for completion tracking
- Link to full recipe/sub recipe
- Print-friendly layout (no navigation chrome)
- On Kitchen Display: Large text, checkboxes are tap targets

### 18.3 Kitchen Display (Kitchen Mode)

**Purpose:** Large-format display for kitchen production tracking. Designed for wall-mounted screens or iPad on a stand. See Section 23.1 for full Kitchen Mode specification.

**Layout:**

```
+-----------------------------------------------------------+
|              PRODUCTION -- DINNER SERVICE                    |
|                July 25, 2026 -- 14:30                       |
+-----------------------------------------------------------+
|                                                            |
|  IN PROGRESS                                               |
|  +------------------------+  +------------------------+    |
|  | CAESAR DRESSING        |  | PIZZA DOUGH            |    |
|  | 4L (2 batches)         |  | 10 pieces              |    |
|  | Ahmed                  |  | Sarah                  |    |
|  | [TIMER: 00:45:20]      |  | [TIMER: 02:15:00]      |    |
|  | [COMPLETE]             |  | [COMPLETE]             |    |
|  +------------------------+  +------------------------+    |
|                                                            |
|  WAITING                                                   |
|  +------------------------+  +------------------------+    |
|  | CHICKEN STOCK          |  | MANGO PUREE            |    |
|  | 5L (1 batch)           |  | 3L (2 batches)         |    |
|  | Unassigned             |  | Unassigned             |    |
|  | [START]                |  | [START]                |    |
|  +------------------------+  +------------------------+    |
|                                                            |
|  COMPLETED (2/6)                                           |
|  Lemon Vinaigrette (Ahmed, 14:15) | Bread Rolls (Sarah, 13:45)|
+-----------------------------------------------------------+
```

**Kitchen Mode Design:**
- Deep black background (anti-glare)
- Amber accent color (visible under warm kitchen lighting)
- Font size: 20px minimum, headers 28px
- Touch targets: 64x64 minimum (glove-friendly)
- Cards: Large, high-contrast, rounded corners (16px)
- Timers: Prominent display with color changes (green > amber > red)
- Status columns: In Progress, Waiting, Completed
- Auto-scroll to show most relevant items
- No accidental navigation (require deliberate swipe/tap patterns)

---

## 19. Reports & Analytics

### 19.1 Report Builder

**Purpose:** Create custom reports by selecting data sources, filters, grouping, and visualization.

**Layout (Desktop):**

```
+-----------------------------------------------------------+
| Sidebar | Report Builder                     [Save] [Run]   |
|         +--------------------------------------------------+
|         |                                                  |
|         | REPORT CONFIGURATION                             |
|         |                                                  |
|         | Name: [Monthly Food Cost Report___]               |
|         |                                                  |
|         | Data Source:                                      |
|         | [Recipes v]                                       |
|         |                                                  |
|         | Columns:                                          |
|         | [Recipe Name] [Category] [Food Cost] [FC%] [+]    |
|         | (drag to reorder, click [x] to remove)            |
|         |                                                  |
|         | Filters:                                          |
|         | Category [is] [MAINS v]                           |
|         | Status [is] [ACTIVE v]                             |
|         | Food Cost % [greater than] [25___]                |
|         | [+ Add Filter]                                    |
|         |                                                  |
|         | Group By: [Category v]                             |
|         | Sort By:  [Food Cost % v] [Desc v]                |
|         |                                                  |
|         | Visualization: [Table] [Bar] [Line] [Pie]         |
|         |                                                  |
|         +--------------------------------------------------+
|         | PREVIEW                                           |
|         | +----------------------------------------------+ |
|         | | Category | Avg FC% | Min FC% | Max FC% | # | |
|         | | MAINS    | 31.2%   | 24.5%   | 38.0%   | 18| |
|         | | GRILL    | 29.8%   | 26.0%   | 35.2%   | 8 | |
|         | | ...                                          | |
|         | +----------------------------------------------+ |
+-----------------------------------------------------------+
```

**Components:**

1. **Report Name**: Editable text field
2. **Data Source Selector**: Recipes, Sub Recipes, Products, Suppliers, Inventory, Waste, Production
3. **Column Picker**: Available columns from data source, drag to add/reorder, click to remove
4. **Filter Builder**: Condition rows with field/operator/value, add/remove conditions, AND/OR logic
5. **Group By**: Field to group results by
6. **Sort**: Field and direction
7. **Visualization Selector**: Table (default), Bar chart, Line chart, Pie chart
8. **Preview Panel**: Live preview of report output with sample data
9. **Save**: Save as named report for reuse
10. **Run**: Execute and display full results

### 19.2 Standard Reports

**Purpose:** Pre-built reports for common analytical needs.

**Available Reports:**

| Report | Description | Primary User |
|---|---|---|
| Food Cost Summary | All recipes with cost, price, margin, FC% | Management |
| Profitability by Category | Average margins by recipe category | Management |
| Ingredient Cost Report | All products with current costs, sorted by spend | Purchasing |
| Supplier Spend Report | Spend per supplier over time | Purchasing |
| Nutrition Summary | Nutrition data for all active recipes | Chef |
| Allergen Report | Complete allergen matrix for compliance | Chef / Manager |
| Inventory Valuation | Current stock levels and total value | Finance |
| Waste Report | Waste logs with cost impact | Chef / Management |
| Price Change Log | Historical price changes with impact analysis | Purchasing |
| Recipe Version Report | Change history across all recipes | Chef |

Each standard report opens with pre-configured columns, filters, and visualization that can be customized.

### 19.3 Export

**Purpose:** Export reports and data in standard formats.

**Export Formats:**

| Format | Usage |
|---|---|
| PDF | Formatted reports for printing and sharing. Includes header, logo, date, page numbers. |
| Excel (.xlsx) | Raw data with formatting for further analysis. Maintains column types. |
| CSV | Plain data export for import into other systems. |
| Print | Direct print via system print dialog with print-optimized CSS. |

**Export Dialog:**
```
+-------------------------------------------+
| Export Report                               |
+-------------------------------------------+
| Format:   (x) PDF  ( ) Excel  ( ) CSV     |
| Range:    (x) All data  ( ) Current page   |
| Include:  [x] Charts  [x] Summary stats    |
| Paper:    [A4 v]  [Portrait v]             |
|                                           |
| [Cancel] [Export]                           |
+-------------------------------------------+
```

---

## 20. AI Assistant

### 20.1 Chat Interface (Contextual Side Panel)

**Purpose:** AI-powered assistant that provides contextual help, recipe suggestions, cost optimization advice, and natural language queries across the application.

**Layout (Desktop -- Right Side Panel, 360px):**

```
+-----------------------------------------------------------+
| Sidebar | [Main Content Area]        | AI Assistant         |
|         |                            +----------------------+
|         |                            | CulinaryCore AI      |
|         |                            | [New Chat] [History] |
|         |                            +----------------------+
|         |                            |                      |
|         |                            | [Bot] How can I help |
|         |                            | you today?           |
|         |                            |                      |
|         |                            | Suggestions:         |
|         |                            | - Optimize this recipe|
|         |                            |   cost               |
|         |                            | - Find cheaper        |
|         |                            |   ingredients         |
|         |                            | - Generate nutrition  |
|         |                            |   label               |
|         |                            |                      |
|         |                            | [User] Can you suggest|
|         |                            | a way to reduce the  |
|         |                            | food cost of this    |
|         |                            | Caesar Salad?        |
|         |                            |                      |
|         |                            | [Bot] I can see the  |
|         |                            | Caesar Salad has a   |
|         |                            | food cost of 21%.    |
|         |                            | Here are 3 options:  |
|         |                            |                      |
|         |                            | 1. Switch Parmesan   |
|         |                            |    to Grana Padano    |
|         |                            |    (-AED 0.80)       |
|         |                            | 2. Reduce portion    |
|         |                            |    to 170g romaine   |
|         |                            |    (-AED 0.15)       |
|         |                            | 3. Use house bread   |
|         |                            |    for croutons       |
|         |                            |    (-AED 0.30)       |
|         |                            |                      |
|         |                            | [Apply #1] [Apply All]|
|         |                            +----------------------+
|         |                            | [Message input...]   |
|         |                            | [Send] [Mic] [Attach]|
+-----------------------------------------------------------+
```

**Components:**

1. **Panel Header**: Title, New Chat button, Chat History button, Close (X) button
2. **Message Thread**: Scrollable chat history
   - Bot messages: Light background card, bot avatar, markdown-formatted content
   - User messages: Accent-colored card, right-aligned
   - Action buttons within bot messages (Apply, View, Compare)
   - Source citations (linked to entities in the system)
   - Loading indicator: Typing dots animation
3. **Suggestion Chips**: Pre-written quick actions relevant to current context
4. **Input Area (bottom, sticky)**:
   - Text input with auto-resize
   - Send button
   - Microphone button (voice-to-text)
   - Attachment button (for importing recipes from files)
   - Character count for long messages

**Context Awareness:**
- AI knows the current page/view context (e.g., editing Caesar Salad)
- Suggestions are contextual:
  - On recipe editor: "Optimize cost", "Find alternatives", "Generate method"
  - On product list: "Find duplicates", "Check prices", "Suggest categories"
  - On dashboard: "Explain trend", "Alert summary", "Cost forecast"

**Interaction Patterns:**
- Toggle panel: Cmd+Shift+A
- Voice input: Hold microphone button to record
- Paste image/file in chat to trigger import wizard
- Click entity references in bot responses to navigate
- "Apply" buttons modify the current entity with the suggested changes

**State Management:**
- `messages` -- Chat history for current thread
- `isStreaming` -- Whether bot is currently generating a response
- `context` -- Current page/entity context passed to AI
- `chatHistory` -- List of past conversations (persisted)

### 20.2 Recipe Import Wizard (AI-Powered)

**Purpose:** Import recipes from external sources (PDF, Word, images, text, URLs) using AI to extract and map recipe data.

**Layout (3-step wizard):**

**Step 1 -- Upload:**
```
+-------------------------------------------+
| Import Recipe                              |
+-------------------------------------------+
|                                           |
| [Drop zone area]                          |
| Drop a recipe file here                   |
| or click to browse                        |
|                                           |
| Supported: PDF, Word, Image, Text         |
|                                           |
| [Paste URL]  [Paste Text]  [Take Photo]   |
+-------------------------------------------+
```

**Step 2 -- AI Extraction (Processing):**
```
+-------------------------------------------+
| Extracting Recipe...                       |
+-------------------------------------------+
|                                           |
| [Progress animation]                      |
|                                           |
| Reading document...          [done]       |
| Identifying ingredients...   [done]       |
| Matching products...         [in progress]|
| Calculating costs...         [pending]    |
|                                           |
+-------------------------------------------+
```

**Step 3 -- Review & Edit:**
```
+-------------------------------------------+
| Review Imported Recipe                     |
+-------------------------------------------+
|                                           |
| Name: [Caesar Salad_______________]       |
| Category: [SALADS v]                      |
| Servings: [4___]                          |
|                                           |
| INGREDIENTS (AI-matched)                  |
| +---------------------------------------+|
| |Extracted      |Matched Product  |Conf. ||
| |---------------+-----------------+------||
| |romaine lettuce|Romaine Lettuce  | 98%  ||
| |parmesan cheese|Parmesan (aged)  | 95%  ||
| |caesar dressing|[No match - add?]| --   ||
| +---------------------------------------+|
|                                           |
| METHOD                                    |
| [Extracted method text, editable]         |
|                                           |
| [Cancel] [Edit in Recipe Editor]           |
+-------------------------------------------+
```

**Behavior:**
- AI extracts: Name, ingredients (names, quantities, units), method steps, servings, cook time
- Ingredient matching: Each extracted ingredient is fuzzy-matched against Product List
- Confidence indicators: Green (>90%), amber (60-90%), red (<60%), no match
- User can correct matches via dropdown (shows top 5 matches)
- "No match" items offer "Add as new product" option
- "Edit in Recipe Editor" opens full editor with pre-populated data
- Support for multiple recipes in one document (batch import)

### 20.3 AI Suggestions Overlay

**Purpose:** Proactive AI suggestions displayed inline within the interface, not requiring the chat panel.

**Implementation:**

Subtle suggestion indicators appear on relevant elements:

- **Recipe Editor**: Sparkle icon on ingredient rows where a cheaper alternative exists. Hover shows: "Alternative: Grana Padano (AED 38/kg vs AED 45/kg) -- saves AED 0.80/serving"
- **Product List**: Highlight on products with significant price increases. "Salmon Fillet increased 15% this month. 3 alternative suppliers available."
- **Menu Builder**: Badge on items with FC% above target. "Wagyu Tartare is 1% above target. Consider AED 2 price increase."

**Design:**
- Small sparkle/lightbulb icon (non-intrusive)
- Tooltip on hover with suggestion text and action button
- "Dismiss" option to hide suggestion
- "Don't suggest this again" preference
- Global toggle: "Show AI suggestions" in settings

---

## 21. Settings & Administration

### 21.1 Global Settings

**Purpose:** Configure system-wide defaults for cost calculation, tax, currency, and display preferences.

**Layout (Desktop):**

```
+-----------------------------------------------------------+
| Sidebar | Settings                                          |
|         +--------------------------------------------------+
|         | SETTINGS NAVIGATION (left)  | CONTENT (right)     |
|         |                             |                     |
|         | General                     | GENERAL SETTINGS    |
|         | Cost & Pricing   <--        |                     |
|         | Tax & Currency              | Organization Name   |
|         | Notifications               | [My Restaurant____] |
|         | Display                     |                     |
|         | Integrations                | Default Currency    |
|         | Data Management             | [AED v]             |
|         |                             |                     |
|         | ADMINISTRATION              | Date Format         |
|         | Users & Roles               | [DD/MM/YYYY v]      |
|         | Organizations               |                     |
|         | Formula Builder             | Number Format       |
|         | Audit Log                   | [1,234.56 v]        |
|         |                             |                     |
|         |                             | [Save Changes]      |
+-----------------------------------------------------------+
```

**Settings Sections:**

1. **General**: Organization name, logo, timezone, date/number format
2. **Cost & Pricing**:
   - Default target food cost %
   - Waste allowance default %
   - Rounding rules (nearest 0.01, 0.05, 0.10)
   - Cost formula selection (Simple, Standard, Custom)
   - Overhead allocation method
3. **Tax & Currency**:
   - Primary currency (AED)
   - VAT rate (default 5%)
   - Additional tax configurations
   - Multi-currency support toggle
4. **Notifications**:
   - Price alert threshold (default 10%)
   - Low stock alert levels
   - Approval notification preferences
   - Email notification toggles
5. **Display**:
   - Default view mode (Grid/List)
   - Theme preference (Light/Dark/Auto/Kitchen)
   - Items per page default
   - Dashboard widget configuration
6. **Integrations**:
   - POS system connection
   - Accounting software sync
   - Supplier portal links
   - API key management
7. **Data Management**:
   - Data export (full backup)
   - Data import
   - Data retention policies
   - Cache management

### 21.2 Formula Builder (Drag-and-Drop Cost Formula Editor)

**Purpose:** Visual editor for configuring the cost calculation formula. Allows non-technical users to customize how food cost is calculated.

**Layout (Desktop):**

```
+-----------------------------------------------------------+
| Sidebar | Formula Builder                     [Save] [Reset] |
|         +--------------------------------------------------+
|         |                                                  |
|         | AVAILABLE COMPONENTS (left, 200px)                |
|         | +------------------+                              |
|         | | INPUTS           |                              |
|         | | [Ingredient Cost]|     FORMULA CANVAS            |
|         | | [Waste %]        |     (center, drag-drop area)  |
|         | | [Overhead %]     |                              |
|         | | [Labor %]        |     +--------------------+    |
|         | | [Packaging Cost] |     |                    |    |
|         | |                  |     | [Ingredient Cost]  |    |
|         | | OPERATIONS       |     |       |            |    |
|         | | [+] Add          |     |       v            |    |
|         | | [-] Subtract     |     | [+ Waste Allow.]   |    |
|         | | [x] Multiply     |     |       |            |    |
|         | | [/] Divide       |     |       v            |    |
|         | | [%] Percentage   |     | [= Total Food Cost]|    |
|         | |                  |     |                    |    |
|         | | OUTPUTS          |     +--------------------+    |
|         | | [Total Cost]     |                              |
|         | | [Cost per Unit]  |     PREVIEW                   |
|         | | [Food Cost %]    |     Ingredient Cost: AED 7.60 |
|         | | [Margin]         |     + Waste (5%): AED 0.38    |
|         | +------------------+     = Total: AED 7.98         |
|         |                         FC%: 21.0%                 |
+-----------------------------------------------------------+
```

**Components:**

1. **Component Palette (Left)**: Draggable blocks for inputs (data fields), operations (math), and outputs
2. **Formula Canvas (Center)**: Drop zone where components are arranged to form the calculation flow
   - Vertical flow: Components connect top-to-bottom
   - Each block shows: Label, value (from sample recipe)
   - Drag connections between blocks
   - Remove blocks by dragging off canvas or pressing Delete
3. **Preview Panel (Right or Bottom)**: Real-time calculation result using a sample recipe
   - Updates instantly as formula changes
   - Shows each step with intermediate values
4. **Validation**: Warns if formula is incomplete or produces invalid results

**Interaction Patterns:**
- Drag components from palette to canvas
- Connect outputs to inputs by dragging wire between connectors
- Double-click component to configure (e.g., set percentage value)
- Right-click for context menu (Delete, Configure, Help)
- Cmd+Z to undo changes
- "Reset to Default" restores standard formula

### 21.3 User Management

**Purpose:** Manage user accounts, roles, and permissions.

**Layout:**

```
+-----------------------------------------------------------+
| Sidebar | Users & Roles                     [+ Invite User] |
|         +--------------------------------------------------+
|         | [All Users] [Pending Invitations] [Roles]          |
|         +--------------------------------------------------+
|         |                                                  |
|         | USERS (12)                                        |
|         | +----------------------------------------------+ |
|         | |Name          |Email          |Role     |Status||
|         | |--------------+---------------+---------+------||
|         | |Chef Yves     |yves@rest.com  |Exec Chef|Active||
|         | |Ahmed Khan    |ahmed@rest.com |Sous Chef|Active||
|         | |Sarah Lee     |sarah@rest.com |Line Cook|Active||
|         | |...                                           ||
|         | +----------------------------------------------+ |
|         |                                                  |
|         | ROLES                                             |
|         | +----------------------------------------------+ |
|         | |Role          |Users |Permissions              | |
|         | |--------------+------+-------------------------| |
|         | |Admin         |1     |Full access               | |
|         | |Exec Chef     |2     |All recipes, costs, users | |
|         | |Sous Chef     |3     |Recipes, production       | |
|         | |Line Cook     |4     |View recipes, production  | |
|         | |Manager       |2     |Reports, costs, menu      | |
|         | |Finance       |1     |Reports, costs (view only)| |
|         | |Purchasing    |1     |Products, suppliers, orders| |
|         | +----------------------------------------------+ |
+-----------------------------------------------------------+
```

**Invite User Dialog:**
```
+-------------------------------------------+
| Invite User                                |
+-------------------------------------------+
| Email:    [________________________]       |
| Role:     [Sous Chef v]                    |
| Outlets:  [x] Main Restaurant             |
|           [ ] Beach Club                   |
|           [x] Rooftop Lounge              |
| Message:  [Optional welcome message___]    |
|                                           |
| [Cancel] [Send Invitation]                 |
+-------------------------------------------+
```

**Role Editor (for custom roles):**
```
+-------------------------------------------+
| Edit Role: Sous Chef                       |
+-------------------------------------------+
| RECIPES                                    |
| [x] View  [x] Create  [x] Edit  [ ] Delete|
| [x] Approve  [ ] Publish                  |
|                                           |
| PRODUCTS                                   |
| [x] View  [ ] Create  [x] Edit  [ ] Delete|
|                                           |
| COSTS & PRICING                            |
| [x] View costs  [ ] Edit prices           |
|                                           |
| REPORTS                                    |
| [x] View  [ ] Create  [ ] Export          |
|                                           |
| ADMIN                                      |
| [ ] User management  [ ] Settings         |
|                                           |
| [Cancel] [Save Role]                       |
+-------------------------------------------+
```

### 21.4 Organization Settings

**Purpose:** Multi-outlet organization configuration.

**Layout:**

```
+-------------------------------------------+
| Organization Settings                      |
+-------------------------------------------+
|                                           |
| Organization: Premium Dining Group         |
| Plan: Professional (50 users, 5 outlets)  |
|                                           |
| OUTLETS                                    |
| +---------------------------------------+|
| |Name          |Location    |Users |Status||
| |Main Restaurant|Downtown   |8     |Active||
| |Beach Club    |JBR         |5     |Active||
| |Rooftop       |DIFC        |4     |Active||
| +---------------------------------------+|
| [+ Add Outlet]                            |
|                                           |
| SHARED DATA                               |
| [x] Share product list across outlets     |
| [x] Share sub recipes across outlets      |
| [ ] Share recipes across outlets          |
| [ ] Consolidated reporting                |
|                                           |
| BILLING                                    |
| Current plan: Professional                 |
| Next billing: Aug 1, 2026                 |
| [Manage Subscription]                     |
+-------------------------------------------+
```

---

## 22. Version History & Audit

### 22.1 Timeline View

**Purpose:** Chronological view of all changes to a recipe (or any entity) with user attribution.

**Layout:**

```
+-----------------------------------------------------------+
| Sidebar | Caesar Salad -- History                            |
|         +--------------------------------------------------+
|         |                                                  |
|         | TIMELINE                                          |
|         |                                                  |
|         | Jul 25, 2026                                      |
|         |   14:30  Chef Yves modified ingredients           |
|         |          - Changed Parmesan qty: 25g -> 30g       |
|         |          - Added Croutons (50g)                   |
|         |          [View Snapshot] [Compare]                 |
|         |   |                                               |
|         |   09:00  Ahmed Khan submitted for review           |
|         |          [View Snapshot]                           |
|         |                                                  |
|         | Jul 20, 2026                                      |
|         |   16:45  Chef Yves updated pricing                |
|         |          - Price: AED 35 -> AED 38                |
|         |          [View Snapshot] [Compare]                 |
|         |   |                                               |
|         |   11:00  System: Ingredient cost updated           |
|         |          - Romaine: AED 4.20 -> AED 4.50/kg       |
|         |          [View Impact]                             |
|         |                                                  |
|         | Jul 15, 2026                                      |
|         |   10:00  Chef Yves created recipe                  |
|         |          [View Original]                           |
|         |                                                  |
+-----------------------------------------------------------+
```

**Components:**

1. **Timeline Rail**: Vertical line with date markers and event dots
2. **Event Cards**: Each change event showing:
   - Timestamp
   - User avatar + name
   - Action description
   - Change details (expandable for ingredient-level changes)
   - Action buttons: View Snapshot, Compare with current, Restore
3. **Filter**: By user, date range, change type (ingredients, pricing, method, status)

### 22.2 Diff Comparison

**Purpose:** Side-by-side or inline comparison of two recipe versions.

See Section 11.5 for detailed diff view specification.

**Additional diff capabilities:**
- Inline mode (single column, additions/removals highlighted)
- Side-by-side mode (two columns, synchronized scroll)
- Field-level diff (only show changed fields)
- Full diff (show all fields, highlight changes)
- Ingredient table diff: Added rows (green), removed rows (red), changed values (amber highlight on specific cells)

### 22.3 Approval Workflow

**Purpose:** Structured review and approval process for recipe changes.

**Workflow States:**
```
Draft -> Submitted for Review -> In Review -> Approved / Changes Requested -> Published
```

**Submit for Review Dialog:**
```
+-------------------------------------------+
| Submit for Review                          |
+-------------------------------------------+
| Recipe: Caesar Salad (v5)                  |
| Changes since last approved version:       |
|                                           |
| - Parmesan qty: 25g -> 30g               |
| - Added Croutons (50g)                    |
| - Food Cost: 18.9% -> 21.0%              |
|                                           |
| Reviewer: [Chef Yves v]                    |
| Notes:    [Added croutons per customer    |
|            feedback. Cost increase within  |
|            acceptable range.__________]    |
|                                           |
| [Cancel] [Submit for Review]               |
+-------------------------------------------+
```

**Review Mode (Reviewer's View):**
```
+-----------------------------------------------------------+
| REVIEW: Caesar Salad v5 (submitted by Ahmed)               |
+-----------------------------------------------------------+
| [View Changes] [Full Recipe] [Compare with v4]              |
|                                                            |
| CHANGES SUMMARY                                            |
| - Parmesan qty: 25g -> 30g                                 |
| - Added Croutons (50g)                                     |
| - Food Cost: 18.9% -> 21.0%                                |
|                                                            |
| REVIEWER NOTES                                              |
| [________________________]                                  |
|                                                            |
| [Request Changes]  [Approve]                                |
+-----------------------------------------------------------+
```

---

## 23. Special Modes

### 23.1 Kitchen Mode

**Purpose:** Simplified, high-contrast interface designed for use in active kitchen environments. Optimized for wet/gloved hands, steam, heat, and time pressure.

**Activation:** Toggle in user menu, keyboard shortcut Cmd+Shift+K, or scheduled auto-activation during service hours.

**Design Principles:**
- Deep black background (minimizes glare under bright kitchen lights)
- Amber accent color (visible through steam and under warm lighting)
- Minimum font size: 20px (readable at arm's length)
- Minimum touch target: 64x64 points (usable with kitchen gloves)
- No hover states (touch-only interaction model)
- No small icons without labels
- No accidental-delete paths (all destructive actions require deliberate confirmation)
- Simplified navigation (only essential functions)

**Available Screens in Kitchen Mode:**
1. Production Dashboard (default)
2. Recipe Viewer (step-by-step cooking mode)
3. Timer (multiple concurrent timers)
4. Prep Checklist

**Recipe Viewer -- Step-by-Step Cooking Mode:**
```
+-------------------------------------------+
|  CAESAR SALAD               Step 2 of 5    |
|  Serves: 4 | Scale: [1x] [2x] [4x]       |
+-------------------------------------------+
|                                           |
|  STEP 2                                   |
|                                           |
|  Prepare the caesar dressing:             |
|  Combine 2 egg yolks, 4 anchovy           |
|  fillets, 2 tbsp lemon juice,             |
|  1 tsp Dijon mustard.                     |
|  Blend until smooth.                      |
|                                           |
|  [TIMER: 5:00] [START TIMER]              |
|                                           |
|  INGREDIENTS FOR THIS STEP:               |
|  2 Egg Yolks                              |
|  4 Anchovy Fillets                        |
|  2 tbsp Lemon Juice                       |
|  1 tsp Dijon Mustard                      |
|                                           |
+-------------------------------------------+
| [<< PREV]            [NEXT >>]            |
+-------------------------------------------+
```

**Timer Interface:**
```
+-------------------------------------------+
|  KITCHEN TIMERS                            |
+-------------------------------------------+
|                                           |
|  +-------------------------------------+ |
|  | CAESAR DRESSING        [ACTIVE]      | |
|  |                                       | |
|  |        04:32                          | |
|  |                                       | |
|  | [PAUSE]  [RESET]  [+1 MIN]           | |
|  +-------------------------------------+ |
|                                           |
|  +-------------------------------------+ |
|  | PIZZA DOUGH PROOF     [ACTIVE]       | |
|  |                                       | |
|  |     01:45:20                          | |
|  |                                       | |
|  | [PAUSE]  [RESET]  [+5 MIN]           | |
|  +-------------------------------------+ |
|                                           |
|  [+ NEW TIMER]                            |
+-------------------------------------------+
```

**Timer Colors:**
- > 50% remaining: Green
- 25-50% remaining: Amber
- < 25% remaining: Red (pulsing)
- Completed: Red with alarm sound + haptic

### 23.2 Production Mode

**Purpose:** Optimized view for production/prep work with batch quantities, checklist workflows, and progress tracking.

**Activation:** Toggle in user menu or automatic when viewing production pages.

**Design Characteristics:**
- Light background (better readability under fluorescent kitchen/production lighting)
- High contrast text
- Large checkboxes and progress indicators
- Batch quantities prominently displayed
- Simplified navigation
- Print-friendly layout

**Production Mode Prep List:**
```
+-------------------------------------------+
| PREP LIST -- DINNER SERVICE               |
| July 25, 2026                             |
| Progress: 4/12 complete                   |
| [========================--------] 33%    |
+-------------------------------------------+
|                                           |
| AHMED (Sauces)                            |
| [x] Caesar Dressing -- 4L (2 batches)    |
|     Completed at 14:15                    |
| [x] Lemon Vinaigrette -- 2L (1 batch)    |
|     Completed at 14:30                    |
| [ ] Hollandaise -- 2L (1 batch)           |
|     [START] [VIEW RECIPE]                 |
|                                           |
| SARAH (Bakery)                            |
| [ ] Pizza Dough -- 10 pcs (10 batches)    |
|     [START] [VIEW RECIPE]                 |
| [ ] Bread Rolls -- 40 pcs (4 batches)     |
|     [START] [VIEW RECIPE]                 |
+-------------------------------------------+
```

### 23.3 Offline Mode

**Purpose:** Full application functionality when network is unavailable, with transparent sync when connectivity returns.

**Sync Architecture:**
- All data cached locally using IndexedDB (web) / Core Data (native)
- Changes queued in local write-ahead log
- Automatic sync on reconnection
- Conflict resolution for concurrent edits

**UI Indicators:**

1. **Status Bar Indicator** (always visible):
   ```
   Online:  [Green dot] Connected
   Offline: [Orange dot] Offline -- 3 changes pending
   Syncing: [Blue spinner] Syncing (2/3 changes)...
   Error:   [Red dot] Sync failed -- [Retry]
   ```

2. **Toast Notification** on connectivity change:
   - Going offline: "You're offline. Changes will sync when you reconnect."
   - Coming online: "Back online. Syncing 3 changes..."
   - Sync complete: "All changes synced."
   - Sync conflict: "Conflict detected in Caesar Salad. [Review]"

3. **Conflict Resolution Dialog:**
   ```
   +-------------------------------------------+
   | Sync Conflict: Caesar Salad                |
   +-------------------------------------------+
   |                                           |
   | Both you and Ahmed edited this recipe     |
   | while offline.                            |
   |                                           |
   | YOUR VERSION          THEIR VERSION       |
   | Parmesan: 30g         Parmesan: 35g       |
   | Croutons: 50g         Croutons: 50g       |
   |                                           |
   | [Keep Mine] [Keep Theirs] [Merge Manually]|
   +-------------------------------------------+
   ```

4. **Offline Badge on Entities:**
   - Items with pending local changes show a small cloud-with-arrow icon
   - Hover/tap shows: "Modified locally. Will sync when online."

---

## 24. Platform-Specific Designs

### 24.1 macOS Desktop Application

**Design Language:** Native macOS application feel using Electron/Tauri with React, following Apple HIG.

**Native Integrations:**

1. **Title Bar**: Native traffic lights (close/minimize/maximize). Custom title bar with app title, breadcrumb, and toolbar. Draggable region for window repositioning.

2. **Menu Bar**:
   ```
   CulinaryCore | File | Edit | View | Recipe | Tools | Window | Help
   ```
   - **CulinaryCore**: About, Preferences, Check for Updates, Quit
   - **File**: New Recipe (Cmd+N), New Sub Recipe (Cmd+Shift+N), Open (Cmd+O), Save (Cmd+S), Export (Cmd+E), Print (Cmd+P)
   - **Edit**: Undo, Redo, Cut, Copy, Paste, Find (Cmd+F), Find & Replace (Cmd+H), Select All
   - **View**: Sidebar (Cmd+\), AI Assistant (Cmd+Shift+A), Kitchen Mode (Cmd+Shift+K), Zoom In/Out, Full Screen
   - **Recipe**: Add Ingredient, Scale Recipe, View Nutrition, Compare Versions, Approve
   - **Tools**: Command Palette (Cmd+K), Import, Formula Builder, Report Builder
   - **Window**: Minimize, Zoom, New Window, Tile Left/Right, Show All
   - **Help**: CulinaryCore Help, Keyboard Shortcuts (Cmd+?), What's New, Contact Support

3. **Multiple Windows**:
   - Open recipes in separate windows (Cmd+Click or Window > New Window)
   - Each window is a full application instance with sidebar
   - Windows remember position and size
   - Window title shows entity name and status

4. **Dock Integration**:
   - Badge count for pending approvals/notifications
   - Right-click Dock menu: New Recipe, Open Recent (submenu), Preferences
   - Progress indicator during imports/exports

5. **Spotlight Integration**:
   - Index recipes, sub recipes, and products for Spotlight search
   - Results show entity name, type, and quick preview

6. **Touch Bar** (if applicable):
   - Context-sensitive controls:
     - Recipe editor: Save, Scale slider, Tab switcher
     - Product list: Search, Add, Filter
     - Dashboard: Date range, Refresh

7. **Drag and Drop**:
   - Drag files onto app icon to import
   - Drag ingredients between recipe windows
   - Drag recipes to menu sections
   - Drag products to reorder

8. **Keyboard-First Editing**:
   - Full spreadsheet-style keyboard navigation in product list and ingredient tables
   - Vim-style shortcuts available (opt-in): `j/k` for up/down, `e` for edit, `dd` for delete
   - Tab-based workflows: Tab through all editable fields

### 24.2 iPadOS Application

**Design Language:** Native iPadOS feel with adaptive layouts, multi-tasking support, and Apple Pencil integration.

**Layout Adaptations:**

1. **Landscape Mode (Primary for Kitchen Use):**
   - Sidebar navigation (pinnable, 320px)
   - Main content area adapts to remaining width
   - Side panel for AI assistant / detail views
   - Toolbar at top with primary actions

2. **Portrait Mode:**
   - Full-width content, no sidebar
   - Navigation via tab bar (bottom) and back button
   - Optimized for reading recipes and entering counts

3. **Multi-Tasking:**
   - **Split View**: CulinaryCore on one side, Notes/Calculator/Photos on the other. Content adapts to available width.
   - **Stage Manager**: Multiple resizable windows on iPadOS 16+. Each window maintains independent navigation state.
   - **Slide Over**: Compact card mode for quick reference while using another app.

**Touch Interactions:**

| Gesture | Action |
|---|---|
| Tap | Select / activate |
| Long press | Context menu (edit, delete, share) |
| Swipe left on list row | Delete / archive |
| Swipe right on list row | Quick action (edit, complete) |
| Pinch | Zoom on images, charts |
| Two-finger tap | Undo (system default) |
| Three-finger swipe left | Redo |
| Swipe from left edge | Navigate back |
| Pull down | Refresh data |
| Drag and drop | Reorder items, move between lists |

**Apple Pencil:**
- Handwritten notes on recipes (via PencilKit)
- Scribble: Write in text fields with Apple Pencil
- Annotate recipe images (circle, arrow, text)
- Sign-off on recipe approvals with signature

**Camera Integration:**
- Barcode scanning for inventory counts
- Photo capture for recipe images and waste logging
- Document scanning for recipe import (using VisionKit)

**Kitchen-Specific iPadOS Features:**
- "Guided Access" recommendation for kitchen-locked mode (prevent accidental navigation)
- AssistiveTouch enlarged button for Kitchen Mode activation
- Keep-alive: Prevent screen dimming during active recipes/timers
- Water/steam resistance guidance: Use with iPad Pro in waterproof case

### 24.3 iOS (iPhone) Application

**Design Language:** Compact, single-column, thumb-zone-optimized for one-hand use.

**Tab Bar (5 Tabs):**
```
[Dashboard] [Recipes] [Products] [Production] [More]
```

**Navigation Pattern:**
- Stack-based navigation (push/pop)
- Swipe-back gesture
- Large title navigation bar (collapses on scroll)
- Search bar in navigation (pull down to reveal)

**Screen Adaptations:**

1. **Dashboard (iPhone)**:
   - Vertical scroll of KPI cards (full width)
   - Simplified charts (sparklines instead of full charts)
   - Quick action buttons at top
   - Recent activity feed

2. **Recipe List (iPhone)**:
   - List view only (no grid -- too small)
   - Each row: Thumbnail (60x60), Name, Category pill, Cost, FC%
   - Swipe actions: Edit, Duplicate, Delete
   - Pull-to-refresh
   - Search bar at top

3. **Recipe Viewer (iPhone)**:
   - Full-screen hero image
   - Scrollable content: Name, metadata, ingredients, method
   - Sticky bottom bar: [Edit] [Scale] [Share]
   - Ingredients show simplified view (name, qty, unit)
   - Cost summary in collapsible section

4. **Quick Actions (from Home Screen):**
   - 3D Touch / Long-press on app icon:
     - New Recipe
     - Scan Barcode
     - Production List
     - Quick Search

5. **Barcode Scanner (iPhone):**
   ```
   +---------------------------+
   | Scan Product               |
   +---------------------------+
   |                           |
   |   +-------------------+   |
   |   |                   |   |
   |   |  [Camera View]    |   |
   |   |                   |   |
   |   |  [Barcode frame]  |   |
   |   |                   |   |
   |   +-------------------+   |
   |                           |
   | Last scanned:             |
   | Chicken Breast -- AED 32.50|
   |                           |
   | [Torch] [Manual Entry]    |
   +---------------------------+
   ```

6. **Production Checklist (iPhone):**
   - Simple checklist with large checkboxes (64pt targets)
   - Swipe right to complete
   - Badge count on Production tab
   - Push notification reminders for overdue items

7. **Push Notifications:**
   - Price alerts: "Salmon Fillet price increased 15%"
   - Approval requests: "Ahmed submitted Wagyu Tartare for review"
   - Production reminders: "3 prep tasks due by 14:00"
   - Sync alerts: "Conflict detected in Caesar Salad"
   - Notification grouping by type

8. **Voice Search:**
   - Microphone button in search bar
   - "Show me chicken recipes under 30% food cost"
   - Results page shows filtered list

9. **Offline Mode (iPhone):**
   - Full recipe catalog cached
   - Production lists available offline
   - Inventory counts save locally
   - Sync on reconnection with conflict UI
   - Banner: "Offline -- changes will sync when connected"

10. **Widgets (Home Screen / Lock Screen):**
    - Small: Today's prep count (X/Y complete)
    - Medium: Top 3 production tasks with due times
    - Large: Dashboard KPIs (FC%, active recipes, alerts)
    - Lock screen: Next production task due time

---

## 25. Keyboard Shortcuts Reference

### 25.1 Global Shortcuts

| Shortcut | Action |
|---|---|
| `Cmd+K` | Open Command Palette |
| `Cmd+N` | New Recipe |
| `Cmd+Shift+N` | New Sub Recipe |
| `Cmd+S` | Save current entity |
| `Cmd+Z` | Undo |
| `Cmd+Shift+Z` | Redo |
| `Cmd+F` | Find / Search |
| `Cmd+P` | Print |
| `Cmd+E` | Export |
| `Cmd+\` | Toggle Sidebar |
| `Cmd+Shift+A` | Toggle AI Assistant panel |
| `Cmd+Shift+K` | Toggle Kitchen Mode |
| `Cmd+,` | Open Preferences |
| `Cmd+?` | Keyboard Shortcuts reference |
| `Cmd+1` through `Cmd+9` | Navigate to sidebar sections |
| `/` | Focus search field |
| `Escape` | Close modal / cancel action / deselect |

### 25.2 Recipe Editor Shortcuts

| Shortcut | Action |
|---|---|
| `Cmd+S` | Save recipe |
| `Cmd+D` | Duplicate selected row / recipe |
| `Tab` | Next field |
| `Shift+Tab` | Previous field |
| `Enter` | Confirm selection / next row |
| `Escape` | Cancel current edit |
| `Cmd+1` -- `Cmd+6` | Switch editor tabs |
| `Cmd+Up/Down` | Move ingredient row up/down |
| `Cmd+Backspace` | Delete selected row |
| `Cmd+Shift+P` | Preview / print view |

### 25.3 Product List Shortcuts

| Shortcut | Action |
|---|---|
| Arrow keys | Navigate cells |
| `Enter` | Edit cell |
| `Escape` | Cancel edit |
| `Cmd+C` | Copy cells |
| `Cmd+V` | Paste cells |
| `Cmd+D` | Fill down |
| `Cmd+A` | Select all |
| `Cmd+F` | Find in table |
| `Cmd+H` | Find and replace |
| `Delete` | Clear cell content |
| `Space` | Toggle boolean cells |

### 25.4 Navigation Shortcuts

| Shortcut | Action |
|---|---|
| `G` then `D` | Go to Dashboard |
| `G` then `R` | Go to Recipes |
| `G` then `P` | Go to Products |
| `G` then `S` | Go to Suppliers |
| `G` then `M` | Go to Menu Builder |
| `G` then `I` | Go to Inventory |
| `G` then `O` | Go to Production |
| `G` then `A` | Go to Analytics |
| `G` then `T` | Go to Settings |

---

## 26. Accessibility Specification

### 26.1 Standards Compliance

CulinaryCore targets **WCAG 2.1 Level AA** compliance across all platforms.

### 26.2 Screen Reader Support

| Requirement | Implementation |
|---|---|
| Page landmarks | `<main>`, `<nav>`, `<aside>`, `<header>`, `<footer>` with `aria-label` |
| Headings hierarchy | Strict H1 > H2 > H3 nesting, one H1 per page |
| Form labels | All inputs have associated `<label>` or `aria-label` |
| Error identification | `aria-invalid`, `aria-describedby` linking to error messages |
| Live regions | KPI updates use `aria-live="polite"`, alerts use `aria-live="assertive"` |
| Tables | `role="table"`, `scope` attributes on headers, `aria-sort` for sorted columns |
| Custom widgets | Full ARIA widget patterns (combobox, grid, tablist, dialog, menu) |
| Focus management | Focus returns to trigger on modal close, focus trapped in dialogs |
| Image alt text | All recipe images have descriptive alt text, decorative images have `alt=""` |
| SVG charts | `role="img"` with `aria-label` containing textual summary |

### 26.3 Keyboard Navigation

| Requirement | Implementation |
|---|---|
| All interactive elements focusable | Tab order follows visual layout, no tabindex > 0 |
| Visible focus indicator | 2px accent-colored ring with 2px offset (never suppressed) |
| Skip navigation | "Skip to content" link as first focusable element |
| Modal focus trap | Focus cycles within dialog, Escape to dismiss |
| Dropdown navigation | Arrow keys for options, Enter to select, Escape to close |
| Grid navigation | Arrow keys for cell navigation, Enter to edit |
| No keyboard traps | Every component can be exited via keyboard |
| Shortcut conflicts | No shortcuts conflict with OS or screen reader shortcuts |

### 26.4 Color & Contrast

| Requirement | Implementation |
|---|---|
| Text contrast | 4.5:1 minimum for body text, 3:1 for large text (WCAG AA) |
| Non-text contrast | 3:1 for UI components and graphical objects |
| Color not sole indicator | All color-coded information has text/icon supplement (status badges include label, chart elements include patterns) |
| High contrast mode | System high contrast settings respected; custom high-contrast theme available |

### 26.5 Motion & Animation

| Requirement | Implementation |
|---|---|
| Reduce motion | Respects `prefers-reduced-motion` system setting |
| No auto-playing | No content auto-plays, auto-scrolls, or auto-updates without user control |
| Animation duration | All animations < 500ms, transitions < 300ms |
| Flashing content | No content flashes more than 3 times per second |

### 26.6 Touch Accessibility

| Requirement | Implementation |
|---|---|
| Touch target size | 44x44 points minimum (Apple HIG), 64x64 in Kitchen Mode |
| Touch target spacing | 8px minimum between adjacent targets |
| Gesture alternatives | All swipe/pinch gestures have button alternatives |
| Long press | Long press actions have alternative menu access |
| Error prevention | Confirmation for destructive actions, undo available |

### 26.7 Internationalization Readiness

| Aspect | Implementation |
|---|---|
| Text direction | RTL support for Arabic (primary market: UAE) |
| Text expansion | Layout accommodates 50% text expansion for translations |
| Number formatting | Locale-aware number and currency formatting |
| Date formatting | Locale-aware date formatting (DD/MM/YYYY for UAE) |
| Unicode | Full Unicode support including Arabic script |

---

## 27. Animation & Motion

### 27.1 Motion Principles

1. **Purposeful**: Every animation communicates spatial relationships, state changes, or feedback
2. **Swift**: Animations are fast enough to not impede workflow (max 300ms for transitions)
3. **Natural**: Easing curves follow iOS spring dynamics
4. **Respectful**: Honor `prefers-reduced-motion`

### 27.2 Transition Specifications

| Transition | Duration | Easing | Description |
|---|---|---|---|
| Page transition | 250ms | `ease-in-out` | Slide from right (push), slide from left (pop) |
| Modal open | 250ms | `ease-out` | Scale from 0.95 + fade in, backdrop fade |
| Modal close | 200ms | `ease-in` | Scale to 0.95 + fade out |
| Sheet open | 300ms | `spring(1, 80, 12)` | Slide from bottom/right with spring |
| Sheet close | 250ms | `ease-in` | Slide to bottom/right |
| Dropdown open | 150ms | `ease-out` | Scale Y from 0.95 + fade in |
| Dropdown close | 100ms | `ease-in` | Scale Y to 0.95 + fade out |
| Tab switch | 200ms | `ease-in-out` | Cross-fade content |
| Sidebar collapse | 200ms | `ease-in-out` | Width animation with content fade |
| Toast appear | 300ms | `spring(1, 80, 12)` | Slide from top with spring |
| Toast dismiss | 200ms | `ease-in` | Slide up + fade |
| Button press | 100ms | `ease-out` | Scale to 0.97, back to 1.0 |
| Card hover | 150ms | `ease-out` | Elevation increase (shadow) |
| Row hover | 100ms | `ease-out` | Background color fade |
| Skeleton pulse | 1500ms | `ease-in-out` | Opacity 0.4 to 0.7 (infinite loop) |
| Progress bar | 300ms | `ease-out` | Width transition |
| Badge count | 200ms | `spring(1, 100, 10)` | Scale bounce |
| Drag and drop | -- | real-time | Item follows pointer, drop zone highlights |

### 27.3 Reduced Motion Alternatives

When `prefers-reduced-motion: reduce` is active:
- All animations replaced with instant state changes (opacity 0 to 1, no transforms)
- Skeleton loaders use static opacity (no pulse)
- Drag-and-drop maintains visual feedback but without spring physics
- Page transitions use cross-fade only (no slide)

---

## 28. Error States & Empty States

### 28.1 Error States

**Network Error:**
```
+-------------------------------------------+
|                                           |
|  [Cloud-off icon]                         |
|                                           |
|  Unable to connect                        |
|  Check your internet connection           |
|  and try again.                           |
|                                           |
|  [Retry]  [Work Offline]                  |
+-------------------------------------------+
```

**Not Found (404):**
```
+-------------------------------------------+
|                                           |
|  [Search icon]                            |
|                                           |
|  Recipe not found                         |
|  This recipe may have been deleted        |
|  or you may not have access.              |
|                                           |
|  [Go to Recipes]  [Go to Dashboard]      |
+-------------------------------------------+
```

**Permission Denied:**
```
+-------------------------------------------+
|                                           |
|  [Lock icon]                              |
|                                           |
|  Access restricted                        |
|  You don't have permission to view        |
|  this page. Contact your administrator.   |
|                                           |
|  [Request Access]  [Go Back]             |
+-------------------------------------------+
```

**Server Error (500):**
```
+-------------------------------------------+
|                                           |
|  [Warning icon]                           |
|                                           |
|  Something went wrong                     |
|  We're working on fixing this.            |
|  Please try again in a few minutes.       |
|                                           |
|  Error ID: ERR-2026-0725-001              |
|  [Retry]  [Report Issue]                  |
+-------------------------------------------+
```

**Form Validation Errors:**
- Inline error messages below fields (red text, `body-sm`)
- Error icon inside input field (right side)
- Scroll to first error on form submission
- Error count in submit button: "Fix 3 errors"
- Toast summary: "Please fix the highlighted fields"

**Save Failure:**
```
+-------------------------------------------+
| [!] Save failed                           |
| Your changes were saved locally and will  |
| be synced when the issue is resolved.     |
| [Retry] [Dismiss]                         |
+-------------------------------------------+
```

### 28.2 Empty States

**No Recipes:**
```
+-------------------------------------------+
|                                           |
|  [Chef hat illustration]                  |
|                                           |
|  Your recipe collection is empty          |
|  Create your first recipe or import       |
|  from an existing file.                   |
|                                           |
|  [Create Recipe]  [Import from File]      |
+-------------------------------------------+
```

**No Search Results:**
```
+-------------------------------------------+
|                                           |
|  [Magnifying glass illustration]          |
|                                           |
|  No results for "chicken cacciatore"      |
|  Try different keywords or remove some    |
|  filters.                                 |
|                                           |
|  [Clear Filters]                          |
+-------------------------------------------+
```

**No Products:**
```
+-------------------------------------------+
|                                           |
|  [Shopping basket illustration]           |
|                                           |
|  No products in your database             |
|  Import your product list to get          |
|  started with cost calculations.          |
|                                           |
|  [Import Products]  [Add Manually]        |
+-------------------------------------------+
```

**Empty Dashboard (New Account):**
```
+-------------------------------------------+
|                                           |
|  Welcome to CulinaryCore                  |
|                                           |
|  Get started in 3 steps:                  |
|                                           |
|  1. [x] Create your account              |
|  2. [ ] Import your product list          |
|  3. [ ] Create your first recipe          |
|                                           |
|  [Import Products] [Create Recipe]        |
+-------------------------------------------+
```

**No Notifications:**
```
+-------------------------------------------+
|                                           |
|  [Bell illustration]                      |
|                                           |
|  All caught up                            |
|  No new notifications.                    |
+-------------------------------------------+
```

### 28.3 Loading States

**Full Page Load:**
- App shell (sidebar + toolbar) renders immediately
- Content area shows skeleton placeholders
- Skeleton matches expected content layout (cards, table rows, text blocks)
- Duration: Replace with real content within 1 second target

**Inline Loading:**
- Table data: Skeleton rows with shimmer effect
- Cards: Grey placeholder with rounded corners
- Charts: Outlined chart area with centered spinner
- Form fields: Disabled with subtle pulse

**Action Loading:**
- Buttons: Replace label with spinner, maintain button width, disable
- Save: "Saving..." with spinner, then "Saved" with checkmark (2-second display)
- Delete: "Deleting..." with spinner
- Import: Progress bar with percentage and current item

**Pull-to-Refresh (Mobile/Tablet):**
- Custom refresh indicator matching app theme
- Shows at top of scrollable content
- Spinner + "Updating..." text
- Completes with haptic feedback

---

## Appendix A: Design Token Reference

Complete token listing for implementation:

```css
/* Color Tokens -- Light Mode */
--cc-bg-primary: #FFFFFF;
--cc-bg-secondary: #F5F5F7;
--cc-bg-tertiary: #E8E8ED;
--cc-bg-elevated: #FFFFFF;
--cc-surface-primary: #FFFFFF;
--cc-surface-secondary: #F9F9FB;
--cc-text-primary: #1D1D1F;
--cc-text-secondary: #6E6E73;
--cc-text-tertiary: #AEAEB2;
--cc-border-primary: #D2D2D7;
--cc-border-secondary: #E5E5EA;
--cc-accent-primary: #0071E3;
--cc-accent-hover: #0077ED;
--cc-success: #34C759;
--cc-warning: #FF9500;
--cc-danger: #FF3B30;
--cc-info: #5AC8FA;

/* Spacing Tokens */
--cc-space-1: 4px;
--cc-space-2: 8px;
--cc-space-3: 12px;
--cc-space-4: 16px;
--cc-space-5: 20px;
--cc-space-6: 24px;
--cc-space-8: 32px;
--cc-space-10: 40px;
--cc-space-12: 48px;
--cc-space-16: 64px;

/* Radius Tokens */
--cc-radius-sm: 6px;
--cc-radius-md: 10px;
--cc-radius-lg: 14px;
--cc-radius-xl: 20px;
--cc-radius-full: 9999px;

/* Shadow Tokens */
--cc-shadow-sm: 0 1px 2px rgba(0,0,0,0.05);
--cc-shadow-md: 0 4px 12px rgba(0,0,0,0.08);
--cc-shadow-lg: 0 8px 24px rgba(0,0,0,0.12);
--cc-shadow-xl: 0 16px 48px rgba(0,0,0,0.16);

/* Z-Index Tokens */
--cc-z-base: 0;
--cc-z-sticky: 100;
--cc-z-dropdown: 200;
--cc-z-modal-backdrop: 300;
--cc-z-modal: 400;
--cc-z-popover: 500;
--cc-z-tooltip: 600;
--cc-z-toast: 700;
--cc-z-command-palette: 800;

/* Motion Tokens */
--cc-motion-fast: 100ms;
--cc-motion-normal: 200ms;
--cc-motion-slow: 300ms;
--cc-motion-ease-in: cubic-bezier(0.4, 0, 1, 1);
--cc-motion-ease-out: cubic-bezier(0, 0, 0.2, 1);
--cc-motion-ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);
--cc-motion-spring: cubic-bezier(0.175, 0.885, 0.32, 1.275);
```

---

## Appendix B: Component State Matrix

Each interactive component supports these visual states:

| State | Description | Visual Treatment |
|---|---|---|
| Default | Resting state | Standard appearance |
| Hover | Mouse over (desktop only) | Subtle background change, cursor change |
| Focus | Keyboard focus | 2px accent ring with 2px offset |
| Active/Pressed | Being clicked/tapped | Scale 0.97, darker background |
| Disabled | Not interactive | 50% opacity, no cursor change, `aria-disabled` |
| Loading | Waiting for async operation | Spinner overlay, disabled interaction |
| Error | Validation failure | Red border, error message below |
| Success | Action completed | Green border/flash, success message |
| Selected | Currently chosen | Accent background fill or border |
| Dragging | Being dragged | Elevated shadow, slight rotation, placeholder in original position |
| Drop Target | Valid drop zone | Dashed accent border, light accent background |

---

## Appendix C: Responsive Behavior Summary

| Component | Desktop (>=1280) | Tablet (768-1279) | Mobile (<768) |
|---|---|---|---|
| Sidebar | Persistent, 260px | Overlay, swipe to reveal | Hidden, bottom tab bar |
| Data tables | Full columns, scroll | Reduced columns, scroll | Card list or minimal columns |
| Recipe editor | Tabs + side panel | Tabs, stacked panels | Single column, vertical tabs |
| Dashboard KPIs | 4-column grid | 2x2 grid | Vertical stack |
| Charts | Full size | Full size | Simplified / sparklines |
| Dialogs | Centered modal | Centered modal | Full screen sheet |
| Action buttons | Inline | Inline | Bottom action bar |
| Navigation | Sidebar + breadcrumbs | Tab bar + nav bar | Tab bar + nav bar |
| Search | Sidebar field + Cmd+K | Nav bar field | Pull-down search |
| AI panel | Side panel (360px) | Bottom sheet | Full screen |
| Product list | Spreadsheet (31 cols) | Spreadsheet (key cols) | Card list (5 fields) |
| Menu builder | Drag-and-drop columns | Drag-and-drop | Vertical list + reorder |

---

## 29. Competitive Readiness Screens — Operations, Finance & Workforce

These screens are required additions to the application shell. They must use the approved CPSM design tokens, role-based visibility, light/dark themes, responsive layouts, keyboard/touch support and complete loading/empty/error/offline states.

| Screen | Primary user outcome | Mandatory interactions |
|---|---|---|
| Operations command centre | See exceptions across safety, stock, labour, tasks and service readiness. | Location/period filters, severity triage, assignment, drill-through and acknowledgement. |
| Schedule and labour | Build safe, demand-aware schedules and compare plan to actual. | Station/role grid, availability/conflict warnings, shift swap/leave approvals, labour forecast vs actual. |
| Food safety & HACCP | Complete checks and prove compliance under audit. | Time-bound checklists, photo/temperature evidence, corrective action, signature, QR equipment/location context. |
| Lot/recall workspace | Locate and isolate affected food fast. | Lot genealogy, expiry/hold state, affected recipe/menu/site view, bulk action, evidence timeline and closure approval. |
| Receiving & invoice match | Receive goods and resolve financial discrepancies. | Scan/camera/OCR entry, PO/GRN/invoice side-by-side comparison, tolerance explanation, credit-note and approval flow. |
| Transfers & commissary | Move stock/production between sites with chain of custody. | Request, pack, dispatch, in-transit, receive, variance and transfer-price visibility. |
| Integration health | Operate connected POS/accounting/IoT systems safely. | Sync status, data freshness, exception retry, connector permissions and correlation ID. |

### 29.1 Safety and financial UX rules

- Never use a green check alone to represent food-safe, matched, paid or compliant; include a named status, timestamp, source and actor.
- Recall, blocked-lot, failed HACCP and payroll/accounting exception screens keep the primary corrective action visible without hiding evidence or history.
- Any AI OCR/match result shows confidence, source document and fields needing review before posting.
- Payment screens must expose only provider-approved status and reference; never collect raw card data in the application UI.

---

## 30. Workspace Architecture, Department Access & Approval UX

### 30.1 Application navigation

Reorganise the application around the following role-scoped workspaces: **Home**, **Culinary**, **Supply Chain**, **People**, **Finance & Control**, **Quality & Compliance**, **Insights** and **Administration**. “My work” is globally available and consolidates assigned tasks, approvals, shifts, policy acknowledgements and mentions. Hide unavailable workspaces; never display an inaccessible feature as a dead-end navigation item.

### 30.2 Procurement workspace

Includes requisitions, sourcing, supplier/contract management, catalogue, POs, receiving, invoices/match exceptions, transfers, assets and supplier portal administration. Every financial action displays policy status, scope, approver, data freshness, audit history and source-document evidence.

### 30.3 People workspace

Includes employee self-service, manager team/roster, attendance, leave, skills/certifications, training, restricted HR operations and approved payroll-integration status. Default views must show only the minimum data needed for the user’s job; compensation, bank, disciplinary and identity data are separately permissioned and visually marked Restricted.

### 30.4 Approval and sensitive-data UX

- One Approval Centre groups requests by urgency, type, policy step, due date and delegated status, while preserving domain-specific context.
- The decision view shows requester, requested action, scope, policy version, threshold, evidence, conflict warnings and consequence before approve/reject/return.
- The UI must block self-approval and SOD conflicts with a clear explanation; it must not suggest workarounds.
- Restricted fields are masked by default, reveal only through a logged action and are excluded from standard exports.
- Break-glass access requires a reason, displays duration and triggers audit notification.

---

*End of Document 4: UI/UX Specification*
*CulinaryCore v1.0.0*
