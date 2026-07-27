# MASTER SOFTWARE REQUIREMENTS SPECIFICATION

## CulinaryCore -- Recipe & Hospitality Management Platform

| Field | Value |
|---|---|
| Document ID | CC-SRS-001 |
| Version | 1.0.0 |
| Classification | Confidential -- Commercial |
| Status | Draft |
| Date | 2026-07-25 |
| Author | CulinaryCore Product Team |

---

## Document Control

| Version | Date | Author | Changes |
|---|---|---|---|
| 0.1.0 | 2026-07-25 | Product Team | Initial draft from workbook analysis |
| 1.0.0 | 2026-07-25 | Product Team | Complete first edition |

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [System Overview & Vision](#2-system-overview--vision)
3. [Stakeholders & User Personas](#3-stakeholders--user-personas)
4. [Module Breakdown](#4-module-breakdown)
   - 4.1 [Recipe Management](#41-recipe-management)
   - 4.2 [Sub Recipe Management](#42-sub-recipe-management)
   - 4.3 [Product / Ingredient Management](#43-product--ingredient-management)
   - 4.4 [Cost Engine](#44-cost-engine)
   - 4.5 [Nutrition Engine](#45-nutrition-engine)
   - 4.6 [Allergen Management](#46-allergen-management)
   - 4.7 [Menu Management & Engineering](#47-menu-management--engineering)
   - 4.8 [Supplier Management](#48-supplier-management)
   - 4.9 [Purchasing & Procurement](#49-purchasing--procurement)
   - 4.10 [Inventory Management](#410-inventory-management)
   - 4.11 [Production Planning](#411-production-planning)
   - 4.12 [AI Recipe Import](#412-ai-recipe-import)
   - 4.13 [AI Assistant](#413-ai-assistant)
   - 4.14 [Reporting & Analytics](#414-reporting--analytics)
   - 4.15 [User Management & RBAC](#415-user-management--rbac)
   - 4.16 [Version Control & Audit](#416-version-control--audit)
   - 4.17 [Notifications & Tasks](#417-notifications--tasks)
   - 4.18 [Document Management](#418-document-management)
5. [Non-Functional Requirements](#5-non-functional-requirements)
6. [Cross-Platform Requirements](#6-cross-platform-requirements)
7. [Integration Requirements](#7-integration-requirements)
8. [Data Migration Strategy](#8-data-migration-strategy)
9. [Future Expansion Roadmap](#9-future-expansion-roadmap)
10. [Appendices](#10-appendices)

---

# 1. Executive Summary

## 1.1 Purpose

This Master Software Requirements Specification (SRS) defines the complete functional and non-functional requirements for CulinaryCore, a commercial Recipe & Hospitality Management Platform. The document serves as the authoritative reference for all development, testing, and acceptance activities throughout the product lifecycle.

CulinaryCore is designed to replace and dramatically exceed the capabilities of two mission-critical Excel workbooks -- Recipes.xlsm (89 sheets) and Sub Rec.xlsm (250 sheets) -- that represent years of iterative operational development at a high-end restaurant group operating in the UAE. These workbooks encode sophisticated business logic for hierarchical recipe costing, yield-adjusted waste management, multi-level nutrition tracking, and menu engineering that has been refined through daily operational use.

The platform is not merely a digitization of spreadsheets. It is a ground-up commercial product designed to compete with and exceed every established player in the recipe and food cost management space, including Apicbase, Crunchtime, Yellow Dog, MarketMan, ChefTec, xtraCHEF, Computrition, Optimum Control, Meez, Galley, and Oracle Hospitality.

## 1.2 Scope

CulinaryCore encompasses the following functional domains:

- **Recipe & Sub Recipe Management**: Hierarchical recipe composition with unlimited nesting depth, yield management, and version control.
- **Product & Ingredient Management**: Comprehensive ingredient database with multi-unit conversion, supplier pricing, waste factors, and nutritional data.
- **Cost Engine**: Real-time cascading cost calculations with configurable security margins, waste adjustments, and multi-currency support.
- **Nutrition Engine**: Automatic nutrition inheritance through the product-to-sub-recipe-to-recipe hierarchy with regulatory-compliant labeling.
- **Menu Management & Engineering**: Menu construction, profitability analysis, menu engineering matrices, and dynamic pricing.
- **Supplier & Procurement**: Supplier relationship management, purchase ordering, bid comparison, and contract management.
- **Inventory Management**: Real-time stock tracking, waste logging, par level management, and automated reorder points.
- **Production Planning**: Prep list generation, batch scaling, production scheduling, and kitchen display integration.
- **AI-Powered Features**: Intelligent recipe import from any format, conversational assistant, cost optimization suggestions, and predictive analytics.
- **Reporting & Analytics**: Comprehensive dashboards, food cost analysis, trend reporting, and exportable reports.
- **Platform Infrastructure**: Multi-tenant architecture, offline-first synchronization, role-based access control, audit logging, and cross-platform deployment.

## 1.3 Business Justification

The existing Excel-based system, while functionally rich, suffers from fundamental limitations:

1. **Single-user bottleneck**: Only one person can edit a workbook at a time, creating operational delays during service.
2. **No audit trail**: Changes to recipes, costs, or products cannot be tracked or reversed.
3. **Manual synchronization**: The link between Product List, Sub Recipes, and Recipes requires manual maintenance and is fragile.
4. **No mobile access**: Kitchen staff cannot access recipe details on tablets or phones during service.
5. **Scale ceiling**: With 85 recipes and 245 sub recipes across 339 sheets, the workbooks are approaching Excel's practical performance limits.
6. **No real-time costing**: Price changes from suppliers require manual propagation through hundreds of formulas.
7. **Data integrity risk**: A single corrupted formula or accidental deletion can cascade errors across the entire system.
8. **No multi-location support**: Expanding to additional restaurants requires duplicating and maintaining separate workbooks.

CulinaryCore addresses every one of these limitations while adding capabilities that no spreadsheet can provide: AI-powered recipe import, real-time collaboration, automated purchasing, predictive analytics, and regulatory compliance automation.

## 1.4 Competitive Positioning

CulinaryCore's competitive advantage is rooted in four pillars:

1. **Depth of costing logic**: The waste-adjusted, yield-normalized, margin-secured costing engine derived from years of real-world refinement surpasses the simplified cost models in competing products.
2. **AI-native architecture**: Unlike competitors that bolt AI onto legacy systems, CulinaryCore is built from the ground up with an AI abstraction layer that supports multiple providers (OpenAI, Anthropic, Gemini, Apple Foundation Models).
3. **Apple ecosystem integration**: First-class support for Face ID, Handoff, Spotlight, Shortcuts, and Apple Watch makes CulinaryCore the only platform that truly leverages the Apple ecosystem that dominates professional kitchens.
4. **Offline-first design**: Full functionality without internet connectivity, with conflict-free synchronization when connectivity returns, addresses the reality of kitchen environments.

## 1.5 Document Conventions

Throughout this document:

- **SHALL** indicates a mandatory requirement.
- **SHOULD** indicates a strongly recommended requirement.
- **MAY** indicates an optional requirement.
- **[WB-REF]** indicates a requirement derived directly from workbook analysis.
- **[COMP-ADV]** indicates a requirement designed to exceed competitor capabilities.
- **[AI-FEAT]** indicates a requirement leveraging artificial intelligence.
- Requirement IDs follow the pattern: MODULE-CATEGORY-NUMBER (e.g., RCP-FUNC-001).

---

# 2. System Overview & Vision

## 2.1 Product Vision

CulinaryCore will be the definitive recipe and hospitality management platform -- the system that every chef, restaurant operator, and food service professional reaches for first, because it understands their work the way they do.

The platform transforms the art of recipe management into a precisely engineered discipline while preserving the creativity and intuition that define great cooking. It bridges the gap between the kitchen (where recipes live as sensory experiences) and the office (where recipes must be cost centers, nutritional declarations, and compliance documents).

## 2.2 Design Philosophy

### 2.2.1 Kitchen-First Design

Every interface decision is evaluated against the reality of a professional kitchen: wet hands, flour-dusted screens, time pressure during service, limited counter space for devices, and the need to glance rather than read. Interfaces must be:

- Operable with one hand
- Readable at arm's length
- Responsive within 200ms
- Tolerant of imprecise touch input
- Functional in bright and dim lighting conditions

### 2.2.2 Data Integrity Above All

The system must guarantee that cost calculations, nutrition data, and inventory figures are always correct, consistent, and current. This means:

- No stale caches for financial data
- Immediate propagation of price changes through the cost hierarchy
- Transactional consistency for all write operations
- Conflict resolution that never silently loses data

### 2.2.3 Progressive Disclosure

The system serves users ranging from line cooks who need to see a recipe to CFOs who need cost analytics. The interface must present the right level of detail to each user without overwhelming novices or frustrating experts.

### 2.2.4 Offline as a First-Class Citizen

Internet connectivity in kitchens and storage areas is unreliable. The system must be fully functional offline for all read operations and most write operations, with transparent synchronization when connectivity returns.

## 2.3 System Architecture Overview

```
+------------------------------------------------------------------+
|                      CLIENT APPLICATIONS                          |
|  +------------+  +-----------+  +----------+  +----------------+  |
|  | Web (React)|  | macOS     |  | iPadOS   |  | iOS (iPhone)   |  |
|  | TypeScript |  | (Tauri/   |  | (Tauri/  |  | (Tauri/        |  |
|  | Tailwind   |  |  Capacitor|  |  Native) |  |  Capacitor)    |  |
|  +------------+  +-----------+  +----------+  +----------------+  |
+------------------------------------------------------------------+
                              |
                    [Offline-First Sync Layer]
                              |
+------------------------------------------------------------------+
|                      SUPABASE BACKEND                             |
|  +----------------+  +----------------+  +--------------------+   |
|  | Auth (Row-Level|  | Realtime       |  | Edge Functions     |   |
|  |  Security)     |  | Subscriptions  |  | (Business Logic)   |   |
|  +----------------+  +----------------+  +--------------------+   |
|  +----------------+  +----------------+  +--------------------+   |
|  | PostgreSQL     |  | Storage        |  | AI Abstraction     |   |
|  | (Primary DB)   |  | (Documents,    |  | Layer (OpenAI,     |   |
|  |                |  |  Images)       |  |  Anthropic, etc.)  |   |
|  +----------------+  +----------------+  +--------------------+   |
+------------------------------------------------------------------+
                              |
+------------------------------------------------------------------+
|                   EXTERNAL INTEGRATIONS                           |
|  +----------+  +----------+  +---------+  +-------------------+   |
|  | Supplier  |  | POS      |  | Account-|  | Regulatory        |   |
|  | APIs      |  | Systems  |  | ing     |  | Databases         |   |
|  +----------+  +----------+  +---------+  +-------------------+   |
+------------------------------------------------------------------+
```

## 2.4 Technology Stack

| Layer | Technology | Rationale |
|---|---|---|
| Frontend Framework | React 18+ with TypeScript | Component-based architecture, massive ecosystem, TypeScript for type safety |
| Styling | Tailwind CSS + shadcn/ui | Utility-first CSS for rapid development, shadcn/ui for accessible, customizable components |
| State Management | Zustand + TanStack Query | Lightweight global state with powerful server state management and caching |
| Backend | Supabase (PostgreSQL) | Open-source Firebase alternative with Row Level Security, real-time subscriptions, and edge functions |
| Database | PostgreSQL 15+ | Industry-standard relational database with JSON support, full-text search, and PostGIS |
| Authentication | Supabase Auth + Apple Sign In | Multi-provider auth with native Apple ecosystem integration |
| File Storage | Supabase Storage | S3-compatible storage with CDN, image transformations, and access control |
| AI Layer | Custom abstraction over OpenAI, Anthropic, Gemini, Apple Foundation Models | Provider-agnostic AI integration for flexibility and cost optimization |
| Cross-Platform | Capacitor (iOS/iPadOS) + Tauri (macOS) | Native shell around web app for platform-specific features |
| Offline Storage | IndexedDB (Dexie.js) + SQLite (native) | Client-side persistence for offline-first architecture |
| Testing | Vitest + Playwright + React Testing Library | Comprehensive unit, integration, and end-to-end testing |

## 2.5 Key Design Decisions

### 2.5.1 Why Supabase Over Custom Backend

Supabase provides Row Level Security (RLS) policies directly in PostgreSQL, eliminating an entire class of authorization bugs. Its real-time subscription system enables live cost updates across all connected clients. The hosted infrastructure reduces operational overhead while the open-source nature avoids vendor lock-in.

### 2.5.2 Why Offline-First Over Online-Only

Kitchen environments have notoriously unreliable connectivity. Walk-in coolers, basement storage areas, and outdoor service spaces frequently have no signal. An online-only application would be unusable in precisely the moments when staff need it most -- during receiving, inventory counts, and service prep.

### 2.5.3 Why AI Abstraction Layer

The AI landscape is evolving rapidly. Locking into a single provider would be a strategic risk. The abstraction layer allows the platform to:

- Route different task types to the most capable/cost-effective provider
- Fall back to alternative providers during outages
- Leverage on-device Apple Foundation Models for privacy-sensitive operations
- Adopt new providers as they emerge without code changes

### 2.5.4 Why Single Codebase for Cross-Platform

Maintaining separate native codebases for web, macOS, iPadOS, and iOS would quadruple development and testing effort. A single React codebase wrapped in platform-specific shells (Capacitor for iOS/iPadOS, Tauri for macOS) provides 95% code reuse while still accessing native APIs for platform-specific features like Face ID, Handoff, and Spotlight.

## 2.6 Glossary of Terms

| Term | Definition |
|---|---|
| **Base Unit** | The fundamental unit of measurement for a product (g, ml, ea) |
| **Batch** | A single production run of a sub recipe, producing a defined quantity |
| **Contribution Margin** | Selling price minus total food cost (including security margin) |
| **Cost/U** | Cost per base unit of a product |
| **Food Cost %** | Total recipe cost divided by selling price, expressed as a percentage |
| **Gross Qty** | The quantity of an ingredient before waste removal (Gross = 100 * Nett / (100 - Ref%)) |
| **Nett Qty** | The usable quantity of an ingredient after waste removal |
| **PPC** | Pieces Per Case -- the number of individual items in a supplier's case |
| **Ref%** | Reference waste percentage -- the expected waste for a product (peeling, trimming, etc.) |
| **Security Margin** | A configurable percentage (default 5%) added to total cost as a buffer |
| **Sub Recipe** | An intermediate preparation (sauce, dough, mousse) that is an ingredient in finished recipes |
| **UPP** | Units Per Pack -- the number of base units in a single pack |
| **Working Unit** | The unit of measurement used in recipe composition (may differ from Base Unit) |
| **Yield** | The number of portions or servings produced by a recipe |
| **Yield %** | The percentage of gross product that is usable (100 - Ref%) |

---

# 3. Stakeholders & User Personas

## 3.1 Stakeholder Map

### 3.1.1 Primary Stakeholders

| Stakeholder | Interest | Influence | Key Concerns |
|---|---|---|---|
| Executive Chef | Recipe accuracy, kitchen efficiency | High | Speed of access, recipe integrity, creative freedom |
| Restaurant Owner/GM | Cost control, profitability | Very High | Food cost %, ROI, competitive positioning |
| Sous Chefs | Daily prep, recipe execution | Medium | Ease of use, offline access, scaling |
| Purchasing Manager | Supplier management, cost optimization | High | Price tracking, order automation, supplier comparison |
| Finance/Accounting | Cost reporting, margin analysis | High | Data accuracy, export capabilities, audit trails |
| Line Cooks | Recipe reference during service | Low | Simple interface, fast loading, clear instructions |
| Nutritionist/Compliance | Nutritional accuracy, allergen safety | Medium | Regulatory compliance, label generation |
| IT Administrator | System maintenance, security | Medium | Uptime, security, integration capabilities |

### 3.1.2 Secondary Stakeholders

| Stakeholder | Interest | Influence |
|---|---|---|
| Suppliers | Order processing, catalog management | Low |
| Health Inspectors | Compliance documentation | Low |
| Customers | Allergen information, nutritional data | Low |
| Investors | Platform growth, market positioning | Medium |

## 3.2 User Personas

### 3.2.1 Persona: Chef Khalid -- Executive Chef

**Demographics**: Male, 42, 20 years experience, manages 3 restaurant locations in Dubai

**Goals**:
- Maintain consistent recipe quality across all locations
- Control food costs below 30% target
- Develop new menu items with accurate costing before launch
- Train junior chefs efficiently

**Pain Points**:
- Currently spends 2+ hours weekly updating Excel workbooks
- Cannot access recipes on his iPad during kitchen walkabouts
- Fears data loss from corrupted Excel files
- Cannot track which chef modified a recipe

**Technology Comfort**: Comfortable with iPad and iPhone; uses Excel daily but dislikes formula complexity

**Quote**: "I need to see my food cost percentage the moment I change an ingredient, not after twenty minutes of spreadsheet recalculation."

**Key Scenarios**:
1. Creates a new dish during R&D, needs immediate cost feedback
2. Reviews food cost trends across all locations on Monday morning
3. Adjusts portion sizes based on customer feedback, needs instant cost recalculation
4. Scales a recipe from 10 to 200 portions for a catering event

### 3.2.2 Persona: Sarah -- Purchasing Manager

**Demographics**: Female, 35, 8 years in hospitality procurement

**Goals**:
- Negotiate best prices with suppliers
- Ensure consistent supply chain across locations
- Reduce waste and over-ordering
- Track price fluctuations over time

**Pain Points**:
- Manually copies supplier prices into the Product List
- No visibility into which recipes are affected when a product price changes
- Cannot generate purchase orders from the system
- Spends hours on phone/email with suppliers for price quotes

**Technology Comfort**: Proficient with Excel, email, and basic web applications

**Quote**: "When lamb prices jump 15%, I need to know within minutes which menu items are now unprofitable, not after a manual audit."

**Key Scenarios**:
1. Receives updated price list from supplier, needs to assess impact on all affected recipes
2. Compares quotes from three suppliers for the same ingredient category
3. Generates weekly purchase orders based on production plans and current inventory
4. Identifies substitute ingredients when a product becomes unavailable

### 3.2.3 Persona: Marco -- Sous Chef

**Demographics**: Male, 28, 5 years experience, works the morning prep shift

**Goals**:
- Execute prep lists accurately and efficiently
- Scale recipes for daily production needs
- Maintain quality standards set by Executive Chef
- Learn and grow professionally

**Pain Points**:
- Prep lists are handwritten from memory, leading to errors
- Cannot access sub recipe details without going to the office computer
- Scaling calculations done manually, prone to math errors
- No way to log prep completion or waste

**Technology Comfort**: Very comfortable with smartphone; less so with computers

**Quote**: "I need my prep list on a tablet I can wipe down, with quantities I can trust, right next to my station."

**Key Scenarios**:
1. Arrives at 6 AM, needs the day's prep list with scaled quantities
2. Runs low on chimichurri, needs to quickly make a half batch
3. Receives a case of fish with higher-than-expected waste, needs to adjust
4. Checks allergen information when a server asks about a dish

### 3.2.4 Persona: Fatima -- Restaurant Group Owner

**Demographics**: Female, 50, owns a group of 5 restaurants across the UAE

**Goals**:
- Maximize profitability across all locations
- Ensure brand consistency
- Make data-driven decisions about menu composition
- Plan expansion with confidence

**Pain Points**:
- No consolidated view of food costs across locations
- Menu engineering decisions based on intuition rather than data
- Cannot compare performance between locations
- Financial reports from restaurants arrive late and in inconsistent formats

**Technology Comfort**: Uses iPhone and MacBook; prefers dashboards over spreadsheets

**Quote**: "I want to open my laptop on Sunday evening and see exactly which dishes are making money and which are costing me, across every restaurant."

**Key Scenarios**:
1. Monthly review of food cost percentages across all locations
2. Decision on whether to keep or replace underperforming menu items
3. Planning a new restaurant opening with standardized recipes and costs
4. Reviewing the impact of a 10% price increase on contribution margins

### 3.2.5 Persona: Ali -- Line Cook

**Demographics**: Male, 22, 2 years experience, works the grill station

**Goals**:
- Execute recipes correctly during high-pressure service
- Know exact portion sizes and plating specifications
- Access allergen information quickly when servers ask
- Avoid mistakes that waste ingredients

**Pain Points**:
- Paper recipe cards get damaged, lost, or outdated
- No photos showing final plating
- Cannot check allergen information without leaving the station
- Portion sizes sometimes vary between shifts

**Technology Comfort**: Very comfortable with smartphone; grew up with technology

**Quote**: "Show me the picture, the portions, and the allergens. That's all I need during service."

**Key Scenarios**:
1. Needs to verify portion size for tenderloin during service rush
2. Server asks if the molten cake contains nuts
3. New dish added to menu, needs to learn the recipe
4. Runs the station alone and needs step-by-step instructions

### 3.2.6 Persona: Dr. Noor -- Nutritionist/Compliance Officer

**Demographics**: Female, 38, food science background, part-time consultant

**Goals**:
- Ensure all nutrition labels are accurate and regulatory-compliant
- Track allergen declarations across the menu
- Generate nutrition reports for health authority submissions
- Advise on healthier menu options

**Pain Points**:
- Nutrition calculations in Excel are complex and error-prone
- No automated allergen tracking
- Cannot generate regulation-compliant nutrition labels
- Manual cross-referencing between recipes and nutrition databases

**Technology Comfort**: Proficient with scientific databases and Excel; expects professional software

**Quote**: "I need nutrition data I can certify. That means traceable calculations, proper rounding rules, and labels that meet UAE and international standards."

**Key Scenarios**:
1. Calculates nutrition facts for a new menu item
2. Audits allergen declarations across the entire menu
3. Generates a nutrition report for the municipality health inspection
4. Advises the chef on reducing sodium in a dish while maintaining flavor

### 3.2.7 Persona: Raj -- IT Administrator

**Demographics**: Male, 31, manages technology for the restaurant group

**Goals**:
- Ensure system uptime and security
- Manage user accounts and permissions
- Integrate with existing POS and accounting systems
- Minimize support tickets from kitchen staff

**Pain Points**:
- Excel files on shared drives create version conflicts
- No centralized user management for kitchen systems
- Backup and recovery of Excel files is manual
- Cannot audit who accessed or changed what data

**Technology Comfort**: Highly technical; manages multiple cloud services

**Quote**: "I need a system that doesn't generate support tickets at 10 PM on a Friday when the network goes down and nobody can access recipes."

**Key Scenarios**:
1. Onboards a new sous chef with appropriate access permissions
2. Investigates who changed a recipe cost that seems incorrect
3. Configures integration between CulinaryCore and the POS system
4. Responds to a network outage -- system must continue working offline

## 3.3 User Role Hierarchy

```
Organization Owner
    |
    +-- Organization Admin
    |       |
    |       +-- Location Manager
    |       |       |
    |       |       +-- Executive Chef
    |       |       |       |
    |       |       |       +-- Sous Chef
    |       |       |       |       |
    |       |       |       |       +-- Line Cook
    |       |       |       |       +-- Pastry Chef
    |       |       |       |       +-- Prep Cook
    |       |       |       |
    |       |       |       +-- Kitchen Manager
    |       |       |
    |       |       +-- Purchasing Manager
    |       |       |       |
    |       |       |       +-- Purchasing Agent
    |       |       |
    |       |       +-- F&B Manager
    |       |       +-- Finance Manager
    |       |
    |       +-- Nutritionist (Cross-location)
    |       +-- IT Administrator (Cross-location)
    |
    +-- External Auditor (Read-only)
    +-- Supplier Portal User
```

---

# 4. Module Breakdown

---

## 4.1 Recipe Management

### 4.1.1 Overview & Business Value

Recipe Management is the heart of CulinaryCore. It directly replaces the 85 individual recipe sheets in Recipes.xlsm, transforming static spreadsheet-based recipes into dynamic, version-controlled, collaboratively-editable culinary documents.

**Why this module exists**: Every operation in a food service business traces back to recipes. They determine food cost, nutritional content, allergen exposure, purchasing needs, prep schedules, and ultimately profitability. The current Excel system, while functional, treats recipes as isolated spreadsheets rather than interconnected documents in a living system. CulinaryCore treats each recipe as a rich, relational entity that participates in a web of business logic.

**Business value**:
- Eliminates the 2+ hours per week Chef Khalid spends on manual Excel updates
- Enables instant cost recalculation when any ingredient price changes
- Provides version history so recipe changes can be reviewed, compared, and reverted
- Supports multi-location recipe standardization with location-specific variations
- Enables mobile access for kitchen staff during service and prep

**Dependencies**: Product/Ingredient Management (4.3), Sub Recipe Management (4.2), Cost Engine (4.4), Nutrition Engine (4.5)

### 4.1.2 Data Model

**Recipe Entity**

| Field | Type | Source | Description |
|---|---|---|---|
| id | UUID | System | Primary key |
| organization_id | UUID | System | Multi-tenant isolation |
| name | String(200) | User | Recipe name (e.g., "TENDERLOIN PEPPER") |
| category_id | FK | User | Reference to category (e.g., "05.MAINS") [WB-REF: Set Up sheet] |
| status | Enum | User | Actual, Pending, Update, NEW [WB-REF: Set Up sheet] |
| yield_qty | Decimal | User | Number of portions/servings [WB-REF: Row 31] |
| yield_unit | String | User | Unit for yield (portions, servings, pieces) |
| selling_price_with_vat | Decimal | User | Menu price including VAT [WB-REF: Row 34] |
| selling_price_without_vat | Decimal | Calc | Price excluding VAT [WB-REF: Row 35] |
| vat_rate | Decimal | Config | VAT percentage (default 5% for UAE) |
| security_margin_pct | Decimal | Config | Cost buffer percentage (default 5%) [WB-REF: Row 37] |
| total_cost | Decimal | Calc | Sum of all ingredient costs [WB-REF: Row 30] |
| total_cost_with_margin | Decimal | Calc | Total cost * (1 + security_margin_pct) [WB-REF: Row 37] |
| contribution_margin | Decimal | Calc | Selling price - total cost with margin [WB-REF: Row 38] |
| food_cost_pct | Decimal | Calc | Total cost with margin / selling price * 100 [WB-REF: Row 39] |
| description | Text | User | Preparation instructions and notes |
| prep_time_minutes | Integer | User | Estimated preparation time |
| cook_time_minutes | Integer | User | Estimated cooking time |
| difficulty_level | Enum | User | Easy, Medium, Hard, Expert |
| cuisine_type | String | User | Cuisine classification |
| meal_period | String[] | User | Breakfast, Lunch, Dinner, All Day |
| station | String | User | Kitchen station assignment |
| plating_instructions | Text | User | Plating and presentation notes |
| chef_notes | Text | User | Internal notes visible only to authorized roles |
| photo_urls | String[] | System | Array of recipe/plating photos |
| video_url | String | User | Video of preparation technique |
| is_active | Boolean | User | Whether recipe is currently in use |
| is_seasonal | Boolean | User | Whether recipe is seasonal |
| season_start | Date | User | Start of availability period |
| season_end | Date | User | End of availability period |
| created_by | FK | System | User who created the recipe |
| created_at | Timestamp | System | Creation timestamp |
| updated_by | FK | System | User who last modified |
| updated_at | Timestamp | System | Last modification timestamp |
| version | Integer | System | Version counter for optimistic locking |
| published_version_id | FK | System | Currently active version |

**Recipe Ingredient Entity (Recipe Line)**

| Field | Type | Source | Description |
|---|---|---|---|
| id | UUID | System | Primary key |
| recipe_id | FK | System | Parent recipe |
| sort_order | Integer | User | Display order (1-26 in workbook, unlimited in app) [WB-REF: Template rows 4-29] |
| ingredient_type | Enum | System | 'product' or 'sub_recipe' |
| product_id | FK | User | Reference to product (if type = product) |
| sub_recipe_id | FK | User | Reference to sub recipe (if type = sub_recipe) |
| nett_qty | Decimal | User | Net quantity needed [WB-REF: Nett Qty column] |
| unit | String | Calc | Auto-populated from product/sub recipe [WB-REF: Unit column] |
| ref_pct | Decimal | Calc | Waste percentage, inherited from product [WB-REF: Ref% column] |
| gross_qty | Decimal | Calc | = (100 * nett_qty) / (100 - ref_pct) [WB-REF: Gross Qty formula] |
| cost_per_unit | Decimal | Calc | Cost per base unit from product or sub recipe [WB-REF: Cost/U column] |
| line_cost | Decimal | Calc | = gross_qty * cost_per_unit [WB-REF: Cost column] |
| is_optional | Boolean | User | Whether ingredient is optional |
| preparation_note | String | User | Specific preparation instruction for this ingredient |
| substitute_group_id | FK | User | Group of interchangeable ingredients |

### 4.1.3 Functional Requirements

#### RCP-FUNC-001: Recipe Creation

The system SHALL provide a recipe creation interface that allows users to define a new recipe with all required fields.

**Details**: The creation flow must support both guided (wizard) and expert (form) modes. The guided mode walks users through name, category, ingredients, yield, and pricing step by step. The expert mode presents a single-page form similar to the current Excel template layout for users familiar with the workbook.

**Acceptance Criteria**:
- AC1: User can create a recipe with a minimum of name and category
- AC2: User can add up to 100 ingredient lines (expanded from workbook limit of 26) [WB-REF: Template has 26 rows, but limit should be removed]
- AC3: Each ingredient line auto-populates unit and Ref% from the product database
- AC4: Total cost calculates in real-time as ingredients are added
- AC5: Food cost % updates in real-time as selling price is entered
- AC6: Recipe is saved as a draft until explicitly published

#### RCP-FUNC-002: Recipe Editing

The system SHALL allow authorized users to modify any field of an existing recipe.

**Details**: Editing a published recipe creates a new draft version. The published version remains active until the draft is explicitly published. This prevents in-progress edits from affecting kitchen operations.

**Acceptance Criteria**:
- AC1: Editing a published recipe creates a draft version
- AC2: Draft and published versions can be compared side-by-side
- AC3: All cost calculations update in real-time during editing
- AC4: Changes are auto-saved every 30 seconds
- AC5: Multiple users can edit different recipes simultaneously
- AC6: If two users attempt to edit the same recipe, the second user is notified and can choose to view the current editor's changes or create a parallel draft

#### RCP-FUNC-003: Ingredient Line Management

The system SHALL support adding, removing, reordering, and modifying ingredient lines within a recipe.

**Details**: This replicates the 26-row ingredient grid in the Excel template but removes the row limit and adds features like drag-and-drop reordering, ingredient grouping (e.g., "For the sauce", "For the garnish"), and inline search for products and sub recipes.

**Acceptance Criteria**:
- AC1: User can add an ingredient by typing its name; system provides autocomplete from products and sub recipes
- AC2: When a product is selected, Unit, Ref%, and Cost/U auto-populate [WB-REF: auto-lookup behavior]
- AC3: When Nett Qty is entered, Gross Qty calculates as (100 * Nett) / (100 - Ref%) [WB-REF: Gross Qty formula]
- AC4: Line Cost calculates as Gross Qty * Cost/U [WB-REF: Cost formula]
- AC5: Ingredient lines can be grouped under headings (e.g., "Base", "Garnish", "Sauce")
- AC6: Ingredient lines can be reordered via drag-and-drop
- AC7: Removing an ingredient line immediately recalculates total cost
- AC8: User can specify an ingredient as optional (excluded from default cost calculation)

#### RCP-FUNC-004: Cost Summary Panel

The system SHALL display a cost summary panel that mirrors and extends the workbook's cost calculation rows.

**Details**: The cost summary replicates rows 30-39 of the Excel recipe template and adds additional metrics not available in the workbook.

**Acceptance Criteria**:
- AC1: Total Cost = sum of all ingredient line costs [WB-REF: Row 30, SUMIF formula]
- AC2: Cost Per Portion = Total Cost / Yield [WB-REF: derived]
- AC3: Total Cost + Security Margin = Total Cost * (1 + margin%) [WB-REF: Row 37]
- AC4: Contribution Margin = Selling Price (excl VAT) - Total Cost with Margin [WB-REF: Row 38]
- AC5: Food Cost % = Total Cost with Margin / Selling Price (excl VAT) * 100 [WB-REF: Row 39]
- AC6: All values update in real-time (within 100ms of any input change)
- AC7: Food Cost % is color-coded: green (< 25%), yellow (25-32%), red (> 32%)
- AC8: Contribution Margin is displayed in AED with currency formatting
- AC9: Cost breakdown pie chart shows ingredient cost distribution

#### RCP-FUNC-005: Recipe Categories

The system SHALL support a configurable category system for organizing recipes.

**Details**: The default categories match the workbook's Set Up sheet, but the system allows custom categories and multi-level categorization (categories and subcategories).

**Default Categories** [WB-REF: Set Up sheet]:
1. 01.BITES
2. 02.SALADS
3. 03.COLD
4. 04.HOT
5. 05.MAINS
6. 06.GRILL
7. 07.SIDES
8. 08.BREAD
9. 09.PIZZA
10. 10.DESSERT
11. 11.KIDS MENU
12. 12.HAPPY HOUR

**Acceptance Criteria**:
- AC1: System ships with the 12 default categories from the workbook
- AC2: Users with appropriate permissions can create, rename, reorder, and deactivate categories
- AC3: Categories can have subcategories (e.g., MAINS > Beef, MAINS > Seafood)
- AC4: Each recipe belongs to exactly one category
- AC5: Categories can be assigned display colors and icons
- AC6: Recipe list can be filtered and grouped by category

#### RCP-FUNC-006: Recipe Status Workflow

The system SHALL implement a status workflow for recipes matching and extending the workbook's status system.

**Status Values** [WB-REF: Set Up sheet]:
- **Draft**: Recipe is being developed, not visible to kitchen staff
- **Pending**: Recipe is complete and awaiting review/approval
- **Actual**: Recipe is approved and active on the menu
- **Update**: An existing recipe has a pending revision
- **NEW**: A newly created recipe that has not yet been categorized as Actual
- **Archived**: Recipe has been removed from active use but retained for historical reference
- **Seasonal (Inactive)**: Recipe is valid but not currently in season

**Acceptance Criteria**:
- AC1: New recipes start in Draft status
- AC2: Status transitions follow the defined workflow (Draft -> Pending -> Actual)
- AC3: Only users with approval permission can transition from Pending to Actual
- AC4: Transitioning to Actual requires all mandatory fields to be populated
- AC5: Archived recipes are hidden from default views but searchable
- AC6: Status changes are logged in the audit trail

#### RCP-FUNC-007: Recipe Scaling

The system SHALL allow users to scale a recipe to different yield quantities while maintaining proportional ingredient amounts.

**Details**: This addresses one of the most common kitchen operations -- adjusting a recipe designed for 10 portions to serve 4 or 200. The workbook handles this manually; CulinaryCore automates it completely.

**Acceptance Criteria**:
- AC1: User can enter a target yield and all ingredient quantities scale proportionally
- AC2: Scaled recipe can be viewed without saving (temporary scaling)
- AC3: Scaled recipe can be saved as a new version or separate recipe
- AC4: Scaling accounts for ingredients that don't scale linearly (e.g., salt, yeast) via "scaling factor" overrides
- AC5: Cost summary recalculates for the scaled yield
- AC6: Scaled quantities round to practical kitchen measurements (e.g., nearest 5g for large quantities)
- AC7: User can scale by desired total cost or target food cost percentage (reverse scaling)

#### RCP-FUNC-008: Recipe Duplication

The system SHALL allow users to duplicate a recipe as a starting point for a new recipe.

**Acceptance Criteria**:
- AC1: Duplicated recipe copies all ingredient lines, quantities, and preparation notes
- AC2: Duplicated recipe receives a new name with " (Copy)" suffix
- AC3: Duplicated recipe starts in Draft status regardless of source recipe status
- AC4: Cost calculations are recalculated with current ingredient prices
- AC5: Version history starts fresh (no link to source recipe history)
- AC6: User is prompted to choose whether to copy photos and videos

#### RCP-FUNC-009: Recipe Search & Filtering

The system SHALL provide comprehensive search and filtering capabilities for recipes.

**Acceptance Criteria**:
- AC1: Full-text search across recipe name, description, and ingredient names
- AC2: Filter by category, status, food cost % range, price range, allergen presence/absence
- AC3: Filter by date range (created, modified)
- AC4: Filter by creator/modifier
- AC5: Sort by name, category, food cost %, contribution margin, date modified
- AC6: Search results display recipe name, category, food cost %, status, and thumbnail
- AC7: Search works offline using locally cached data
- AC8: Search results appear within 200ms of input

#### RCP-FUNC-010: Recipe Print & Export

The system SHALL support printing and exporting recipes in multiple formats.

**Acceptance Criteria**:
- AC1: Print-optimized recipe card layout (A4 and US Letter)
- AC2: Export to PDF with full cost details (manager version) or without costs (kitchen version)
- AC3: Export to Excel format matching the original workbook template for familiarity
- AC4: Batch export of multiple recipes
- AC5: Export includes nutrition panel and allergen declarations
- AC6: Kitchen display version: large font, critical info only, optimized for wall mounting
- AC7: QR code on printed recipe links back to the digital version

#### RCP-FUNC-011: Recipe Comparison

The system SHALL allow side-by-side comparison of two or more recipes.

**Business Value**: When developing a new dish or optimizing an existing one, chefs need to compare ingredient lists, costs, and nutrition across recipe variations.

**Acceptance Criteria**:
- AC1: Compare two recipes side by side with differences highlighted
- AC2: Compare different versions of the same recipe
- AC3: Comparison shows ingredient differences, cost differences, and nutrition differences
- AC4: Ingredients present in one recipe but not the other are clearly marked
- AC5: Cost and nutrition deltas are calculated and displayed

#### RCP-FUNC-012: Recipe Costing Scenarios

The system SHALL support "what-if" cost scenarios without modifying the actual recipe.

**Business Value**: Chefs and managers need to explore cost impacts of ingredient substitutions, price changes, or portion adjustments before committing changes.

**Acceptance Criteria**:
- AC1: User can create a scenario that overrides specific ingredient prices
- AC2: User can create a scenario that substitutes one ingredient for another
- AC3: User can create a scenario that changes portion size
- AC4: Scenario shows the cost impact compared to the current recipe
- AC5: Scenario can be applied (converting to a recipe edit) or discarded
- AC6: Multiple scenarios can be saved and compared

### 4.1.4 User Stories

| ID | Story | Priority |
|---|---|---|
| RCP-US-001 | As an Executive Chef, I want to create a new recipe with real-time cost feedback so that I can make informed decisions about menu pricing during R&D. | Must Have |
| RCP-US-002 | As a Sous Chef, I want to scale a recipe from 10 to 50 portions so that I can prep accurately for a large event without manual calculations. | Must Have |
| RCP-US-003 | As a Line Cook, I want to view a recipe on my station tablet so that I can verify portion sizes and plating during service without leaving my station. | Must Have |
| RCP-US-004 | As a Restaurant Owner, I want to see food cost % for every recipe so that I can identify unprofitable dishes and make menu engineering decisions. | Must Have |
| RCP-US-005 | As an Executive Chef, I want to compare two versions of a recipe side by side so that I can decide whether a modification improved cost or quality. | Should Have |
| RCP-US-006 | As a Purchasing Manager, I want to see which recipes use a specific ingredient so that I can assess the impact of a price change or product discontinuation. | Must Have |
| RCP-US-007 | As a Nutritionist, I want to view the complete nutrition breakdown per portion so that I can verify compliance with labeling requirements. | Must Have |
| RCP-US-008 | As a Sous Chef, I want to print a cost-free version of a recipe for the kitchen wall so that sensitive financial data is not displayed to all staff. | Should Have |
| RCP-US-009 | As an Executive Chef, I want to run a what-if scenario replacing an expensive ingredient so that I can find cost-effective alternatives without modifying the live recipe. | Should Have |
| RCP-US-010 | As a Restaurant Owner, I want all recipes organized by the 12 standard categories so that I can quickly navigate to any section of the menu. | Must Have |

### 4.1.5 Business Rules

| ID | Rule | Source |
|---|---|---|
| RCP-BR-001 | Total Cost SHALL be calculated as the sum of all non-optional ingredient line costs. | WB: Row 30 SUMIF |
| RCP-BR-002 | Gross Qty SHALL be calculated as (100 * Nett Qty) / (100 - Ref%). | WB: Gross Qty formula |
| RCP-BR-003 | Line Cost SHALL be calculated as Gross Qty * Cost per Unit. | WB: Cost column |
| RCP-BR-004 | Total Cost with Security Margin SHALL be Total Cost * (1 + Security Margin %). Default margin is 5%. | WB: Row 37 |
| RCP-BR-005 | Contribution Margin SHALL be Selling Price (excl. VAT) - Total Cost with Security Margin. | WB: Row 38 |
| RCP-BR-006 | Food Cost % SHALL be (Total Cost with Security Margin / Selling Price excl. VAT) * 100. | WB: Row 39 |
| RCP-BR-007 | Selling Price excl. VAT SHALL be Selling Price with VAT / (1 + VAT Rate). | WB: Row 35 |
| RCP-BR-008 | When an ingredient's cost changes, all recipes containing that ingredient SHALL recalculate immediately. | System integrity |
| RCP-BR-009 | A recipe SHALL NOT be set to Actual status without a valid selling price. | Data integrity |
| RCP-BR-010 | The system SHALL enforce the status workflow: Draft -> Pending -> Actual. Direct Draft -> Actual is not permitted. | Process control |

### 4.1.6 Future Enhancements

- **AI Recipe Generation**: Generate complete recipes from a description (e.g., "Create a Mediterranean-inspired fish main course with food cost under 28%")
- **Collaborative Editing**: Real-time multi-user editing of the same recipe with presence indicators
- **Recipe Scoring**: AI-powered scoring for flavor balance, technique complexity, and presentation potential
- **Customer Feedback Integration**: Link recipe versions to customer satisfaction scores from POS/review systems
- **Video Instructions**: Step-by-step video recording and playback integrated into recipe view

---

## 4.2 Sub Recipe Management

### 4.2.1 Overview & Business Value

Sub Recipe Management directly replaces the 245 sub recipe sheets in Sub Rec.xlsm. Sub recipes represent intermediate preparations -- sauces, doughs, mousses, bases, marinades, stocks, and compound butters -- that serve as ingredients in multiple finished recipes.

**Why this module exists**: Sub recipes are the building blocks of professional cooking. A single chimichurri base might appear in 15 different menu items. Without a sub recipe system, each recipe would need to independently list and cost every individual ingredient in the chimichurri, leading to massive duplication, inconsistency, and maintenance burden. The sub recipe system enables hierarchical composition: products flow into sub recipes, which flow into recipes.

**Business value**:
- Eliminates duplication across 245 sub recipe sheets
- Ensures cost accuracy by calculating sub recipe cost per unit from batch costing
- Enables batch production planning for prep efficiency
- Propagates ingredient changes through the entire recipe hierarchy automatically
- Supports sub recipes within sub recipes (nested composition) for complex preparations

**Dependencies**: Product/Ingredient Management (4.3), Cost Engine (4.4), Nutrition Engine (4.5)

### 4.2.2 Data Model

**Sub Recipe Entity**

| Field | Type | Source | Description |
|---|---|---|---|
| id | UUID | System | Primary key |
| organization_id | UUID | System | Multi-tenant isolation |
| name | String(200) | User | Sub recipe name (e.g., "CHIMICHURRI BASE") |
| category_id | FK | User | Classification category |
| status | Enum | User | Actual, Pending, Update, NEW |
| batch_yield_qty | Decimal | User | Total output quantity of one batch [WB-REF: Total Weight per Batch] |
| batch_yield_unit | String | User | Unit for batch yield (g, ml, ea) |
| cost_per_unit | Decimal | Calc | = Total Cost / Batch Yield Qty [WB-REF: Cost Per Unit row] |
| cost_per_unit_with_margin | Decimal | Calc | = cost_per_unit * (1 + margin%) |
| total_cost | Decimal | Calc | Sum of all ingredient line costs [WB-REF: Total Cost row] |
| total_cost_with_margin | Decimal | Calc | Total Cost * (1 + 5%) [WB-REF: Total Cost + 5%] |
| security_margin_pct | Decimal | Config | Default 5% |
| shelf_life_hours | Integer | User | How long the sub recipe remains usable |
| storage_temp | String | User | Required storage temperature |
| storage_instructions | Text | User | Detailed storage requirements |
| preparation_method | Text | User | Step-by-step preparation instructions |
| critical_control_points | Text | User | HACCP critical control points |
| photo_urls | String[] | System | Photos of the finished sub recipe |
| is_active | Boolean | User | Active/inactive flag |
| created_by | FK | System | Creator |
| created_at | Timestamp | System | Creation time |
| updated_by | FK | System | Last modifier |
| updated_at | Timestamp | System | Last modification time |
| version | Integer | System | Optimistic locking version |

**Sub Recipe Ingredient Entity**

| Field | Type | Source | Description |
|---|---|---|---|
| id | UUID | System | Primary key |
| sub_recipe_id | FK | System | Parent sub recipe |
| sort_order | Integer | User | Display order |
| ingredient_type | Enum | System | 'product' or 'sub_recipe' (enables nesting) |
| product_id | FK | User | Product reference (if product) |
| child_sub_recipe_id | FK | User | Sub recipe reference (if sub recipe) |
| nett_qty | Decimal | User | Net quantity [WB-REF: Nett Qty column] |
| unit | String | Calc | Auto from product/sub recipe |
| ref_pct | Decimal | Calc | Waste % from product [WB-REF: Ref% column] |
| gross_qty | Decimal | Calc | = (100 * nett_qty) / (100 - ref_pct) [WB-REF: Gross Qty formula] |
| cost_per_unit | Decimal | Calc | Unit cost from product/sub recipe |
| line_cost | Decimal | Calc | = gross_qty * cost_per_unit |
| preparation_note | String | User | Line-specific preparation instruction |

### 4.2.3 Functional Requirements

#### SRF-FUNC-001: Sub Recipe Creation and Editing

The system SHALL provide a sub recipe creation and editing interface that mirrors the Sub Rec template structure.

**Details**: The sub recipe template in Sub Rec.xlsm has 42 rows and 26 columns. The digital version preserves the ingredient grid layout (up to 26 ingredient lines in the workbook, unlimited in the app) with the same columns: Product Name, Nett Qty, Unit, Ref%, Gross Qty, Cost/U, Cost.

**Acceptance Criteria**:
- AC1: Sub recipe creation supports all fields defined in the data model
- AC2: Ingredient line behavior is identical to recipe ingredient lines (auto-lookup, auto-calculate)
- AC3: Batch yield quantity and unit are required fields
- AC4: Cost per unit auto-calculates as Total Cost / Batch Yield Qty [WB-REF: Cost Per Unit formula]
- AC5: Sub recipe ingredients can include other sub recipes (nesting), with circular dependency detection
- AC6: Maximum nesting depth is configurable (default: 5 levels) to prevent accidental infinite loops

#### SRF-FUNC-002: Sub Recipe as Ingredient

The system SHALL allow sub recipes to be used as ingredients in recipes and other sub recipes.

**Details**: This is the core hierarchical composition capability. When a sub recipe is selected as an ingredient in a recipe, its cost_per_unit (with or without margin, configurable) serves as the Cost/U for that ingredient line. Its nutrition data flows through as well.

**Acceptance Criteria**:
- AC1: Sub recipes appear in ingredient autocomplete alongside products
- AC2: Sub recipe ingredients display their cost_per_unit as the Cost/U
- AC3: The unit for a sub recipe ingredient matches its batch_yield_unit
- AC4: Ref% for sub recipes defaults to 0 (no waste on prepared items) but is overridable
- AC5: When a sub recipe's cost changes, all parent recipes and sub recipes recalculate
- AC6: The "where used" view shows all recipes and sub recipes that contain a given sub recipe

#### SRF-FUNC-003: Batch Costing

The system SHALL calculate sub recipe costs on a batch basis and derive a per-unit cost.

**Details**: This directly replicates the Sub Rec template's cost summary section. A batch of chimichurri produces 2000g at a total cost of X AED. The cost per gram (X / 2000) is what flows to parent recipes.

**Acceptance Criteria**:
- AC1: Total Cost = sum of all ingredient line costs [WB-REF: Total Cost row]
- AC2: Total Cost + Margin = Total Cost * (1 + security_margin_pct) [WB-REF: Total Cost + 5% row]
- AC3: Cost Per Unit = Total Cost / Batch Yield Qty [WB-REF: Cost Per Unit row]
- AC4: Cost Per Unit with Margin = Total Cost with Margin / Batch Yield Qty
- AC5: When used as an ingredient, the cost_per_unit (with or without margin) is used based on organization config
- AC6: Batch costing summary is displayed in a card matching the workbook layout

#### SRF-FUNC-004: Batch Scaling

The system SHALL allow scaling a sub recipe batch to different quantities.

**Business Value**: Prep cooks need to make half-batches or double-batches routinely. The SCALE sheet in Sub Rec.xlsm provides this capability; CulinaryCore makes it interactive.

**Acceptance Criteria**:
- AC1: User can enter a target batch size (e.g., "make 500g instead of 2000g")
- AC2: All ingredient quantities scale proportionally
- AC3: Scaled quantities round to practical measurements
- AC4: Cost per unit remains the same regardless of scale (linear scaling)
- AC5: User can scale by a multiplier (e.g., "make 3 batches")
- AC6: Scaled view can be printed as a prep sheet

#### SRF-FUNC-005: Sub Recipe Index

The system SHALL provide an index view of all sub recipes matching the workbook's Index sheet.

**Acceptance Criteria**:
- AC1: Index displays name, category, total cost, cost per unit, batch yield, status
- AC2: Index is sortable by any column
- AC3: Index is filterable by category, status, cost range
- AC4: Index supports bulk status changes
- AC5: Index can be exported to Excel or PDF
- AC6: Cost values update in real-time when underlying product prices change

#### SRF-FUNC-006: Where-Used Analysis

The system SHALL show, for any sub recipe, all recipes and other sub recipes that use it.

**Business Value**: Before modifying or discontinuing a sub recipe, users need to understand the impact on the entire recipe tree.

**Acceptance Criteria**:
- AC1: Where-used list shows all direct parents (recipes and sub recipes)
- AC2: Where-used list shows the transitive closure (all ancestors in the hierarchy)
- AC3: Impact analysis calculates how a cost change would affect each parent
- AC4: Where-used analysis is accessible from the sub recipe detail view

#### SRF-FUNC-007: Shelf Life Tracking

The system SHALL track shelf life for sub recipes and provide expiration warnings.

**Business Value**: Sub recipes are perishable. A sauce made Monday morning must be used by Wednesday. Tracking shelf life prevents waste and food safety issues.

**Acceptance Criteria**:
- AC1: Shelf life (in hours) can be set for each sub recipe
- AC2: When a batch is produced, an expiration timestamp is calculated
- AC3: Production log shows all active batches with remaining shelf life
- AC4: Notifications are sent when a batch reaches 75% of shelf life (warning) and 100% (expired)
- AC5: Expired batches are flagged in inventory

### 4.2.4 User Stories

| ID | Story | Priority |
|---|---|---|
| SRF-US-001 | As a Sous Chef, I want to create a sub recipe for our house chimichurri so that its cost flows automatically into every dish that uses it. | Must Have |
| SRF-US-002 | As an Executive Chef, I want to see which recipes will be affected if I change the chimichurri recipe so that I can assess the cost impact before committing. | Must Have |
| SRF-US-003 | As a Prep Cook, I want to scale a sub recipe batch to the quantity I need for today's prep so that I don't waste ingredients or run short. | Must Have |
| SRF-US-004 | As a Kitchen Manager, I want to track shelf life of all prepared sub recipes so that I can ensure food safety and reduce waste. | Should Have |
| SRF-US-005 | As a Purchasing Manager, I want to know the cost per gram of every sub recipe so that I can compare them to commercial alternatives. | Should Have |

### 4.2.5 Business Rules

| ID | Rule | Source |
|---|---|---|
| SRF-BR-001 | Sub recipe Cost Per Unit SHALL be Total Cost / Batch Yield Quantity. | WB: Cost Per Unit formula |
| SRF-BR-002 | Sub recipe ingredients SHALL use the same waste-adjusted gross quantity formula as recipe ingredients. | WB: Gross Qty formula |
| SRF-BR-003 | Circular dependencies in sub recipe nesting SHALL be detected and prevented at save time. | System integrity |
| SRF-BR-004 | When a product price changes, all sub recipes containing that product SHALL recalculate, and all recipes containing those sub recipes SHALL cascade recalculate. | System integrity |
| SRF-BR-005 | The 5% security margin SHALL be applied to sub recipe total cost before deriving cost per unit. | WB: Total Cost + 5% row |

### 4.2.6 Future Enhancements

- **Production Mode**: Integrated timer and step-by-step guided production with photo/video at each step
- **Quality Scoring**: Track batch quality ratings over time to identify consistency issues
- **Cost Trend Analysis**: Historical cost per unit charting for each sub recipe
- **Automatic Substitution**: When a product is out of stock, suggest alternative sub recipe formulations

---

## 4.3 Product / Ingredient Management

### 4.3.1 Overview & Business Value

Product/Ingredient Management replaces Table7 (Product List) in Sub Rec.xlsm -- the 657-product, 31-column master ingredient database. This is the foundation of the entire cost and nutrition hierarchy. Every calculation in the system ultimately traces back to product data.

**Why this module exists**: Products are the atomic units of the CulinaryCore system. Every cost in every recipe begins with a product's buying price. Every nutrition calculation begins with a product's nutritional composition per 100g. Every waste adjustment begins with a product's Ref% (waste percentage). If the product data is wrong, everything built on it is wrong.

**Business value**:
- Centralized, authoritative product database replacing a single Excel sheet that is the single point of failure
- Multi-unit conversion eliminates manual unit arithmetic errors
- Supplier price tracking enables cost trend analysis and negotiation leverage
- Waste factor management ensures accurate cost calculations
- Nutritional data at the product level cascades automatically to all recipes
- Product status management prevents use of discontinued or unapproved products

**Dependencies**: Supplier Management (4.8), Nutrition Engine (4.5), Allergen Management (4.6)

### 4.3.2 Data Model

**Product Entity**

| Field | Type | Source | Description |
|---|---|---|---|
| id | UUID | System | Primary key |
| organization_id | UUID | System | Multi-tenant isolation |
| name | String(200) | User | Product name [WB-REF: Product name column] |
| brand | String(100) | User | Brand name [WB-REF: Brand column] |
| category_id | FK | User | Product category [WB-REF: Category column] |
| supplier_id | FK | User | Primary supplier [WB-REF: Supplier column] |
| status | Enum | User | Actual, Pending, Update, NEW [WB-REF: Status column] |
| sku | String(50) | User | Supplier SKU or internal code |
| barcode | String(50) | User | EAN/UPC barcode |
| ppc | Decimal | User | Pieces Per Case [WB-REF: PPC column] |
| purchase_unit | String | User | Unit for purchasing (case, bag, bottle) [WB-REF: Purchase Unit column] |
| upp | Decimal | User | Units Per Pack [WB-REF: UPP column] |
| base_unit | String | User | Fundamental unit (g, ml, ea) [WB-REF: Base Unit column] |
| total_weight | Decimal | Calc | Total weight per purchase unit [WB-REF: Total weight column] |
| working_unit | String | User | Unit used in recipes (g, ml, ea) [WB-REF: Working Unit column] |
| buying_cost_per_unit | Decimal | User | Purchase price per purchase unit [WB-REF: Buying/U cost column] |
| cost_per_gross_unit | Decimal | Calc | Cost per gross working unit [WB-REF: Gross/U column] |
| cost_per_nett_unit | Decimal | Calc | Cost per net working unit (waste-adjusted) [WB-REF: Nett/U column] |
| gross_weight | Decimal | User | Gross weight of the product [WB-REF: Gross weight column] |
| waste_amount | Decimal | Calc | Amount lost to waste [WB-REF: Waste amount column] |
| ref_pct | Decimal | Calc/User | Waste percentage = (Waste / Gross) * 100 [WB-REF: Ref% column] |
| yield_pct | Decimal | Calc | Yield percentage = 100 - Ref% [WB-REF: Yield% column] |
| min_order_qty | Decimal | User | Minimum order quantity from supplier |
| lead_time_days | Integer | User | Supplier lead time in days |
| storage_type | Enum | User | Ambient, Chilled, Frozen |
| storage_temp_min | Decimal | User | Minimum storage temperature |
| storage_temp_max | Decimal | User | Maximum storage temperature |
| shelf_life_days | Integer | User | Shelf life in days from receipt |
| par_level | Decimal | User | Minimum stock level to maintain |
| reorder_point | Decimal | User | Stock level that triggers reorder |
| reorder_qty | Decimal | User | Standard reorder quantity |
| is_active | Boolean | User | Active/inactive flag |
| photo_url | String | System | Product photo |
| notes | Text | User | General notes |
| created_at | Timestamp | System | Creation time |
| updated_at | Timestamp | System | Last modification time |

**Product Nutrition Entity**

| Field | Type | Source | Description |
|---|---|---|---|
| product_id | FK | System | Parent product |
| fat_per_100g | Decimal | User | Fat in grams per 100g [WB-REF: Fat column] |
| carbs_per_100g | Decimal | User | Carbohydrates per 100g [WB-REF: Carbs column] |
| protein_per_100g | Decimal | User | Protein per 100g [WB-REF: Protein column] |
| vitamin_a_per_100g | Decimal | User | Vitamin A in mcg per 100g [WB-REF: Vit A column] |
| vitamin_c_per_100g | Decimal | User | Vitamin C in mg per 100g [WB-REF: Vit C column] |
| calcium_per_100g | Decimal | User | Calcium in mg per 100g [WB-REF: Calcium column] |
| iron_per_100g | Decimal | User | Iron in mg per 100g [WB-REF: Iron column] |
| sodium_per_100g | Decimal | User | Sodium in mg per 100g [WB-REF: Sodium column] |
| kcal_per_100g | Decimal | Calc | = (Fat * 9) + (Carbs * 4) + (Protein * 4) [WB-REF: K.Cal formula] |
| fiber_per_100g | Decimal | User | Fiber in grams per 100g |
| sugar_per_100g | Decimal | User | Sugars per 100g |
| saturated_fat_per_100g | Decimal | User | Saturated fat per 100g |
| trans_fat_per_100g | Decimal | User | Trans fat per 100g |
| cholesterol_per_100g | Decimal | User | Cholesterol in mg per 100g |
| potassium_per_100g | Decimal | User | Potassium in mg per 100g |
| nutrition_source | Enum | User | Manual, Database, Supplier, AI-estimated |
| nutrition_verified | Boolean | User | Whether nutrition data has been verified |
| nutrition_verified_by | FK | User | User who verified |
| nutrition_verified_at | Timestamp | System | Verification timestamp |

**Product Unit Conversion Entity**

| Field | Type | Source | Description |
|---|---|---|---|
| product_id | FK | System | Parent product |
| from_unit | String | User | Source unit |
| to_unit | String | User | Target unit |
| factor | Decimal | User | Multiplication factor (from * factor = to) |

**Product Price History Entity**

| Field | Type | Source | Description |
|---|---|---|---|
| id | UUID | System | Primary key |
| product_id | FK | System | Parent product |
| supplier_id | FK | System | Supplier who quoted this price |
| price | Decimal | User/Import | Price per purchase unit |
| effective_date | Date | User | When this price takes effect |
| expiry_date | Date | User | When this price expires |
| source | Enum | User | Manual, Invoice, Supplier API, Quote |
| currency | String | System | Currency code (AED) |
| notes | String | User | Price change notes |

### 4.3.3 Functional Requirements

#### PRD-FUNC-001: Product Database CRUD

The system SHALL provide complete create, read, update, and delete operations for products.

**Details**: This replaces the Product List (Table7) in Sub Rec.xlsm. The current list has 657 products with 31 columns; CulinaryCore expands this with additional fields while maintaining backward compatibility with the workbook data structure.

**Acceptance Criteria**:
- AC1: All 31 columns from the workbook Product List are represented in the data model
- AC2: Product creation validates required fields: name, category, base unit, at least one supplier price
- AC3: Deleting a product is blocked if it is used in any active recipe or sub recipe (soft-delete only)
- AC4: Product list supports pagination, sorting, and filtering on all fields
- AC5: Bulk import from Excel/CSV with column mapping
- AC6: Bulk edit of selected products (e.g., update supplier for multiple items)

#### PRD-FUNC-002: Unit Conversion System

The system SHALL manage a comprehensive unit conversion system for each product.

**Details**: The workbook uses Purchase Unit, Base Unit, and Working Unit with manual conversion. CulinaryCore automates these conversions and supports custom conversion factors per product (because 1 "bunch" of parsley weighs differently than 1 "bunch" of cilantro).

**Acceptance Criteria**:
- AC1: System maintains standard unit conversions (g to kg, ml to L, etc.)
- AC2: Products can define custom unit conversions (e.g., 1 bunch = 30g for parsley)
- AC3: When a recipe uses a product in its working unit, the system converts to base unit for cost calculation
- AC4: Purchase orders convert recipe quantities to purchase units
- AC5: Conversion chains are supported (ea -> bunch -> g)
- AC6: Users are warned if a recipe uses a unit for which no conversion path exists

#### PRD-FUNC-003: Waste Factor Management

The system SHALL manage waste factors (Ref%) for each product with historical tracking.

**Details**: The workbook's Ref% column is critical to accurate costing. A 20% waste factor on tenderloin means you must buy 125g gross to get 100g net. This directly affects cost and purchasing.

**Business Rules** [WB-REF]:
- Ref% = (Waste Amount / Gross Weight) * 100
- Yield% = 100 - Ref%
- Gross Qty = (100 * Nett Qty) / (100 - Ref%)
- Cost per Nett Unit = Cost per Gross Unit / (Yield% / 100)

**Acceptance Criteria**:
- AC1: Each product has a default Ref% [WB-REF: Ref% column]
- AC2: Ref% can be overridden per recipe line if a specific recipe has different waste characteristics
- AC3: Historical Ref% values are tracked with dates and reasons for change
- AC4: Yield% auto-calculates as 100 - Ref% [WB-REF: Yield% column]
- AC5: Products with Ref% > 50% display a warning (high waste flag)
- AC6: Waste tracking integrates with inventory to record actual vs. expected waste

#### PRD-FUNC-004: Supplier Price Management

The system SHALL track current and historical prices from multiple suppliers for each product.

**Acceptance Criteria**:
- AC1: Each product can have prices from multiple suppliers
- AC2: One supplier is designated as the primary (default) for cost calculations
- AC3: Price changes are logged with effective date, source, and previous price
- AC4: Price import from supplier price lists (Excel, CSV, PDF via AI extraction)
- AC5: Price comparison view shows all suppliers for a product with price delta from primary
- AC6: Automatic notification when a price changes by more than a configurable threshold (default 10%)
- AC7: Historical price charting for trend analysis

#### PRD-FUNC-005: Product Categories

The system SHALL support a configurable product category hierarchy.

**Acceptance Criteria**:
- AC1: Default categories from the workbook's Product List are imported
- AC2: Categories support two levels (category and subcategory)
- AC3: Products can be filtered and grouped by category
- AC4: Category management (create, rename, merge, deactivate) is restricted to admin roles

#### PRD-FUNC-006: Product Status Management

The system SHALL implement a product status workflow consistent with the workbook's status values.

**Status Values** [WB-REF: Status column]:
- **Actual**: Product is actively used and available
- **Pending**: Product is being evaluated or awaiting approval
- **Update**: Product details have been modified and are awaiting review
- **NEW**: Product has been newly added to the system
- **Discontinued**: Product is no longer available from the supplier
- **Substituted**: Product has been replaced by another product

**Acceptance Criteria**:
- AC1: New products start in NEW status
- AC2: Only products in Actual status can be used as ingredients in active recipes
- AC3: Changing a product to Discontinued triggers a notification to all recipe owners who use it
- AC4: Substituted products can link to their replacement for easy migration

#### PRD-FUNC-007: Product Search

The system SHALL provide fast, comprehensive product search.

**Acceptance Criteria**:
- AC1: Search by name, brand, category, supplier, SKU, or barcode
- AC2: Fuzzy search handles misspellings (e.g., "tenderloin" matches "tenderloin")
- AC3: Barcode scanning (camera or hardware scanner) for instant product lookup
- AC4: Search results appear within 100ms
- AC5: Recently used products appear as suggestions
- AC6: Search works offline using local cache

#### PRD-FUNC-008: Product Import/Export

The system SHALL support bulk import and export of product data.

**Acceptance Criteria**:
- AC1: Import from Excel matching the workbook Product List format (31 columns)
- AC2: Import preview shows data mapping and validation errors before committing
- AC3: Import handles duplicate detection (by name, SKU, or barcode)
- AC4: Export to Excel, CSV, and PDF
- AC5: Selective export (filter products before exporting)
- AC6: Import supports incremental updates (update existing products by SKU match)

### 4.3.4 User Stories

| ID | Story | Priority |
|---|---|---|
| PRD-US-001 | As a Purchasing Manager, I want to add a new product with its supplier price and waste factor so that it is immediately available for recipe costing. | Must Have |
| PRD-US-002 | As an Executive Chef, I want to search for a product by name and see its cost per unit and waste percentage so that I can make informed ingredient choices. | Must Have |
| PRD-US-003 | As a Purchasing Manager, I want to update a product's price and see which recipes are affected so that I can assess the financial impact of a price increase. | Must Have |
| PRD-US-004 | As a Receiving Clerk, I want to scan a barcode to look up a product so that I can verify deliveries quickly. | Should Have |
| PRD-US-005 | As a Nutritionist, I want to enter and verify nutrition data per 100g for each product so that recipe nutrition calculations are accurate. | Must Have |
| PRD-US-006 | As an IT Administrator, I want to bulk import 657 products from our Excel Product List so that we can migrate to CulinaryCore without manual data entry. | Must Have |
| PRD-US-007 | As a Purchasing Manager, I want to compare prices from multiple suppliers for the same product so that I can negotiate better deals. | Should Have |

### 4.3.5 Business Rules

| ID | Rule | Source |
|---|---|---|
| PRD-BR-001 | K.Cal per 100g SHALL be calculated as (Fat * 9) + (Carbs * 4) + (Protein * 4). | WB: K.Cal formula |
| PRD-BR-002 | Ref% SHALL be calculated as (Waste Amount / Gross Weight) * 100. | WB: Ref% formula |
| PRD-BR-003 | Yield% SHALL be calculated as 100 - Ref%. | WB: Yield% formula |
| PRD-BR-004 | Cost per Nett Unit SHALL be Cost per Gross Unit / (Yield% / 100). | WB: Nett/U formula |
| PRD-BR-005 | A product SHALL NOT be permanently deleted if it is referenced by any recipe, sub recipe, or purchase order. | Data integrity |
| PRD-BR-006 | When a product price changes, the effective date SHALL default to today and the previous price SHALL be archived to history. | Audit trail |
| PRD-BR-007 | Total weight SHALL be calculated from PPC, UPP, and base unit weight as defined by the purchase unit configuration. | WB: Total weight column |

### 4.3.6 Future Enhancements

- **AI Nutrition Lookup**: Auto-populate nutrition data from USDA, FoodData Central, or regional databases using AI matching
- **Supplier API Integration**: Automatic price updates from supplier systems
- **Product Photo AI**: Photograph a product and have AI identify it, populate fields, and match to existing products
- **Seasonal Availability Tracking**: Track which products are seasonal and suggest alternatives during off-season
- **Carbon Footprint Data**: Environmental impact metrics per product for sustainability reporting

---

## 4.4 Cost Engine

### 4.4.1 Overview & Business Value

The Cost Engine is the computational heart of CulinaryCore. It implements the hierarchical cost calculation model encoded in the workbooks' formulas, where costs flow from product prices through sub recipes into recipes, with waste adjustments and security margins at every level.

**Why this module exists**: The formulas in the workbooks represent years of refinement and encode nuanced business logic around waste management, yield adjustment, and margin security. These formulas are brittle in Excel (a single broken cell reference can corrupt an entire sheet's calculations), but when implemented as a proper calculation engine they become robust, auditable, and real-time.

**Business value**:
- Real-time cost recalculation eliminates the delay between a price change and its visibility in recipe costs
- Cascading recalculation ensures a product price change instantly propagates through all sub recipes and recipes
- Configurable security margins protect against cost volatility
- Multi-currency support enables international operations
- Cost scenario modeling allows "what-if" analysis without affecting live data
- Audit trail for every cost calculation enables compliance and dispute resolution

**Dependencies**: Product Management (4.3), Sub Recipe Management (4.2), Recipe Management (4.1)

### 4.4.2 Core Calculation Logic

The following calculation chain represents the exact business logic derived from the workbooks. Every formula has been traced through the Excel cells and verified.

#### Level 1: Product Unit Cost

```
Given:
  buying_cost = price paid for one purchase_unit (e.g., 150 AED for 1 case)
  ppc = pieces per case (e.g., 6)
  upp = units per pack (e.g., 500g)
  base_unit = g

Then:
  total_weight = ppc * upp                    (e.g., 6 * 500 = 3000g)
  cost_per_gross_unit = buying_cost / total_weight  (e.g., 150 / 3000 = 0.05 AED/g)
  cost_per_nett_unit = cost_per_gross_unit / (yield_pct / 100)
                     = cost_per_gross_unit / ((100 - ref_pct) / 100)
                     (e.g., 0.05 / 0.80 = 0.0625 AED/g for a product with 20% waste)
```

#### Level 2: Recipe/Sub Recipe Ingredient Line Cost

```
Given:
  nett_qty = quantity needed in the recipe (user input)
  ref_pct = waste percentage (from product or sub recipe)
  cost_per_unit = cost per working unit (from product's cost_per_nett_unit or sub recipe's cost_per_unit)

Then:
  gross_qty = (100 * nett_qty) / (100 - ref_pct)  [WB-REF: Gross Qty formula]
  line_cost = gross_qty * cost_per_unit             [WB-REF: Cost formula]
```

#### Level 3: Sub Recipe Total Cost

```
  total_cost = SUM(line_cost for all ingredient lines)  [WB-REF: Total Cost row]
  total_cost_with_margin = total_cost * (1 + security_margin_pct)  [WB-REF: Total Cost + 5%]
  cost_per_unit = total_cost / batch_yield_qty  [WB-REF: Cost Per Unit]
  cost_per_unit_with_margin = total_cost_with_margin / batch_yield_qty
```

#### Level 4: Recipe Total Cost and Profitability

```
  total_cost = SUM(line_cost for all ingredient lines)  [WB-REF: Row 30]
  cost_per_portion = total_cost / yield_qty
  total_cost_with_margin = total_cost * (1 + security_margin_pct)  [WB-REF: Row 37]
  selling_price_excl_vat = selling_price_with_vat / (1 + vat_rate)  [WB-REF: Row 35]
  contribution_margin = selling_price_excl_vat - total_cost_with_margin  [WB-REF: Row 38]
  food_cost_pct = (total_cost_with_margin / selling_price_excl_vat) * 100  [WB-REF: Row 39]
```

### 4.4.3 Functional Requirements

#### CST-FUNC-001: Real-Time Cost Calculation

The system SHALL calculate costs in real-time as inputs change.

**Acceptance Criteria**:
- AC1: Any change to an ingredient quantity SHALL trigger cost recalculation within 100ms
- AC2: Cost calculations SHALL be performed client-side for immediate feedback
- AC3: Server-side recalculation SHALL verify and persist the result
- AC4: In case of client-server discrepancy, the server value SHALL take precedence and the client SHALL be corrected

#### CST-FUNC-002: Cascading Price Propagation

The system SHALL propagate price changes through the entire cost hierarchy.

**Details**: When a product price changes, every sub recipe using that product recalculates, and every recipe using those sub recipes recalculates. In the workbook, this requires manual recalculation across multiple sheets; in CulinaryCore, it is automatic and immediate.

**Acceptance Criteria**:
- AC1: A product price change triggers recalculation of all sub recipes containing that product
- AC2: Sub recipe recalculation triggers recalculation of all parent recipes and sub recipes
- AC3: Propagation completes within 5 seconds for up to 1000 affected recipes
- AC4: A propagation report shows all affected items with old and new costs
- AC5: Users can preview the cascade impact before committing a price change
- AC6: Propagation is atomic -- all affected items are updated together or none are

#### CST-FUNC-003: Security Margin Configuration

The system SHALL support configurable security margins at organization, category, and individual recipe levels.

**Details**: The workbooks use a fixed 5% security margin. CulinaryCore allows this to be configured globally and overridden at more specific levels for flexibility.

**Acceptance Criteria**:
- AC1: Organization-level default security margin (default: 5%) [WB-REF]
- AC2: Category-level override (e.g., 3% for desserts, 7% for mains)
- AC3: Individual recipe/sub recipe override
- AC4: The most specific margin takes precedence (recipe > category > org)
- AC5: Margin changes trigger recalculation of food cost % and contribution margin
- AC6: Historical margin values are preserved in version history

#### CST-FUNC-004: Multi-Currency Support

The system SHALL support multiple currencies for organizations operating across regions.

**Acceptance Criteria**:
- AC1: Default currency is AED (UAE Dirham) [WB-REF: workbook currency]
- AC2: Products can have prices in any currency
- AC3: Exchange rates can be set manually or fetched from an external API
- AC4: All recipe costs display in the organization's base currency
- AC5: Currency conversion is applied at the product level before cost propagation
- AC6: Exchange rate changes trigger cost recalculation similar to price changes

#### CST-FUNC-005: Cost Alerts

The system SHALL generate alerts when costs exceed configurable thresholds.

**Acceptance Criteria**:
- AC1: Alert when food cost % exceeds target (configurable per category, default 32%)
- AC2: Alert when a product price increases by more than a configurable percentage (default 10%)
- AC3: Alert when a recipe's contribution margin drops below a configurable minimum
- AC4: Alert when a cost cascade affects more than a configurable number of recipes (default 10)
- AC5: Alerts are delivered via in-app notification, email, and push notification (configurable)
- AC6: Alert acknowledgment is tracked and auditable

#### CST-FUNC-006: Cost Snapshots

The system SHALL support periodic cost snapshots for historical comparison.

**Acceptance Criteria**:
- AC1: Automatic daily cost snapshot for all active recipes (configurable schedule)
- AC2: Manual snapshot creation for point-in-time cost freeze
- AC3: Cost comparison between any two snapshots
- AC4: Snapshot data includes all ingredients, quantities, unit costs, and total costs
- AC5: Snapshots are immutable and cannot be retroactively modified

#### CST-FUNC-007: VAT Calculation

The system SHALL calculate VAT according to the organization's tax configuration.

**Details**: The UAE has a 5% VAT rate. The workbook calculates Price W/VAT (Row 34) and Price B/VAT (Row 35), which is Price W/VAT / 1.05.

**Acceptance Criteria**:
- AC1: Default VAT rate is 5% for UAE [WB-REF]
- AC2: VAT rate is configurable per organization and per product category
- AC3: Some categories may be VAT-exempt (configurable)
- AC4: Selling Price excl. VAT = Selling Price incl. VAT / (1 + VAT Rate) [WB-REF: Row 35 formula]
- AC5: VAT calculations follow UAE Federal Tax Authority rules

### 4.4.4 User Stories

| ID | Story | Priority |
|---|---|---|
| CST-US-001 | As a Restaurant Owner, I want to see the food cost percentage update instantly when I change a selling price so that I can find the right price point. | Must Have |
| CST-US-002 | As a Purchasing Manager, I want to preview the impact of a supplier price increase on all affected recipes before committing the change so that I can make informed negotiation decisions. | Must Have |
| CST-US-003 | As a Finance Manager, I want monthly cost snapshots so that I can compare food cost trends over time. | Should Have |
| CST-US-004 | As an Executive Chef, I want to be alerted when any recipe's food cost exceeds 32% so that I can take corrective action. | Must Have |
| CST-US-005 | As a Restaurant Owner, I want food costs calculated with a 5% security margin so that I'm protected against minor cost fluctuations. | Must Have |

### 4.4.5 Business Rules

| ID | Rule | Source |
|---|---|---|
| CST-BR-001 | All cost calculations SHALL use the waste-adjusted gross quantity, not the net quantity, for costing. | WB: Core formula |
| CST-BR-002 | Security margin SHALL be applied multiplicatively: Cost_with_margin = Cost * (1 + margin%). | WB: Row 37 |
| CST-BR-003 | Food cost % SHALL be calculated from the cost WITH security margin divided by the selling price EXCLUDING VAT. | WB: Row 39 |
| CST-BR-004 | Cost cascading SHALL be idempotent: running the same propagation twice SHALL produce identical results. | System integrity |
| CST-BR-005 | Cost calculations SHALL use DECIMAL precision (not floating point) to avoid rounding errors in financial calculations. | Financial accuracy |
| CST-BR-006 | All monetary values SHALL be stored with 4 decimal places and displayed with 2 decimal places (or as appropriate for the currency). | Financial accuracy |

### 4.4.6 Future Enhancements

- **Predictive Cost Modeling**: AI-driven predictions of future ingredient costs based on market trends, seasonality, and historical data
- **Automatic Price Optimization**: Suggest selling prices that maximize contribution margin while staying within competitive range
- **Theoretical vs. Actual Cost Analysis**: Compare calculated food cost against actual cost derived from purchases and inventory
- **Cost Attribution**: Break down food cost by station, service period, or menu section for granular profitability analysis

---

## 4.5 Nutrition Engine

### 4.5.1 Overview & Business Value

The Nutrition Engine replicates and extends the nutrition calculation system embedded in both workbooks. In the Excel system, each product has nutrition data per 100g, and recipe nutrition is calculated by summing (NettQty / 100) * nutrition_per_100g for each ingredient. The Calories sheet in Recipes.xlsm provides dynamic nutrition analysis using INDIRECT formulas.

**Why this module exists**: Nutrition data is increasingly required by regulation (UAE, EU, US, UK all have labeling requirements), demanded by health-conscious consumers, and valuable for menu marketing. The workbook's nutrition system is functional but limited to 8 nutrients and requires manual cross-referencing. CulinaryCore expands to full regulatory-compliant nutrition panels with automatic inheritance through the recipe hierarchy.

**Business value**:
- Regulatory compliance with UAE food labeling regulations (Federal Law No. 10 of 2015)
- Consumer transparency drives customer trust and loyalty
- Menu differentiation through verifiable nutrition claims ("high protein", "low sodium")
- Reduced liability from accurate allergen and nutrition declarations
- Dietitian and nutritionist workflow integration

**Dependencies**: Product Management (4.3), Recipe Management (4.1), Sub Recipe Management (4.2)

### 4.5.2 Core Calculation Logic

#### Per-Ingredient Nutrition Contribution

```
For each ingredient line in a recipe or sub recipe:
  For each nutrient (fat, carbs, protein, vitamins, minerals):
    contribution = (nett_qty / 100) * nutrient_per_100g

[WB-REF: Nutrition calculation in recipe template]
```

#### Recipe Total Nutrition

```
For each nutrient:
  total = SUM(contribution from each ingredient line)

Per portion:
  per_portion = total / yield_qty
```

#### Energy Calculation

```
kcal_per_100g = (fat_per_100g * 9) + (carbs_per_100g * 4) + (protein_per_100g * 4)
[WB-REF: K.Cal formula in Product List]

Energy per portion:
  kcal = (fat_per_portion * 9) + (carbs_per_portion * 4) + (protein_per_portion * 4)
  kJ = kcal * 4.184
```

#### RDA (Reference Daily Amounts) Comparison

```
[WB-REF: Nutrition per portion panel in recipe template]
Vitamin A RDA = 600 mcg
Vitamin C RDA = 45 mg
Calcium RDA = 1000 mg
Iron RDA = 18 mg
Sodium Upper Limit = 2300 mg

% RDA = (nutrient_per_portion / RDA_value) * 100
```

### 4.5.3 Functional Requirements

#### NUT-FUNC-001: Automatic Nutrition Calculation

The system SHALL automatically calculate nutrition values for recipes and sub recipes based on their ingredient composition.

**Acceptance Criteria**:
- AC1: Nutrition calculations use the net quantity (not gross) of each ingredient [WB-REF: (NettQty/100) formula]
- AC2: All 8 workbook nutrients are calculated: Fat, Carbs, Protein, Vitamin A, Vitamin C, Calcium, Iron, Sodium [WB-REF]
- AC3: Additional nutrients are calculated: Fiber, Sugar, Saturated Fat, Trans Fat, Cholesterol, Potassium
- AC4: Energy (kcal and kJ) is calculated using Atwater factors: Fat*9 + Carbs*4 + Protein*4 [WB-REF: K.Cal formula]
- AC5: Nutrition per portion = total nutrition / yield quantity
- AC6: Nutrition updates in real-time as ingredients are added or modified
- AC7: Sub recipe nutrition cascades to parent recipes (sub recipe nutrition is included as a single "ingredient" contribution)

#### NUT-FUNC-002: Nutrition Panel Display

The system SHALL display nutrition information in a standardized panel format.

**Acceptance Criteria**:
- AC1: Nutrition panel shows per 100g and per portion values
- AC2: % RDA/DV (Daily Value) is calculated using configurable reference values
- AC3: Default RDA values: Vitamin A = 600mcg, Vitamin C = 45mg, Calcium = 1000mg, Iron = 18mg, Sodium UL = 2300mg [WB-REF]
- AC4: Panel layout matches UAE food labeling regulations
- AC5: Panel can be switched between UAE, EU (Regulation 1169/2011), US (FDA Nutrition Facts), and UK formats
- AC6: Panel is printable and exportable as image or PDF

#### NUT-FUNC-003: Nutrition Labeling

The system SHALL generate regulatory-compliant nutrition labels.

**Acceptance Criteria**:
- AC1: UAE label format per GSO 9/2007 and GCC Standardization Organization requirements
- AC2: EU label format per Regulation (EU) No 1169/2011
- AC3: US FDA Nutrition Facts label format
- AC4: Rounding rules per each regulation (e.g., FDA rounds to nearest 5kcal above 50kcal)
- AC5: Serving size can be configured per recipe
- AC6: Labels can be exported as print-ready files (PDF, SVG)

#### NUT-FUNC-004: Nutrition Claims Validation

The system SHALL validate nutrition claims (e.g., "low fat", "high protein") against regulatory definitions.

**Acceptance Criteria**:
- AC1: System knows the regulatory definitions for common claims (low fat, high protein, source of fiber, etc.)
- AC2: When a recipe qualifies for a claim, it is automatically suggested
- AC3: When a user adds a claim, the system validates it against the recipe's actual nutrition
- AC4: Invalid claims are flagged with an explanation of why they fail
- AC5: Claims are validated against the applicable regulation (UAE, EU, US, Codex Alimentarius)

#### NUT-FUNC-005: Dynamic Nutrition Analysis (Calories Sheet Replacement)

The system SHALL provide a dynamic nutrition analysis view that replicates and extends the Calories sheet functionality.

**Details**: The Calories sheet in Recipes.xlsm uses INDIRECT formulas to dynamically display any recipe's nutrition breakdown. CulinaryCore replaces this with an interactive analysis dashboard.

**Acceptance Criteria**:
- AC1: Select any recipe to view its complete nutrition breakdown
- AC2: Nutrition breakdown shows contribution from each ingredient (pie chart and table)
- AC3: Macronutrient distribution chart (fat/carbs/protein percentage of calories)
- AC4: Compare nutrition across multiple recipes side by side
- AC5: Filter recipes by nutrition criteria (e.g., "recipes under 500 kcal per portion")
- AC6: Nutrition trend analysis for menu changes over time

#### NUT-FUNC-006: Nutrition Data Sources

The system SHALL support multiple sources for product nutrition data.

**Acceptance Criteria**:
- AC1: Manual entry with full validation
- AC2: Import from USDA FoodData Central database
- AC3: Import from supplier-provided nutrition information
- AC4: AI-estimated nutrition (with confidence level indicator and "estimated" flag)
- AC5: Nutrition data source is tracked and displayed for transparency
- AC6: Verified vs. unverified nutrition data is visually distinguished

### 4.5.4 User Stories

| ID | Story | Priority |
|---|---|---|
| NUT-US-001 | As a Nutritionist, I want to see the complete nutrition breakdown per portion for any recipe so that I can verify compliance with labeling requirements. | Must Have |
| NUT-US-002 | As an Executive Chef, I want to see which ingredient contributes the most calories to a dish so that I can create lighter versions. | Should Have |
| NUT-US-003 | As a Restaurant Owner, I want to generate UAE-compliant nutrition labels for all menu items so that I meet regulatory requirements. | Must Have |
| NUT-US-004 | As a Nutritionist, I want to validate whether a "high protein" claim on a menu item is accurate so that we avoid misleading customers. | Should Have |
| NUT-US-005 | As a Customer-facing staff, I want to see per-portion nutrition when a customer asks so that I can provide accurate information. | Should Have |

### 4.5.5 Business Rules

| ID | Rule | Source |
|---|---|---|
| NUT-BR-001 | Nutrition contribution per ingredient SHALL use net quantity, not gross quantity, as the edible portion does not include waste. | WB: (NettQty/100) formula |
| NUT-BR-002 | Energy SHALL be calculated as (Fat*9) + (Carbs*4) + (Protein*4) kcal. | WB: K.Cal formula |
| NUT-BR-003 | When a product's nutrition data changes, all recipes and sub recipes using that product SHALL recalculate nutrition. | System integrity |
| NUT-BR-004 | Nutrition labels SHALL apply regulation-specific rounding rules. | Regulatory compliance |
| NUT-BR-005 | Recipes with unverified nutrition data SHALL display a warning indicator. | Data quality |

### 4.5.6 Future Enhancements

- **AI Nutrition Estimation**: Estimate nutrition from recipe photos or descriptions when ingredient-level data is unavailable
- **Dietary Filter Engine**: Filter menus by dietary requirements (keto, vegan, low-FODMAP, Mediterranean)
- **Nutrition Goal Tracking**: Track nutrition targets across a full menu or meal plan
- **Nutrient Density Scoring**: Calculate and display nutrient density scores for recipe comparison

---

## 4.6 Allergen Management

### 4.6.1 Overview & Business Value

Allergen Management is a new capability not present in the workbooks. The current system has no allergen tracking, which represents a significant compliance and safety gap. CulinaryCore implements comprehensive allergen management as a first-class feature.

**Why this module exists**: Allergen management is a legal requirement in the UAE (Federal Law No. 10 of 2015 on Food Safety), the EU (Regulation 1169/2011 with 14 mandatory allergens), the US (FSMA with 9 major allergens under FASTER Act), and most other jurisdictions. Beyond compliance, allergen management is a customer safety issue -- errors can be life-threatening.

**Business value**:
- Legal compliance across multiple jurisdictions
- Customer safety and liability reduction
- Operational efficiency (instant allergen lookup during service)
- Customer trust and competitive advantage
- Reduced training burden (system enforces allergen awareness)

### 4.6.2 Regulated Allergen Lists

**EU 14 Allergens** (Regulation 1169/2011):
1. Cereals containing gluten (wheat, rye, barley, oats, spelt, kamut)
2. Crustaceans
3. Eggs
4. Fish
5. Peanuts
6. Soybeans
7. Milk (including lactose)
8. Nuts (almonds, hazelnuts, walnuts, cashews, pecans, Brazil nuts, pistachios, macadamia/Queensland nuts)
9. Celery
10. Mustard
11. Sesame seeds
12. Sulphur dioxide and sulphites (>10mg/kg or >10mg/litre)
13. Lupin
14. Molluscs

**US 9 Major Allergens** (FASTER Act 2023):
1. Milk
2. Eggs
3. Fish
4. Crustacean shellfish
5. Tree nuts
6. Peanuts
7. Wheat
8. Soybeans
9. Sesame

**UAE/GCC**: Follows Codex Alimentarius guidelines plus local ESMA requirements.

### 4.6.3 Functional Requirements

#### ALG-FUNC-001: Product Allergen Declaration

The system SHALL allow allergen declarations at the product level.

**Acceptance Criteria**:
- AC1: Each product can declare allergens as: Contains, May Contain (cross-contamination), Free From
- AC2: Allergen list covers all EU 14 + US 9 allergens (union of both lists)
- AC3: Custom allergens can be added for specific dietary needs (e.g., nightshades, FODMAPs)
- AC4: Allergen declarations are mandatory for product approval (status = Actual)
- AC5: Products without allergen declarations display a prominent warning
- AC6: Bulk allergen declaration for product imports

#### ALG-FUNC-002: Recipe Allergen Inheritance

The system SHALL automatically compute recipe allergens from ingredient declarations.

**Acceptance Criteria**:
- AC1: Recipe allergens are the union of all ingredient allergens (Contains and May Contain)
- AC2: Allergen inheritance flows through sub recipes (product -> sub recipe -> recipe)
- AC3: Adding an ingredient that introduces a new allergen triggers a warning
- AC4: Removing the last ingredient containing an allergen removes that allergen from the recipe (auto-update)
- AC5: Manual allergen overrides are supported but flagged as overrides (for cross-contamination risks not captured by ingredients)
- AC6: Allergen changes in a product cascade to all affected recipes

#### ALG-FUNC-003: Allergen Display

The system SHALL display allergen information prominently in all recipe views.

**Acceptance Criteria**:
- AC1: Allergen icons displayed on recipe cards and list views
- AC2: Color-coded allergen badges (red for Contains, amber for May Contain, green for Free From)
- AC3: Full allergen matrix view for menu items
- AC4: Quick allergen filter: "Show all dishes free from [allergen]"
- AC5: Allergen information is available offline for service use
- AC6: Large, high-contrast allergen display mode for kitchen stations

#### ALG-FUNC-004: Allergen Reporting

The system SHALL generate allergen reports and declarations.

**Acceptance Criteria**:
- AC1: Full menu allergen matrix (dishes vs. allergens grid)
- AC2: Per-dish allergen declaration card (printable for table service)
- AC3: Allergen change log (when did this dish's allergen status change?)
- AC4: Allergen audit report (which products are missing allergen declarations?)
- AC5: Export to regulatory-required formats

### 4.6.4 User Stories

| ID | Story | Priority |
|---|---|---|
| ALG-US-001 | As a Line Cook, I want to see allergen icons on every recipe so that I can alert servers to allergen risks without searching. | Must Have |
| ALG-US-002 | As a Server, I want to filter the menu by "nut-free" so that I can confidently recommend dishes to a guest with a nut allergy. | Must Have |
| ALG-US-003 | As a Compliance Officer, I want to generate a complete allergen matrix for the menu so that I can submit it during health inspections. | Must Have |
| ALG-US-004 | As an Executive Chef, I want to be warned when adding an ingredient that introduces a new allergen to a dish so that I can make an informed decision. | Must Have |
| ALG-US-005 | As a Restaurant Owner, I want to ensure no product is used without an allergen declaration so that we minimize liability. | Should Have |

### 4.6.5 Business Rules

| ID | Rule | Source |
|---|---|---|
| ALG-BR-001 | Allergen inheritance SHALL be computed automatically and cannot be manually removed (only supplemented). | Safety |
| ALG-BR-002 | Products in Actual status SHALL NOT have empty allergen declarations. | Compliance |
| ALG-BR-003 | Any change to a product's allergen declaration SHALL cascade to all recipes and sub recipes using that product. | Safety |
| ALG-BR-004 | The system SHALL support at minimum the union of EU 14 and US 9 allergen lists. | Regulatory |
| ALG-BR-005 | Allergen information SHALL be available offline. | Operational safety |

### 4.6.6 Future Enhancements

- **AI Allergen Detection**: Scan recipe text descriptions for potential undeclared allergens
- **Customer Allergen Profiles**: POS integration to flag allergens for repeat customers
- **Supplier Allergen Verification**: Track supplier allergen certifications and audit dates
- **Cross-Contamination Mapping**: Model kitchen workflow to identify cross-contamination risks

---

## 4.7 Menu Management & Engineering

### 4.7.1 Overview & Business Value

Menu Management brings together recipes, costs, and analytics into a strategic menu planning tool. While the workbooks focus on individual recipe costing, CulinaryCore elevates this to menu-level strategy by providing menu engineering analysis, profitability optimization, and seasonal planning.

**Why this module exists**: A restaurant's menu is its most important marketing document and its primary profit driver. Menu engineering -- the systematic analysis of menu item popularity and profitability -- is well-established in hospitality management science but rarely implemented in recipe management software. Most competitors offer basic menu construction; CulinaryCore offers strategic menu optimization.

**Business value**:
- Data-driven menu decisions replace intuition
- Menu engineering matrix identifies Stars, Plowhorses, Puzzles, and Dogs
- Seasonal menu planning with cost and margin forecasting
- Multi-location menu management with local variations
- Menu versioning and A/B testing capabilities
- Direct integration with POS systems for sales mix data

### 4.7.2 Functional Requirements

#### MNU-FUNC-001: Menu Construction

The system SHALL allow users to build menus from recipes.

**Acceptance Criteria**:
- AC1: Create named menus (e.g., "Summer 2026 Dinner", "Brunch", "Catering Standard")
- AC2: Organize menu items into sections matching the 12 workbook categories [WB-REF: Set Up categories]
- AC3: Each menu item links to a recipe and inherits its cost, nutrition, and allergen data
- AC4: Menu items can override the recipe's selling price (location-specific pricing)
- AC5: Menu supports effective dates (start/end) for seasonal activation
- AC6: Multiple menus can be active simultaneously (e.g., lunch and dinner)

#### MNU-FUNC-002: Menu Engineering Matrix

The system SHALL provide menu engineering analysis using the Boston Consulting Group matrix methodology.

**Details**: Menu engineering classifies items into four quadrants based on popularity (sales mix) and profitability (contribution margin):

- **Stars**: High popularity + High profitability (maintain)
- **Plowhorses**: High popularity + Low profitability (reengineer)
- **Puzzles**: Low popularity + High profitability (promote)
- **Dogs**: Low popularity + Low profitability (remove or replace)

**Acceptance Criteria**:
- AC1: Calculate contribution margin for each menu item from recipe data [WB-REF: Row 38]
- AC2: Calculate popularity from POS sales data or manual input
- AC3: Plot items on a 2x2 matrix with interactive drill-down
- AC4: Automatically classify items as Star/Plowhorse/Puzzle/Dog
- AC5: Provide actionable recommendations for each quadrant
- AC6: Track category movement over time (quarterly comparison)

#### MNU-FUNC-003: Menu Pricing Analysis

The system SHALL provide tools for menu pricing strategy.

**Acceptance Criteria**:
- AC1: Price elasticity modeling: predict impact of price changes on margin
- AC2: Competitive pricing comparison (manual input of competitor prices)
- AC3: Price rounding rules (e.g., always end in .00 or .95)
- AC4: Batch price adjustment (increase all mains by 5%)
- AC5: Price impact simulation: "What if we increase all prices by 8%?"
- AC6: Psychological pricing suggestions based on menu category

#### MNU-FUNC-004: Menu Costing Summary

The system SHALL provide aggregate cost analysis across the entire menu.

**Acceptance Criteria**:
- AC1: Average food cost % across all menu items
- AC2: Weighted average food cost % by sales mix
- AC3: Total potential revenue per menu item
- AC4: Menu category profitability breakdown
- AC5: Best and worst performers by contribution margin
- AC6: Cost distribution histogram across all menu items

#### MNU-FUNC-005: Multi-Location Menu Management

The system SHALL support managing menus across multiple locations with variations.

**Acceptance Criteria**:
- AC1: Master menu managed at the organization level
- AC2: Locations can enable/disable specific menu items
- AC3: Locations can override selling prices
- AC4: Locations use their own supplier prices for cost calculation
- AC5: Cross-location menu comparison report
- AC6: Menu changes can be pushed to all locations or selected locations

#### MNU-FUNC-006: Menu Version History

The system SHALL maintain a complete history of menu versions.

**Acceptance Criteria**:
- AC1: Each menu change creates a version record
- AC2: Previous menu versions can be viewed and compared
- AC3: Menu versions can be restored (creating a new version with restored content)
- AC4: Version history includes who changed what and when
- AC5: Seasonal menus can be cloned from previous years' versions

### 4.7.3 User Stories

| ID | Story | Priority |
|---|---|---|
| MNU-US-001 | As a Restaurant Owner, I want to see a menu engineering matrix so that I can identify which dishes to promote, reprice, or remove. | Should Have |
| MNU-US-002 | As an Executive Chef, I want to build a seasonal menu from our recipe library so that I can plan next quarter's offerings with cost projections. | Should Have |
| MNU-US-003 | As a Location Manager, I want to adjust menu prices for my location while keeping the same recipes so that I can respond to local market conditions. | Should Have |
| MNU-US-004 | As a Finance Manager, I want to see the weighted average food cost across the entire menu so that I can assess overall profitability. | Should Have |
| MNU-US-005 | As an F&B Manager, I want to compare menu performance across our 5 locations so that I can identify best practices and underperformers. | Could Have |

### 4.7.4 Future Enhancements

- **AI Menu Optimization**: Suggest menu changes to maximize revenue based on sales data and cost constraints
- **Digital Menu Board Integration**: Push menu changes directly to digital signage
- **Customer Preference Analysis**: Link menu engineering to customer demographic data
- **Menu Design Tools**: Visual menu layout design with psychological placement optimization
- **Dynamic Pricing**: Time-of-day or demand-based price adjustments (happy hour automation)

---

## 4.8 Supplier Management

### 4.8.1 Overview & Business Value

Supplier Management extends the Supplier column in the workbook's Product List into a full supplier relationship management system. The workbook tracks which supplier provides each product; CulinaryCore manages the entire supplier relationship including contact information, contracts, performance metrics, and communication history.

**Why this module exists**: In the workbook, supplier information is a single column in the Product List. In reality, supplier relationships are complex: multiple contacts per supplier, multiple delivery schedules, volume discounts, contract terms, quality issues, and payment histories. Managing these relationships effectively directly impacts food cost, quality consistency, and operational reliability.

**Business value**:
- Centralized supplier information eliminates scattered records
- Performance tracking enables data-driven supplier selection
- Contract management ensures negotiated terms are honored
- Multiple supplier capability enables competitive bidding and risk mitigation
- Delivery scheduling reduces receiving overhead

### 4.8.2 Functional Requirements

#### SUP-FUNC-001: Supplier Profile Management

The system SHALL maintain comprehensive supplier profiles.

**Acceptance Criteria**:
- AC1: Supplier profile includes: company name, trade license, contacts (multiple), addresses, payment terms, delivery schedule, minimum order value, lead time
- AC2: Multiple contact persons per supplier with roles (sales, accounts, delivery)
- AC3: Supplier categories (produce, protein, dairy, dry goods, beverages, etc.)
- AC4: Supplier status: Active, Probation, Suspended, Inactive
- AC5: Document attachments (contracts, licenses, certificates)
- AC6: Supplier notes and communication log

#### SUP-FUNC-002: Supplier-Product Linking

The system SHALL manage the many-to-many relationship between suppliers and products.

**Acceptance Criteria**:
- AC1: Each product can have multiple suppliers [extends WB-REF: single Supplier column]
- AC2: Each supplier-product link includes: supplier's SKU, price, minimum order quantity, pack size
- AC3: One supplier is designated as primary for each product
- AC4: Price comparison view across all suppliers for a product
- AC5: Automatic suggestion to switch primary supplier when a lower price is available
- AC6: Supplier-product link history tracks all price changes

#### SUP-FUNC-003: Supplier Performance Scoring

The system SHALL track and score supplier performance.

**Acceptance Criteria**:
- AC1: Track on-time delivery rate
- AC2: Track order accuracy (correct items, correct quantities)
- AC3: Track quality consistency (rejection rate)
- AC4: Track price stability (frequency and magnitude of price increases)
- AC5: Composite performance score calculated from weighted metrics
- AC6: Performance trend visualization over time
- AC7: Supplier comparison by performance score within a category

#### SUP-FUNC-004: Supplier Catalog Import

The system SHALL support importing product catalogs from suppliers.

**Acceptance Criteria**:
- AC1: Import supplier price lists from Excel, CSV, or PDF
- AC2: AI-powered PDF price list extraction (OCR + intelligent parsing)
- AC3: Automatic matching of supplier items to existing products
- AC4: Highlight new items, price changes, and discontinued items
- AC5: Preview and confirm before applying catalog updates
- AC6: Import history with rollback capability

### 4.8.3 User Stories

| ID | Story | Priority |
|---|---|---|
| SUP-US-001 | As a Purchasing Manager, I want to maintain supplier profiles with all contact information so that I have a single source of truth for supplier communication. | Should Have |
| SUP-US-002 | As a Purchasing Manager, I want to compare prices from all suppliers for a product category so that I can negotiate better deals. | Should Have |
| SUP-US-003 | As a Purchasing Manager, I want to track supplier delivery performance so that I can make data-driven supplier selection decisions. | Could Have |
| SUP-US-004 | As a Purchasing Manager, I want to import a supplier's price list and have the system match items to our products so that I can update prices in bulk. | Should Have |

### 4.8.4 Future Enhancements

- **Supplier Portal**: Self-service portal where suppliers can update catalogs, respond to RFQs, and view order status
- **Automated RFQ**: Generate and send Requests for Quotation to multiple suppliers
- **Supplier Marketplace**: Browse and connect with new suppliers within the platform
- **Contract Compliance Monitoring**: Automated alerts when supplier behavior deviates from contract terms

---

## 4.9 Purchasing & Procurement

### 4.9.1 Overview & Business Value

Purchasing & Procurement is a new capability not present in the workbooks. The current process involves manually determining what to order based on par levels, creating orders by phone or email, and manually tracking deliveries. CulinaryCore automates this entire workflow.

**Why this module exists**: Purchasing is where food cost management meets operational reality. The most accurate recipe costing is meaningless if purchasing is inefficient -- over-ordering creates waste, under-ordering creates menu unavailability, and failure to track prices allows cost creep. Automated procurement closes the loop between recipe planning and supplier ordering.

**Business value**:
- Automated purchase order generation from production plans and par levels
- Elimination of manual order creation (phone/email/WhatsApp)
- Order history enables spend analysis and negotiation leverage
- Receiving verification ensures order accuracy
- Invoice reconciliation catches pricing discrepancies
- Multi-location consolidated purchasing enables volume discounts

### 4.9.2 Functional Requirements

#### PUR-FUNC-001: Purchase Order Creation

The system SHALL support creating purchase orders from multiple sources.

**Acceptance Criteria**:
- AC1: Manual PO creation with product search and quantity input
- AC2: Auto-generated PO from production plans (based on recipe quantities and production schedule)
- AC3: Auto-generated PO from par level triggers (current stock below reorder point)
- AC4: PO consolidation: combine items for the same supplier across sources
- AC5: PO split: split a large order across multiple suppliers for price optimization
- AC6: PO template: save frequently-used order templates for quick reuse

#### PUR-FUNC-002: Purchase Order Workflow

The system SHALL implement an approval workflow for purchase orders.

**Acceptance Criteria**:
- AC1: PO statuses: Draft, Pending Approval, Approved, Sent, Partially Received, Fully Received, Cancelled
- AC2: Approval thresholds configurable by role and amount
- AC3: POs below threshold auto-approve
- AC4: Multi-level approval for high-value orders
- AC5: PO can be sent to supplier via email or supplier portal
- AC6: PO history with full audit trail

#### PUR-FUNC-003: Receiving

The system SHALL support goods receiving against purchase orders.

**Acceptance Criteria**:
- AC1: Receive against a specific PO or ad-hoc receiving
- AC2: Record received quantity, condition, and temperature (for cold chain)
- AC3: Variance tracking: ordered vs. received quantities
- AC4: Reject items with reason codes (quality, wrong item, damaged, expired)
- AC5: Partial receiving with backorder tracking
- AC6: Photo documentation of received goods (quality evidence)
- AC7: Barcode scanning for receiving verification

#### PUR-FUNC-004: Invoice Reconciliation

The system SHALL support matching supplier invoices against POs and receiving records.

**Acceptance Criteria**:
- AC1: Three-way match: PO vs. receiving record vs. invoice
- AC2: Highlight discrepancies in quantity or price
- AC3: Tolerance thresholds for automatic matching (configurable)
- AC4: Disputed items workflow
- AC5: Invoice import from PDF (AI-powered extraction)
- AC6: Integration with accounting systems for payment processing

#### PUR-FUNC-005: Spend Analysis

The system SHALL provide comprehensive purchasing analytics.

**Acceptance Criteria**:
- AC1: Spend by supplier, category, product, time period
- AC2: Price trend analysis per product
- AC3: Purchase frequency analysis
- AC4: Budget vs. actual spend tracking
- AC5: Cost savings opportunity identification (same product, lower price from alternative supplier)
- AC6: Exportable reports for finance team

### 4.9.3 User Stories

| ID | Story | Priority |
|---|---|---|
| PUR-US-001 | As a Purchasing Manager, I want to generate a purchase order automatically from this week's production plan so that I order exactly what's needed. | Should Have |
| PUR-US-002 | As a Receiving Clerk, I want to scan incoming deliveries against the PO so that I can quickly verify order accuracy. | Should Have |
| PUR-US-003 | As a Finance Manager, I want to reconcile invoices against POs so that I can catch pricing discrepancies before payment. | Could Have |
| PUR-US-004 | As a Purchasing Manager, I want to see spending trends by supplier so that I can identify opportunities for negotiation. | Could Have |
| PUR-US-005 | As a Restaurant Owner, I want purchase orders above 10,000 AED to require my approval so that I maintain cost control. | Should Have |

### 4.9.4 Future Enhancements

- **AI-Powered Order Optimization**: Predict optimal order quantities based on historical consumption patterns, weather, events, and seasonality
- **Automatic Reordering**: Hands-free ordering when stock drops below par with human-in-the-loop approval
- **Supplier Bidding System**: Automated competitive bidding for large orders
- **Blockchain Traceability**: Track ingredient provenance from farm to plate

---

## 4.10 Inventory Management

### 4.10.1 Overview & Business Value

Inventory Management is a new capability not present in the workbooks. The current system has no inventory tracking -- the workbooks focus exclusively on recipe costing, not on what is physically in stock. CulinaryCore bridges this gap by connecting recipe-level theoretical usage to actual inventory levels.

**Why this module exists**: The gap between theoretical food cost (what recipes say it should cost) and actual food cost (what is actually spent) is the key metric for operational efficiency. Without inventory management, this gap cannot be measured. Inventory tracking also enables automated purchasing, waste analysis, and theft detection.

**Business value**:
- Visibility into actual stock levels across all locations
- Theoretical vs. actual food cost comparison (the most important operational metric)
- Waste tracking and reduction
- Automated reorder triggers prevent stockouts
- Inventory valuation for financial reporting
- Par level management for consistent stock availability
- Expiration tracking reduces waste from expired products

### 4.10.2 Functional Requirements

#### INV-FUNC-001: Stock Tracking

The system SHALL maintain real-time stock levels for all products.

**Acceptance Criteria**:
- AC1: Stock levels tracked by product, location, and storage area (walk-in, dry store, etc.)
- AC2: Stock in: receiving (from POs), production output (sub recipes), transfers in
- AC3: Stock out: recipe production (theoretical depletion), waste, transfers out, returns
- AC4: Current stock level = starting + stock_in - stock_out
- AC5: Stock displayed in working units (matching recipe units) and purchase units
- AC6: Multi-unit display (e.g., "3 cases + 2.5 kg" for a product sold by case)

#### INV-FUNC-002: Stock Count (Physical Inventory)

The system SHALL support periodic physical inventory counts.

**Acceptance Criteria**:
- AC1: Create count sheets by storage area, category, or full location
- AC2: Mobile-optimized count interface for walking through storage areas
- AC3: Barcode scanning for product identification during count
- AC4: Count variance report: system quantity vs. counted quantity
- AC5: Variance investigation workflow with reason codes
- AC6: Count approval workflow before adjusting system quantities
- AC7: Scheduled count reminders (daily, weekly, monthly by category)
- AC8: Blind counts (don't show expected quantity) or guided counts (show expected)

#### INV-FUNC-003: Waste Tracking

The system SHALL track and categorize waste.

**Acceptance Criteria**:
- AC1: Log waste by product, quantity, reason (spoilage, overproduction, quality, damage, expired)
- AC2: Waste cost calculated from current product price
- AC3: Waste trends by product, category, reason, time period
- AC4: Waste as percentage of purchases
- AC5: Waste alerts when a product's waste exceeds configurable threshold
- AC6: Photo documentation for waste logs

#### INV-FUNC-004: Par Level Management

The system SHALL support configurable par levels for automated reorder management.

**Acceptance Criteria**:
- AC1: Par levels set per product per location per day of week
- AC2: Reorder point: stock level that triggers a purchase suggestion
- AC3: Reorder quantity: suggested order amount (par - current stock)
- AC4: Dynamic par levels based on production schedules and historical usage
- AC5: Visual dashboard showing products at, above, or below par
- AC6: Integration with PO creation for one-click ordering

#### INV-FUNC-005: Theoretical vs. Actual Analysis

The system SHALL compare theoretical food usage (from recipes) against actual usage (from inventory changes).

**Acceptance Criteria**:
- AC1: Theoretical usage = recipes produced * ingredient quantities per recipe
- AC2: Actual usage = opening stock + purchases - closing stock - waste
- AC3: Variance = actual - theoretical
- AC4: Variance analysis by product, category, time period
- AC5: High-variance items flagged for investigation (potential theft, portioning issues, or recipe inaccuracy)
- AC6: Variance trend analysis to identify systemic issues

#### INV-FUNC-006: Inter-Location Transfers

The system SHALL support tracking product transfers between locations.

**Acceptance Criteria**:
- AC1: Create transfer request from one location to another
- AC2: Transfer approval workflow
- AC3: Sending location's stock decreases; receiving location's stock increases
- AC4: Transfer cost is calculated at the product's current cost
- AC5: Transfer history and reporting
- AC6: Pending transfers visible in both locations' inventory

### 4.10.3 User Stories

| ID | Story | Priority |
|---|---|---|
| INV-US-001 | As a Kitchen Manager, I want to see current stock levels for all products so that I know what I have available for today's service. | Should Have |
| INV-US-002 | As a Kitchen Manager, I want to conduct a weekly stock count using my iPad so that I can maintain accurate inventory records. | Should Have |
| INV-US-003 | As a Finance Manager, I want to compare theoretical food cost against actual food cost so that I can identify operational inefficiencies. | Should Have |
| INV-US-004 | As a Sous Chef, I want to log waste with a reason code so that we can analyze and reduce waste over time. | Should Have |
| INV-US-005 | As a Purchasing Manager, I want automatic reorder suggestions when stock drops below par so that we never run out of key ingredients. | Could Have |

### 4.10.4 Future Enhancements

- **IoT Integration**: Connect to smart scales and temperature sensors for automated stock monitoring
- **Camera-Based Counting**: Use computer vision to estimate stock levels from photos
- **Predictive Inventory**: AI-based demand forecasting to optimize stock levels
- **Expiration Date Management**: Track expiration dates and suggest FIFO usage order
- **Automated Waste Classification**: AI-powered categorization of waste from photos

---

## 4.11 Production Planning

### 4.11.1 Overview & Business Value

Production Planning replaces the manual prep list creation process that currently relies on chef experience and handwritten lists. It connects recipe management to daily kitchen operations by generating prep lists, scaling production quantities, and scheduling kitchen work.

**Why this module exists**: The bridge between "what recipes exist" and "what needs to be made today" is where recipe management meets kitchen reality. The SCALE sheet in Sub Rec.xlsm provides basic scaling; CulinaryCore integrates scaling with production scheduling, prep assignment, and completion tracking.

**Business value**:
- Eliminates handwritten prep lists and the errors they cause
- Ensures correct quantities are prepared based on expected covers/orders
- Optimizes kitchen labor by scheduling prep efficiently
- Tracks completion for accountability and workflow management
- Reduces waste from overproduction and stockouts from underproduction

### 4.11.2 Functional Requirements

#### PRO-FUNC-001: Prep List Generation

The system SHALL generate prep lists based on production requirements.

**Acceptance Criteria**:
- AC1: Generate prep list from expected covers and menu mix
- AC2: Generate prep list from catering/event orders
- AC3: Aggregate ingredient quantities across all recipes needing prep
- AC4: Account for current sub recipe inventory (don't prep what's already made)
- AC5: Organize prep list by station, prep cook assignment, or sub recipe
- AC6: Print-friendly prep list format optimized for kitchen use
- AC7: Digital prep list on kitchen tablets with completion checkboxes

#### PRO-FUNC-002: Batch Production Scheduling

The system SHALL support scheduling batch production of sub recipes.

**Acceptance Criteria**:
- AC1: Schedule sub recipe production with date, time, quantity, and assigned cook
- AC2: System suggests production schedule based on shelf life and expected usage
- AC3: Batch scaling: automatically calculate ingredient quantities for the scheduled batch size
- AC4: Conflict detection: warn if two large batches compete for the same equipment
- AC5: Production calendar view (week/day)
- AC6: Production completion logging with actual yield (for yield variance tracking)

#### PRO-FUNC-003: Kitchen Display System (KDS) Integration

The system SHALL support displaying prep tasks on kitchen display screens.

**Acceptance Criteria**:
- AC1: Prep tasks displayed on kitchen screens organized by station
- AC2: Real-time status updates (Not Started, In Progress, Complete)
- AC3: Timer integration for time-sensitive preparations
- AC4: Color-coded urgency based on production schedule
- AC5: Touch-screen interaction for status updates
- AC6: API for integration with third-party KDS systems

### 4.11.3 User Stories

| ID | Story | Priority |
|---|---|---|
| PRO-US-001 | As a Sous Chef, I want a prep list generated from tomorrow's expected covers so that I know exactly what to prepare. | Should Have |
| PRO-US-002 | As a Kitchen Manager, I want to schedule sub recipe production based on shelf life and usage so that we always have fresh preparations available. | Could Have |
| PRO-US-003 | As a Prep Cook, I want to see my assigned tasks on a kitchen screen so that I can work through them systematically. | Could Have |
| PRO-US-004 | As an Executive Chef, I want to track prep completion so that I can identify bottlenecks and staffing needs. | Could Have |

### 4.11.4 Future Enhancements

- **AI Production Forecasting**: Predict daily production needs based on historical data, weather, events, and reservations
- **Labor Cost Integration**: Calculate production labor cost alongside ingredient cost for total recipe cost
- **Equipment Scheduling**: Track oven/mixer/blast chiller availability for production scheduling
- **HACCP Logging**: Automated temperature and time logging for critical control points during production

---

## 4.12 AI Recipe Import

### 4.12.1 Overview & Business Value

AI Recipe Import is a differentiating feature that leverages artificial intelligence to extract structured recipe data from unstructured sources -- photos of recipe cards, PDF cookbooks, handwritten notes, screenshots, and even verbal descriptions.

**Why this module exists**: Professional kitchens accumulate recipes in countless formats: dog-eared recipe books, chef's personal notebooks, magazine clippings, supplier spec sheets, and oral traditions. The barrier to digitizing these recipes is the tedious manual data entry required. AI Recipe Import removes this barrier entirely.

**Business value**:
- Dramatically accelerates recipe library building
- Removes the #1 adoption barrier for new users (data entry)
- Enables digitization of legacy recipe collections
- Supports recipe capture during creative moments (photograph and forget until later)
- Competitive differentiation: no competitor offers this level of AI-powered import

### 4.12.2 Functional Requirements

#### AIR-FUNC-001: Photo Import

The system SHALL extract recipe data from photos of recipe cards, handwritten notes, and printed recipes.

**Acceptance Criteria**:
- AC1: Accept photos from camera, camera roll, or file upload
- AC2: Extract recipe name, ingredient list (names and quantities), and preparation steps
- AC3: Match extracted ingredient names to products in the database (fuzzy matching)
- AC4: Present extracted data for user review and correction before saving
- AC5: Confidence scores for each extracted field (highlight low-confidence items)
- AC6: Handle handwritten text in multiple languages (English, Arabic, French at minimum)
- AC7: Process multiple recipe photos in a single batch

#### AIR-FUNC-002: PDF Import

The system SHALL extract recipes from PDF documents (cookbooks, supplier guides, etc.).

**Acceptance Criteria**:
- AC1: Accept multi-page PDF documents
- AC2: Identify and extract individual recipes from a multi-recipe document
- AC3: Extract structured data: name, ingredients (with quantities and units), instructions
- AC4: Handle multi-column layouts and complex formatting
- AC5: Preview all extracted recipes before importing
- AC6: Selective import (choose which recipes to import from a batch)

#### AIR-FUNC-003: Text Import

The system SHALL create recipes from plain text descriptions or pasted content.

**Acceptance Criteria**:
- AC1: Accept free-text recipe descriptions
- AC2: Parse ingredient lists in various formats (e.g., "200g flour", "2 cups sugar", "a pinch of salt")
- AC3: Convert informal measurements to standard units
- AC4: Separate ingredients from instructions automatically
- AC5: Match parsed ingredients to products in the database

#### AIR-FUNC-004: URL Import

The system SHALL extract recipes from web URLs.

**Acceptance Criteria**:
- AC1: Accept a URL to a recipe webpage
- AC2: Extract recipe data using schema.org Recipe markup when available
- AC3: Fall back to AI extraction for pages without structured data
- AC4: Extract recipe name, ingredients, instructions, yield, and prep/cook times
- AC5: Handle common recipe website formats (Allrecipes, Food Network, etc.)

#### AIR-FUNC-005: Spreadsheet Import

The system SHALL import recipes from Excel/CSV files matching the workbook format.

**Details**: This is critical for the initial migration from the existing Recipes.xlsm and Sub Rec.xlsm workbooks.

**Acceptance Criteria**:
- AC1: Accept .xlsx and .xlsm files
- AC2: Auto-detect the workbook template format (39-row recipe or 42-row sub recipe)
- AC3: Map workbook columns to CulinaryCore fields
- AC4: Import all recipes/sub recipes from a multi-sheet workbook in one operation
- AC5: Handle formula cells by importing their calculated values
- AC6: Import product list with all 31 columns
- AC7: Validate imported data and report errors before committing
- AC8: Preview import mapping with sample data before executing

### 4.12.3 User Stories

| ID | Story | Priority |
|---|---|---|
| AIR-US-001 | As an Executive Chef, I want to photograph a recipe from my notebook and have the system digitize it so that I can build my digital recipe library without manual data entry. | Should Have |
| AIR-US-002 | As an IT Administrator, I want to import all 85 recipes from Recipes.xlsm so that we can migrate to CulinaryCore with our complete recipe library. | Must Have |
| AIR-US-003 | As an Executive Chef, I want to paste a recipe from a website and have it structured into our format so that I can quickly evaluate and adapt recipes from external sources. | Should Have |
| AIR-US-004 | As a Restaurant Owner, I want to import all 657 products from our Product List so that we can start using CulinaryCore without rebuilding our product database. | Must Have |

### 4.12.4 Future Enhancements

- **Voice Import**: Dictate a recipe and have AI transcribe and structure it
- **Video Import**: Extract recipe steps and ingredients from cooking videos
- **Multi-Language Translation**: Import recipes in any language and translate to the user's language
- **Automatic Costing**: Import a recipe and have AI estimate costs by matching to the product database and suggesting substitutions for unmatched ingredients

---

## 4.13 AI Assistant

### 4.13.1 Overview & Business Value

The AI Assistant is an intelligent, conversational interface that helps users accomplish tasks across all modules. It is powered by the AI abstraction layer and can leverage multiple AI providers (OpenAI, Anthropic, Gemini, Apple Foundation Models).

**Why this module exists**: Professional kitchen staff are busy, often have limited technology experience, and need answers fast. A conversational AI assistant lets users interact with the system naturally -- "What's the food cost on the lobster?" "Show me all recipes that use chimichurri" "What would happen if I replace salmon with trout?" -- without navigating complex menus.

**Business value**:
- Reduces training time for new users
- Accelerates common tasks (search, analysis, reporting)
- Provides insights that users might not discover through manual navigation
- Enables hands-free operation (voice interface) for kitchen environments
- Differentiates CulinaryCore from every competitor (AI-native, not AI-bolted)

### 4.13.2 Functional Requirements

#### AIA-FUNC-001: Conversational Interface

The system SHALL provide a conversational AI interface accessible from any screen.

**Acceptance Criteria**:
- AC1: Chat-style interface with text input and AI responses
- AC2: Context-aware: the AI knows what screen the user is on and can reference it
- AC3: Multi-turn conversations with memory of previous messages in the session
- AC4: Responses include actionable links (e.g., "Click here to open that recipe")
- AC5: Available on all platforms (web, macOS, iPadOS, iOS)
- AC6: Keyboard shortcut to invoke (Cmd+K / Ctrl+K)

#### AIA-FUNC-002: Recipe Intelligence

The system SHALL provide AI-powered recipe analysis and suggestions.

**Acceptance Criteria**:
- AC1: Answer questions about any recipe (cost, nutrition, allergens, instructions)
- AC2: Suggest ingredient substitutions with cost and nutrition impact
- AC3: Suggest cost reduction strategies for high-cost recipes
- AC4: Generate recipe descriptions for menus
- AC5: Compare recipes and explain differences
- AC6: Suggest recipes based on available ingredients

#### AIA-FUNC-003: Cost Intelligence

The system SHALL provide AI-powered cost analysis and optimization.

**Acceptance Criteria**:
- AC1: Identify the top cost drivers in a recipe
- AC2: Suggest menu price adjustments to meet food cost targets
- AC3: Predict the impact of ingredient price changes on the menu
- AC4: Identify seasonal cost optimization opportunities
- AC5: Generate cost reports with natural language summaries

#### AIA-FUNC-004: Voice Interface

The system SHALL support voice interaction for hands-free use in kitchen environments.

**Acceptance Criteria**:
- AC1: Voice-to-text input using device microphone
- AC2: Text-to-speech output for AI responses
- AC3: Wake word activation (configurable)
- AC4: Background noise filtering for kitchen environments
- AC5: Apple Siri integration on iOS/macOS (Shortcuts framework)
- AC6: Works offline using on-device speech recognition (Apple Speech framework)

#### AIA-FUNC-005: AI Provider Abstraction

The system SHALL support multiple AI providers through a unified abstraction layer.

**Acceptance Criteria**:
- AC1: Support OpenAI (GPT-4 and successors)
- AC2: Support Anthropic (Claude)
- AC3: Support Google Gemini
- AC4: Support Apple Foundation Models (on-device, privacy-preserving)
- AC5: Provider selection configurable per task type (e.g., Apple for on-device, OpenAI for complex analysis)
- AC6: Automatic fallback to secondary provider on primary failure
- AC7: Cost tracking per AI call for usage monitoring
- AC8: All AI calls include system context about the organization's recipes, products, and costs

### 4.13.3 User Stories

| ID | Story | Priority |
|---|---|---|
| AIA-US-001 | As an Executive Chef, I want to ask "What's my most expensive main course?" and get an instant answer so that I can quickly access insights without navigating reports. | Should Have |
| AIA-US-002 | As a Sous Chef, I want to ask "What can I substitute for pine nuts in the pesto?" and get suggestions with cost impact so that I can handle stockouts during service. | Should Have |
| AIA-US-003 | As a Line Cook, I want to use voice to ask "What allergens are in the molten cake?" while my hands are busy so that I can answer servers' questions without stopping work. | Could Have |
| AIA-US-004 | As a Restaurant Owner, I want a daily AI summary of cost changes and alerts so that I can start each day with an overview. | Could Have |

### 4.13.4 Future Enhancements

- **Proactive Insights**: AI-initiated notifications about opportunities or risks (e.g., "Lamb prices are rising, consider switching to chicken for the kebab")
- **Menu Description Writing**: Generate marketing-quality menu descriptions from recipes
- **Training Assistant**: Interactive training mode for new staff learning recipes
- **Multi-Language Support**: AI assistant in Arabic, English, French, Hindi, Filipino, and other common UAE kitchen languages

---

## 4.14 Reporting & Analytics

### 4.14.1 Overview & Business Value

Reporting & Analytics transforms the data collected across all modules into actionable intelligence. The workbooks provide index sheets with basic summaries; CulinaryCore provides comprehensive dashboards, trend analysis, and exportable reports.

**Why this module exists**: Data without analysis is noise. The Index sheets in both workbooks provide flat lists of recipes and costs. CulinaryCore turns this data into trends, comparisons, alerts, and recommendations that drive business decisions.

**Business value**:
- Executive dashboards provide at-a-glance operational visibility
- Trend analysis identifies cost creep before it becomes a crisis
- Comparative analytics across locations identify best practices and outliers
- Regulatory reports ensure compliance with minimal effort
- Custom reports reduce dependence on finance team for ad-hoc analysis

### 4.14.2 Functional Requirements

#### RPT-FUNC-001: Dashboard System

The system SHALL provide role-specific dashboards.

**Acceptance Criteria**:
- AC1: Executive dashboard: overall food cost %, top/bottom performers, revenue metrics, location comparison
- AC2: Chef dashboard: recipes by status, recent changes, recipes needing attention, prep status
- AC3: Purchasing dashboard: pending orders, price alerts, supplier performance, spend trends
- AC4: Inventory dashboard: stock levels, items below par, expiring items, waste summary
- AC5: Dashboards update in real-time using Supabase subscriptions
- AC6: Dashboards are customizable (add/remove/rearrange widgets)
- AC7: Dashboard data is cached for offline viewing

#### RPT-FUNC-002: Food Cost Reports

The system SHALL provide comprehensive food cost reporting.

**Acceptance Criteria**:
- AC1: Food cost % by recipe, category, menu, location, time period
- AC2: Food cost trend lines (daily, weekly, monthly, quarterly, yearly)
- AC3: Theoretical vs. actual food cost comparison
- AC4: Cost variance analysis with drill-down capability
- AC5: Top 10 cost drivers report
- AC6: Cost impact analysis for price changes
- AC7: Reports match the Index sheet layout for familiarity [WB-REF: Index sheet columns]

#### RPT-FUNC-003: Profitability Reports

The system SHALL provide profitability analysis reports.

**Acceptance Criteria**:
- AC1: Contribution margin by recipe, category, menu section
- AC2: Revenue vs. cost analysis by time period
- AC3: Menu engineering matrix report (Stars, Plowhorses, Puzzles, Dogs)
- AC4: Price elasticity analysis (if POS data is available)
- AC5: Break-even analysis per recipe
- AC6: Profit and loss summary by location

#### RPT-FUNC-004: Nutrition & Allergen Reports

The system SHALL provide nutrition and allergen compliance reports.

**Acceptance Criteria**:
- AC1: Allergen matrix for the entire menu
- AC2: Nutrition summary for all menu items
- AC3: Recipes with unverified nutrition data
- AC4: Products missing allergen declarations
- AC5: Regulatory compliance checklist with status
- AC6: Reports formatted for health authority submissions

#### RPT-FUNC-005: Custom Report Builder

The system SHALL provide a custom report builder for ad-hoc analysis.

**Acceptance Criteria**:
- AC1: Select data sources (recipes, products, suppliers, inventory, purchases)
- AC2: Choose fields, filters, grouping, and sorting
- AC3: Choose visualization type (table, bar chart, line chart, pie chart)
- AC4: Save custom reports for reuse
- AC5: Schedule automated report generation and delivery via email
- AC6: Export reports to PDF, Excel, CSV, and PNG

#### RPT-FUNC-006: Report Export

The system SHALL support exporting reports in multiple formats.

**Acceptance Criteria**:
- AC1: PDF with professional formatting and branding
- AC2: Excel with formula-enabled cells for further analysis
- AC3: CSV for data import into other systems
- AC4: PNG/SVG for chart images
- AC5: Scheduled email delivery with attached reports
- AC6: API access for integration with BI tools (Power BI, Tableau)

### 4.14.3 User Stories

| ID | Story | Priority |
|---|---|---|
| RPT-US-001 | As a Restaurant Owner, I want an executive dashboard showing food cost % across all locations so that I can monitor performance at a glance. | Must Have |
| RPT-US-002 | As a Finance Manager, I want monthly food cost reports exported to Excel so that I can include them in financial statements. | Must Have |
| RPT-US-003 | As an Executive Chef, I want to see food cost trends over the past 12 months so that I can identify seasonal patterns and take proactive action. | Should Have |
| RPT-US-004 | As a Compliance Officer, I want to generate a complete allergen matrix for health inspector review so that I can demonstrate compliance. | Must Have |
| RPT-US-005 | As a Purchasing Manager, I want a spend analysis by supplier over the past quarter so that I have data for upcoming contract negotiations. | Should Have |

### 4.14.4 Future Enhancements

- **AI-Powered Insights**: Natural language report summaries with key takeaways
- **Anomaly Detection**: Automated flagging of unusual patterns in cost, waste, or purchasing
- **Predictive Analytics**: Forecast future food costs, revenue, and waste based on trends
- **Benchmarking**: Compare metrics against industry benchmarks or peer group data
- **Real-Time P&L**: Live profit and loss calculation integrating POS revenue with food cost data

---

## 4.15 User Management & RBAC

### 4.15.1 Overview & Business Value

User Management and Role-Based Access Control (RBAC) provides the security foundation for CulinaryCore. The Excel workbooks have no access control -- anyone with file access can view and modify everything. CulinaryCore implements granular permissions that protect sensitive data while enabling appropriate access.

**Why this module exists**: A recipe management system contains commercially sensitive information (recipes, costs, margins, supplier pricing) that must be protected. Different roles need different levels of access: a line cook needs to read recipes but should not see food cost percentages; a purchasing manager needs supplier prices but should not modify recipes. RBAC ensures each user sees exactly what they need and nothing more.

**Business value**:
- Protection of commercial intellectual property (recipes, costs, margins)
- Compliance with data protection regulations
- Accountability through individual user accounts
- Reduced risk of accidental data modification
- Multi-tenant isolation for restaurant groups
- External auditor access without security risk

### 4.15.2 Functional Requirements

#### USR-FUNC-001: Authentication

The system SHALL provide secure, multi-method authentication.

**Acceptance Criteria**:
- AC1: Email + password authentication with password strength requirements
- AC2: Apple Sign In (required for iOS App Store) with Face ID / Touch ID
- AC3: Google Sign In
- AC4: Magic link (passwordless email) authentication
- AC5: Multi-factor authentication (TOTP, SMS, or authenticator app)
- AC6: Session management with configurable timeout (default 24 hours)
- AC7: Automatic session extension during active use
- AC8: Force logout capability for administrators
- AC9: Biometric authentication on supported devices (Face ID, Touch ID)

#### USR-FUNC-002: Role-Based Access Control

The system SHALL implement granular role-based permissions.

**Default Roles and Permissions**:

| Permission | Owner | Admin | Exec Chef | Sous Chef | Line Cook | Purchasing | Finance | Nutritionist | Auditor |
|---|---|---|---|---|---|---|---|---|---|
| View recipes (no cost) | Yes | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes |
| View recipe costs | Yes | Yes | Yes | Yes | No | Yes | Yes | No | Yes |
| Create/edit recipes | Yes | Yes | Yes | Yes | No | No | No | No | No |
| Approve recipes | Yes | Yes | Yes | No | No | No | No | No | No |
| View products | Yes | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes |
| Edit products | Yes | Yes | Yes | No | No | Yes | No | No | No |
| View supplier prices | Yes | Yes | No | No | No | Yes | Yes | No | Yes |
| Manage suppliers | Yes | Yes | No | No | No | Yes | No | No | No |
| Create POs | Yes | Yes | No | No | No | Yes | No | No | No |
| Approve POs | Yes | Yes | No | No | No | No | Yes | No | No |
| View inventory | Yes | Yes | Yes | Yes | Yes | Yes | Yes | No | Yes |
| Adjust inventory | Yes | Yes | Yes | Yes | No | Yes | No | No | No |
| View reports | Yes | Yes | Yes | No | No | Yes | Yes | Yes | Yes |
| Manage users | Yes | Yes | No | No | No | No | No | No | No |
| System configuration | Yes | Yes | No | No | No | No | No | No | No |
| View audit logs | Yes | Yes | No | No | No | No | Yes | No | Yes |

**Acceptance Criteria**:
- AC1: System ships with the default roles defined above
- AC2: Roles can be customized: permissions can be added or removed from any role
- AC3: Custom roles can be created
- AC4: Users can have multiple roles (permissions are the union of all role permissions)
- AC5: Role assignment is per organization and optionally per location
- AC6: Permission changes take effect immediately (no session restart required)
- AC7: Supabase Row Level Security (RLS) policies enforce permissions at the database level

#### USR-FUNC-003: Multi-Tenant Organization Management

The system SHALL support multiple organizations with complete data isolation.

**Acceptance Criteria**:
- AC1: Each organization's data is completely isolated at the database level (RLS)
- AC2: Users belong to one or more organizations
- AC3: Users can switch between organizations without logging out
- AC4: Organization settings: name, logo, base currency, default VAT rate, security margin, time zone
- AC5: Organization-level feature toggles
- AC6: Organization billing and subscription management

#### USR-FUNC-004: Location Management

The system SHALL support multiple locations within an organization.

**Acceptance Criteria**:
- AC1: Users can be assigned to one or more locations
- AC2: Location-specific data: inventory, purchase orders, supplier prices, menu variations
- AC3: Cross-location visibility for organization admins
- AC4: Location-level settings: address, operating hours, contact information
- AC5: Data can be scoped to a location or viewed across all locations

#### USR-FUNC-005: User Activity Logging

The system SHALL log user activity for security and compliance purposes.

**Acceptance Criteria**:
- AC1: Log all login/logout events
- AC2: Log all create/update/delete operations with user, timestamp, and changed fields
- AC3: Log failed login attempts with IP address
- AC4: Activity log is searchable by user, action type, entity type, and date range
- AC5: Activity log is exportable for compliance audits
- AC6: Suspicious activity alerts (multiple failed logins, unusual access patterns)

### 4.15.3 User Stories

| ID | Story | Priority |
|---|---|---|
| USR-US-001 | As a Restaurant Owner, I want to control which staff can see food cost percentages so that sensitive financial data is only visible to managers. | Must Have |
| USR-US-002 | As an IT Administrator, I want to create user accounts with role-based permissions so that each staff member has appropriate access. | Must Have |
| USR-US-003 | As a Line Cook, I want to log in with Face ID on my iPad so that I can access recipes quickly without typing a password. | Should Have |
| USR-US-004 | As a Restaurant Owner, I want my accountant to have read-only access to cost data so that they can audit without risk of modification. | Must Have |
| USR-US-005 | As an IT Administrator, I want to see who logged in and what they changed so that I can investigate any issues. | Should Have |

### 4.15.4 Future Enhancements

- **SSO/SAML Integration**: Enterprise single sign-on for large restaurant groups
- **API Key Management**: Service accounts for system-to-system integration
- **Conditional Access**: Location-based or time-based access restrictions (e.g., only allow PO approval from the office network)
- **Privacy Compliance**: GDPR/CCPA-compliant user data management

---

## 4.16 Version Control & Audit

### 4.16.1 Overview & Business Value

Version Control and Audit provides a complete history of every change to every entity in the system. The Excel workbooks have no version control; a change is permanent and unrecoverable unless an external backup exists.

**Why this module exists**: In a professional kitchen environment, recipe accuracy is paramount. A single incorrect ingredient quantity could ruin an entire batch of production or, in the case of allergens, endanger a customer's health. Version control ensures that every change is recorded, reversible, and attributable to a specific user.

**Business value**:
- Full change history for compliance and dispute resolution
- Ability to compare and revert to any previous version
- Attribution of changes to specific users for accountability
- Protection against accidental modifications
- Regulatory compliance (food safety audit trails)

### 4.16.2 Functional Requirements

#### VER-FUNC-001: Entity Versioning

The system SHALL maintain a complete version history for recipes, sub recipes, and products.

**Acceptance Criteria**:
- AC1: Every save creates a new version with a sequential version number
- AC2: Versions are immutable -- once created, they cannot be modified
- AC3: Each version records the complete state of the entity (not just the delta)
- AC4: Version metadata includes: version number, user, timestamp, change summary
- AC5: Any previous version can be viewed in full detail
- AC6: Side-by-side comparison between any two versions with differences highlighted
- AC7: Revert to a previous version (creates a new version with the old content, does not delete intermediate versions)

#### VER-FUNC-002: Audit Trail

The system SHALL maintain a comprehensive audit trail for all system operations.

**Acceptance Criteria**:
- AC1: Every create, update, and delete operation is logged
- AC2: Audit entries include: entity type, entity ID, action, user, timestamp, IP address, old values, new values
- AC3: Audit trail is tamper-proof (append-only, no modifications or deletions)
- AC4: Audit trail is searchable by entity, user, action type, and date range
- AC5: Audit trail can be exported for external audit
- AC6: Sensitive fields (costs, prices) have their changes specifically highlighted

#### VER-FUNC-003: Change Notifications

The system SHALL notify relevant users when important changes occur.

**Acceptance Criteria**:
- AC1: Recipe owners notified when their recipe is modified by another user
- AC2: Purchasing notified when product prices change
- AC3: Chefs notified when a product they use is discontinued
- AC4: Configurable notification preferences (in-app, email, push)
- AC5: Digest mode: batch notifications into periodic summaries

### 4.16.3 User Stories

| ID | Story | Priority |
|---|---|---|
| VER-US-001 | As an Executive Chef, I want to see who changed a recipe and what they changed so that I can maintain recipe integrity. | Must Have |
| VER-US-002 | As an Executive Chef, I want to revert a recipe to a previous version so that I can undo an incorrect modification. | Must Have |
| VER-US-003 | As a Finance Manager, I want an audit trail of all price changes so that I can investigate cost discrepancies. | Should Have |
| VER-US-004 | As an Executive Chef, I want to be notified when someone modifies one of my recipes so that I can review the change. | Should Have |

### 4.16.4 Future Enhancements

- **Change Impact Analysis**: Show cascading effects of a change before committing
- **Branch and Merge**: Create experimental branches for recipes (like Git branches for code)
- **Approval Workflows**: Require sign-off on changes to critical recipes
- **Blame View**: Show who last modified each ingredient line in a recipe

---

## 4.17 Notifications & Tasks

### 4.17.1 Overview & Business Value

Notifications & Tasks provides a centralized system for alerting users to important events and managing action items. The workbook system has no notification capability; users discover issues only through manual inspection.

**Why this module exists**: In a multi-user system managing critical operational data, users must be proactively informed about events that require their attention. A price change, an expiring product, a recipe modification, or a stock level below par should not wait until someone happens to check.

**Business value**:
- Proactive issue detection reduces response time
- Task management ensures follow-up actions are completed
- Configurable notification channels (in-app, email, push, SMS) suit different users
- Notification history provides an audit trail of communications
- Reduces manual monitoring and checking effort

### 4.17.2 Functional Requirements

#### NOT-FUNC-001: Notification Engine

The system SHALL deliver notifications through multiple channels based on event type and user preference.

**Notification Events**:
- Product price change (above threshold)
- Recipe modified by another user
- Recipe status change (e.g., moved to Pending Approval)
- Stock level below par / below reorder point
- Sub recipe batch expiring (shelf life)
- Purchase order requiring approval
- Purchase order delivered
- Cost alert (food cost % above target)
- New product added requiring allergen declaration
- System maintenance scheduled
- Inventory count due

**Acceptance Criteria**:
- AC1: In-app notification center with badge count
- AC2: Push notifications on mobile devices (iOS, iPadOS)
- AC3: Email notifications with HTML formatting
- AC4: Notification preferences configurable per user per event type
- AC5: Quiet hours configuration (no push/email during specified hours)
- AC6: Notification history retained for 90 days
- AC7: Mark as read, archive, and snooze actions

#### NOT-FUNC-002: Task Management

The system SHALL support creating and tracking tasks related to operational activities.

**Acceptance Criteria**:
- AC1: Create tasks manually or from notifications (e.g., "Investigate price increase" from a cost alert)
- AC2: Assign tasks to specific users
- AC3: Task statuses: Open, In Progress, Done, Cancelled
- AC4: Due dates with overdue alerts
- AC5: Task comments and history
- AC6: Task list view filtered by assignee, status, due date
- AC7: Task integration with calendar

### 4.17.3 User Stories

| ID | Story | Priority |
|---|---|---|
| NOT-US-001 | As a Purchasing Manager, I want push notifications when a product price increases by more than 10% so that I can investigate immediately. | Should Have |
| NOT-US-002 | As an Executive Chef, I want to be notified when a sous chef modifies one of my recipes so that I can review the change. | Should Have |
| NOT-US-003 | As a Kitchen Manager, I want to create a task to "investigate high waste on salmon" and assign it to the prep team so that the issue is tracked to resolution. | Could Have |
| NOT-US-004 | As any user, I want to configure my notification preferences so that I only receive alerts that are relevant to my role. | Should Have |

### 4.17.4 Future Enhancements

- **Smart Notifications**: AI-powered notification prioritization based on user behavior and importance
- **Workflow Automation**: Trigger notifications from custom workflow rules
- **Slack/Teams Integration**: Deliver notifications to team messaging platforms
- **Escalation Rules**: Unacknowledged notifications escalate to managers

---

## 4.18 Document Management

### 4.18.1 Overview & Business Value

Document Management provides secure storage, organization, and retrieval of documents associated with suppliers, products, recipes, and compliance. The workbooks have no document management; related documents exist in email attachments, shared drives, and physical filing.

**Why this module exists**: Professional food service operations generate and consume numerous documents: supplier contracts, health certificates, lab reports, HACCP plans, recipe development notes, training materials, and regulatory submissions. Having these documents contextually linked to the relevant entities (supplier, product, recipe) dramatically improves accessibility and compliance.

**Business value**:
- Centralized document repository eliminates scattered storage
- Contextual linking means documents are where you need them (attached to the relevant supplier/product/recipe)
- Version control for documents prevents use of outdated versions
- Regulatory compliance documentation is readily accessible for inspections
- Secure access control ensures sensitive documents are protected

### 4.18.2 Functional Requirements

#### DOC-FUNC-001: Document Storage

The system SHALL provide secure document storage using Supabase Storage.

**Acceptance Criteria**:
- AC1: Upload documents (PDF, Word, Excel, images, video)
- AC2: Maximum file size: 50MB per document
- AC3: Organization-level storage quota management
- AC4: Automatic virus scanning on upload
- AC5: Document preview without download (PDF, images)
- AC6: Document versioning (upload new version, access previous versions)

#### DOC-FUNC-002: Document Categorization

The system SHALL support organizing documents by type and linking them to entities.

**Document Types**:
- Supplier contracts
- Product specification sheets
- Nutrition certificates
- Health and safety certificates (HACCP plans, licenses)
- Recipe development notes
- Training materials
- Regulatory submissions
- Photos (products, recipes, plating)
- Invoices and purchase records

**Acceptance Criteria**:
- AC1: Documents can be linked to one or more entities (supplier, product, recipe, location)
- AC2: Documents are categorized by type
- AC3: Full-text search across document content (OCR for scanned documents)
- AC4: Tag-based organization
- AC5: Expiration date tracking for certificates and contracts
- AC6: Notification when a document is approaching expiration

#### DOC-FUNC-003: Document Access Control

The system SHALL enforce access control on documents based on RBAC.

**Acceptance Criteria**:
- AC1: Document visibility follows the parent entity's access control
- AC2: Documents can be restricted to specific roles (e.g., contracts visible only to management)
- AC3: Download tracking (who downloaded what and when)
- AC4: Watermarking for sensitive documents
- AC5: External sharing with time-limited, password-protected links

### 4.18.3 User Stories

| ID | Story | Priority |
|---|---|---|
| DOC-US-001 | As a Purchasing Manager, I want to attach supplier contracts to the supplier profile so that I can reference terms during negotiations. | Could Have |
| DOC-US-002 | As a Compliance Officer, I want to track health certificate expiration dates so that I ensure all certifications are current. | Could Have |
| DOC-US-003 | As an Executive Chef, I want to attach development notes and photos to recipe drafts so that I can document the R&D process. | Could Have |

### 4.18.4 Future Enhancements

- **AI Document Analysis**: Extract key terms, dates, and obligations from contracts using AI
- **Optical Character Recognition**: Full OCR for scanned documents to enable text search
- **Digital Signature**: E-sign capability for contracts and compliance documents
- **Regulatory Template Library**: Pre-built templates for common regulatory submissions

---

# 5. Non-Functional Requirements

## 5.1 Performance Requirements

### 5.1.1 Response Time

| Operation | Target | Maximum |
|---|---|---|
| Page load (cached) | < 500ms | < 1s |
| Page load (first visit) | < 2s | < 4s |
| Search results | < 200ms | < 500ms |
| Cost recalculation (single recipe) | < 100ms | < 300ms |
| Cost cascade (100 affected recipes) | < 2s | < 5s |
| Cost cascade (1000 affected recipes) | < 10s | < 30s |
| Report generation (standard) | < 3s | < 10s |
| Report generation (complex/large) | < 15s | < 60s |
| AI assistant response (first token) | < 1s | < 3s |
| Offline data access | < 100ms | < 300ms |
| Photo upload and processing | < 5s | < 15s |
| Recipe import (single) | < 2s | < 5s |
| Bulk import (100 recipes) | < 30s | < 120s |

**Rationale**: Kitchen environments demand fast response times. A chef checking a recipe during service cannot wait more than a few seconds. Cost recalculation must be effectively instant for the system to provide real-time feedback during recipe development.

### 5.1.2 Throughput

| Metric | Requirement |
|---|---|
| Concurrent users per organization | 100 |
| Concurrent users system-wide | 10,000 |
| API requests per second (per organization) | 500 |
| Recipes per organization | 10,000 |
| Sub recipes per organization | 50,000 |
| Products per organization | 100,000 |
| Ingredient lines per recipe | 100 |
| Nesting depth for sub recipes | 10 levels |
| Locations per organization | 100 |
| Version history entries per entity | Unlimited |

### 5.1.3 Data Volume

| Metric | Year 1 Target | Year 3 Target |
|---|---|---|
| Organizations | 500 | 5,000 |
| Total recipes across all organizations | 500,000 | 5,000,000 |
| Total products across all organizations | 50,000,000 | 500,000,000 |
| Document storage | 1 TB | 20 TB |
| Database size | 100 GB | 2 TB |

## 5.2 Security Requirements

### 5.2.1 Authentication & Authorization

| ID | Requirement |
|---|---|
| SEC-AUTH-001 | All authentication SHALL use Supabase Auth with JWT tokens |
| SEC-AUTH-002 | Passwords SHALL meet minimum complexity: 8 characters, mixed case, number, special character |
| SEC-AUTH-003 | Password hashing SHALL use bcrypt with a work factor of 12 or higher |
| SEC-AUTH-004 | Failed login lockout SHALL activate after 5 failed attempts (15-minute lockout) |
| SEC-AUTH-005 | Session tokens SHALL expire after 24 hours of inactivity |
| SEC-AUTH-006 | Multi-factor authentication SHALL be available for all accounts and mandatory for admin roles |
| SEC-AUTH-007 | All database queries SHALL be protected by Supabase Row Level Security (RLS) policies |

### 5.2.2 Data Protection

| ID | Requirement |
|---|---|
| SEC-DATA-001 | All data in transit SHALL be encrypted using TLS 1.3 |
| SEC-DATA-002 | All data at rest SHALL be encrypted using AES-256 |
| SEC-DATA-003 | Database backups SHALL be encrypted and stored in a geographically separate region |
| SEC-DATA-004 | Personally identifiable information (PII) SHALL be identified and handled per GDPR/CCPA requirements |
| SEC-DATA-005 | API keys and secrets SHALL be stored in environment variables, never in code or database |
| SEC-DATA-006 | Client-side data (IndexedDB/SQLite) SHALL be encrypted on-device |

### 5.2.3 API Security

| ID | Requirement |
|---|---|
| SEC-API-001 | All API endpoints SHALL require authentication (except health check and public marketing pages) |
| SEC-API-002 | Rate limiting SHALL be applied: 100 requests/minute for standard users, 1000/minute for admin |
| SEC-API-003 | Input validation SHALL be applied to all API parameters |
| SEC-API-004 | SQL injection prevention via parameterized queries (Supabase handles this by default) |
| SEC-API-005 | XSS prevention via output encoding and Content Security Policy headers |
| SEC-API-006 | CORS SHALL be configured to allow only approved origins |

### 5.2.4 Compliance

| ID | Requirement |
|---|---|
| SEC-COMP-001 | System SHALL comply with UAE Federal Decree-Law No. 45 of 2021 (data protection) |
| SEC-COMP-002 | System SHALL support GDPR compliance for EU-based organizations |
| SEC-COMP-003 | System SHALL support CCPA compliance for US-based organizations |
| SEC-COMP-004 | Annual security audit by an independent third party |
| SEC-COMP-005 | SOC 2 Type II certification target within 18 months of launch |
| SEC-COMP-006 | Penetration testing SHALL be conducted quarterly |

## 5.3 Reliability & Availability

| ID | Requirement |
|---|---|
| REL-001 | System uptime SHALL be 99.9% (excluding planned maintenance) |
| REL-002 | Planned maintenance windows SHALL be scheduled during lowest-usage hours (typically 2-6 AM local time) |
| REL-003 | Maintenance SHALL be zero-downtime where possible (rolling deployments) |
| REL-004 | Recovery Point Objective (RPO): 1 hour (maximum data loss in case of failure) |
| REL-005 | Recovery Time Objective (RTO): 4 hours (maximum time to restore service) |
| REL-006 | Database SHALL be replicated across at least 2 availability zones |
| REL-007 | Automated failover SHALL be configured for database and API servers |
| REL-008 | System SHALL degrade gracefully: if AI services are unavailable, all other functions continue |
| REL-009 | Offline mode SHALL provide full read access and basic write access during connectivity loss |

## 5.4 Scalability

| ID | Requirement |
|---|---|
| SCL-001 | Horizontal scaling: API layer SHALL scale from 1 to 100 instances based on load |
| SCL-002 | Database SHALL support read replicas for reporting workloads |
| SCL-003 | File storage SHALL scale to petabyte capacity without architecture changes |
| SCL-004 | Cost calculation engine SHALL scale linearly with recipe count (O(n) not O(n^2)) |
| SCL-005 | Search indexing SHALL support sub-second queries across millions of records |
| SCL-006 | Multi-region deployment SHALL be supported for global expansion |
| SCL-007 | Database connection pooling SHALL be used to manage concurrent connections |

## 5.5 Accessibility

| ID | Requirement |
|---|---|
| ACC-001 | Web application SHALL conform to WCAG 2.1 Level AA |
| ACC-002 | All interactive elements SHALL be keyboard-navigable |
| ACC-003 | Color SHALL NOT be the sole means of conveying information (color-blind safe) |
| ACC-004 | Text contrast ratio SHALL be at least 4.5:1 (AA standard) |
| ACC-005 | All images SHALL have meaningful alt text |
| ACC-006 | Screen reader compatibility (VoiceOver on Apple devices, NVDA on Windows) |
| ACC-007 | Touch targets SHALL be at least 44x44 points on touch devices |
| ACC-008 | Font size SHALL be configurable (minimum 14px body text, support up to 200% zoom) |
| ACC-009 | Motion/animation SHALL respect user's "reduce motion" preference |
| ACC-010 | Right-to-left (RTL) layout support for Arabic language users |

## 5.6 Internationalization & Localization

| ID | Requirement |
|---|---|
| I18N-001 | UI text SHALL be externalized for translation (no hardcoded strings) |
| I18N-002 | Initial languages: English (default), Arabic |
| I18N-003 | Future languages: French, Hindi, Filipino, Mandarin |
| I18N-004 | Date format SHALL follow locale settings (DD/MM/YYYY for UAE) |
| I18N-005 | Number format SHALL follow locale settings (comma vs. period for decimal) |
| I18N-006 | Currency display SHALL be configurable per organization |
| I18N-007 | RTL layout SHALL be fully supported for Arabic |
| I18N-008 | Nutrition label formats SHALL be locale-specific (UAE, EU, US, UK) |
| I18N-009 | Unit system SHALL support metric and imperial with automatic conversion |

## 5.7 Offline Capability

### 5.7.1 Offline Architecture

The system uses a local-first architecture where data is stored on-device and synchronized with the server when connectivity is available. This ensures uninterrupted operation in kitchen environments where connectivity is unreliable.

| ID | Requirement |
|---|---|
| OFF-001 | All recipe and sub recipe data SHALL be available offline |
| OFF-002 | Product data (including prices) SHALL be available offline |
| OFF-003 | Allergen information SHALL be available offline (safety requirement) |
| OFF-004 | New recipes and sub recipes can be created offline |
| OFF-005 | Existing recipes and sub recipes can be edited offline |
| OFF-006 | Cost calculations SHALL work offline using cached product prices |
| OFF-007 | Inventory counts can be performed offline |
| OFF-008 | Offline changes SHALL sync automatically when connectivity returns |
| OFF-009 | Conflict resolution for concurrent offline edits: last-write-wins with conflict notification |
| OFF-010 | Offline data SHALL be encrypted on-device |
| OFF-011 | Sync status SHALL be clearly indicated in the UI |
| OFF-012 | Initial data download SHALL complete within 60 seconds for an organization with 1000 recipes |
| OFF-013 | Incremental sync SHALL transfer only changed data |
| OFF-014 | Sync SHALL be resilient to interruption (resume from where it left off) |

### 5.7.2 Offline Data Boundaries

| Data | Offline Read | Offline Write |
|---|---|---|
| Recipes | Yes | Yes (create/edit) |
| Sub Recipes | Yes | Yes (create/edit) |
| Products | Yes | Yes (create/edit) |
| Nutrition Data | Yes | Yes |
| Allergen Data | Yes | Yes |
| Cost Calculations | Yes (cached prices) | N/A (auto-calculated) |
| Inventory | Yes | Yes (counts, waste logging) |
| Purchase Orders | Yes (view) | No (requires connectivity for supplier communication) |
| Reports | Yes (cached) | No (requires full dataset) |
| AI Features | Limited (Apple Foundation Models on-device only) | N/A |
| Document Attachments | Cached (recent/favorite) | No (upload requires connectivity) |

## 5.8 Multi-Tenant Architecture

| ID | Requirement |
|---|---|
| MT-001 | Each organization's data SHALL be completely isolated from other organizations |
| MT-002 | Data isolation SHALL be enforced at the database level using PostgreSQL Row Level Security |
| MT-003 | No organization SHALL be able to access, query, or infer the existence of another organization's data |
| MT-004 | System administration (platform level) SHALL be separated from organization administration |
| MT-005 | Performance of one organization SHALL NOT degrade due to load from another organization |
| MT-006 | Organizations SHALL be independently configurable (settings, features, branding) |
| MT-007 | Data residency requirements SHALL be met (e.g., UAE data stays in UAE region) |

## 5.9 Backup & Recovery

| ID | Requirement |
|---|---|
| BKP-001 | Automated database backups every hour |
| BKP-002 | Point-in-time recovery capability (any point within the last 30 days) |
| BKP-003 | Backup verification (automated restore test weekly) |
| BKP-004 | Backups stored in geographically separate region |
| BKP-005 | Document/file storage backed up daily |
| BKP-006 | Disaster recovery plan with documented and tested procedures |
| BKP-007 | Data export capability for organizations (all their data in portable format) |

## 5.10 Monitoring & Observability

| ID | Requirement |
|---|---|
| MON-001 | Application performance monitoring (APM) with distributed tracing |
| MON-002 | Error tracking with automatic alerting (Sentry or equivalent) |
| MON-003 | Infrastructure monitoring (CPU, memory, disk, network) |
| MON-004 | Database query performance monitoring with slow query logging |
| MON-005 | User analytics (feature usage, engagement metrics) |
| MON-006 | Real-time dashboard for system health |
| MON-007 | Automated alerting for SLA breaches |
| MON-008 | Structured logging with correlation IDs for request tracing |

---

# 6. Cross-Platform Requirements

## 6.1 Platform Strategy

CulinaryCore targets four platforms from a single React/TypeScript codebase, wrapped in platform-specific shells for native API access.

| Platform | Shell Technology | Distribution | Priority |
|---|---|---|---|
| Web | None (Progressive Web App) | Direct URL | P0 |
| iPadOS | Capacitor | App Store | P0 |
| iOS (iPhone) | Capacitor | App Store | P1 |
| macOS | Tauri | Mac App Store + Direct | P1 |

**Rationale for platform priority**:
- **Web**: Universal access, no installation, instant updates. Critical for admin and back-office use.
- **iPadOS**: The primary kitchen device. iPads are the dominant tablet in professional kitchens due to durability cases, wall mounting options, and the Apple ecosystem.
- **iOS**: For on-the-go access -- purchasing managers at markets, chefs during meetings, owners reviewing dashboards.
- **macOS**: For power users doing extended recipe development, report analysis, and system administration.

## 6.2 Shared Codebase Requirements

| ID | Requirement |
|---|---|
| XPL-001 | 95% minimum code reuse across all platforms |
| XPL-002 | Platform-specific code SHALL be isolated in clearly marked modules |
| XPL-003 | UI components SHALL use responsive design patterns that adapt to screen size |
| XPL-004 | Touch and mouse/keyboard interactions SHALL be equally supported |
| XPL-005 | Font sizes, spacing, and touch targets SHALL adapt to platform conventions |
| XPL-006 | Navigation patterns SHALL follow platform conventions (tab bar on iOS, sidebar on macOS/web) |

## 6.3 Web-Specific Requirements

| ID | Requirement |
|---|---|
| WEB-001 | Progressive Web App (PWA) with service worker for offline support |
| WEB-002 | Support latest 2 versions of Safari, Chrome, Firefox, and Edge |
| WEB-003 | Responsive design: mobile (375px) to desktop (2560px) |
| WEB-004 | Keyboard shortcuts for power users (Cmd+K for search, etc.) |
| WEB-005 | URL-based navigation (deep linking to any recipe, product, or report) |
| WEB-006 | Print stylesheets for recipe cards and reports |
| WEB-007 | Clipboard integration (copy recipe details, paste ingredients) |
| WEB-008 | SEO for public-facing pages (marketing, help documentation) |

## 6.4 macOS-Specific Requirements

| ID | Requirement |
|---|---|
| MAC-001 | Native window management (resize, full-screen, split view) |
| MAC-002 | macOS menu bar integration |
| MAC-003 | Touch Bar support (where applicable) |
| MAC-004 | Spotlight integration (search for recipes from Spotlight) |
| MAC-005 | Handoff support (start on Mac, continue on iPad) |
| MAC-006 | Notification Center integration |
| MAC-007 | Keyboard shortcuts following macOS conventions (Cmd+, for preferences) |
| MAC-008 | Dark mode following system preference |
| MAC-009 | File drag-and-drop for document upload and recipe import |
| MAC-010 | AppleScript/Shortcuts support for automation |
| MAC-011 | Native file dialogs for save/open operations |
| MAC-012 | macOS Sequoia and later (minimum supported version) |

## 6.5 iPadOS-Specific Requirements

| ID | Requirement |
|---|---|
| IPA-001 | Optimized for landscape orientation (primary kitchen use) |
| IPA-002 | Split View and Slide Over multitasking support |
| IPA-003 | Apple Pencil support for annotating recipe photos |
| IPA-004 | External keyboard and trackpad support |
| IPA-005 | Face ID / Touch ID for authentication |
| IPA-006 | Handoff integration (continue on Mac or iPhone) |
| IPA-007 | Drag and drop between CulinaryCore and other apps |
| IPA-008 | Camera integration for recipe photo capture and barcode scanning |
| IPA-009 | Large-format UI optimized for 11" and 12.9" iPad screens |
| IPA-010 | Stage Manager support |
| IPA-011 | Offline mode with local storage (SQLite via Capacitor) |
| IPA-012 | iPadOS 17 and later (minimum supported version) |

## 6.6 iOS (iPhone)-Specific Requirements

| ID | Requirement |
|---|---|
| IOS-001 | Compact UI optimized for iPhone screen sizes (SE through Pro Max) |
| IOS-002 | Face ID / Touch ID for authentication |
| IOS-003 | Siri Shortcuts integration ("Hey Siri, what's the food cost on the lobster?") |
| IOS-004 | Spotlight integration (search recipes from iPhone Spotlight) |
| IOS-005 | Widgets for Home Screen (daily food cost, pending tasks, stock alerts) |
| IOS-006 | Push notifications via APNs (Apple Push Notification Service) |
| IOS-007 | Camera integration for recipe import and barcode scanning |
| IOS-008 | Haptic feedback for touch interactions |
| IOS-009 | Dynamic Island / Live Activities for active production timers |
| IOS-010 | Apple Watch companion app: quick recipe lookup, timer, notifications |
| IOS-011 | NFC tag reading for equipment/location identification |
| IOS-012 | iOS 17 and later (minimum supported version) |

## 6.7 Apple Ecosystem Integration

| ID | Requirement |
|---|---|
| APL-001 | Universal Purchase: single purchase works across iPhone, iPad, and Mac |
| APL-002 | iCloud Keychain integration for credential storage |
| APL-003 | Handoff: seamlessly continue work between devices |
| APL-004 | AirDrop: share recipes, reports, and documents between Apple devices |
| APL-005 | Continuity Camera: use iPhone camera from Mac/iPad for photo capture |
| APL-006 | SharePlay: collaborative recipe viewing during video calls |
| APL-007 | App Clips: lightweight recipe viewer accessible via QR code without full app install |
| APL-008 | Sign in with Apple: required for App Store compliance |
| APL-009 | On-device AI using Apple Foundation Models (Core ML) for privacy-sensitive operations |
| APL-010 | Shortcuts app integration for custom automation workflows |

---

# 7. Integration Requirements

## 7.1 POS System Integration

| ID | Requirement | Priority |
|---|---|---|
| INT-POS-001 | Import sales mix data (item quantities sold) for menu engineering analysis | Should Have |
| INT-POS-002 | Push menu items and prices to POS system | Could Have |
| INT-POS-003 | Real-time sales data for theoretical food cost calculation | Could Have |
| INT-POS-004 | Support for major POS systems: Lightspeed, Toast, Square, Oracle MICROS, Revel | Should Have |
| INT-POS-005 | Generic API for custom POS integration | Should Have |

## 7.2 Accounting System Integration

| ID | Requirement | Priority |
|---|---|---|
| INT-ACC-001 | Export purchase data to accounting system (Xero, QuickBooks, SAP) | Should Have |
| INT-ACC-002 | Export inventory valuation for financial reporting | Could Have |
| INT-ACC-003 | Export food cost reports in accounting-compatible format | Should Have |
| INT-ACC-004 | Chart of accounts mapping for expense categorization | Could Have |

## 7.3 Supplier System Integration

| ID | Requirement | Priority |
|---|---|---|
| INT-SUP-001 | EDI (Electronic Data Interchange) for purchase orders | Could Have |
| INT-SUP-002 | Email-based PO delivery with standardized format | Should Have |
| INT-SUP-003 | Supplier portal for order confirmation and invoice submission | Could Have |
| INT-SUP-004 | Automated price list import from supplier systems | Could Have |

## 7.4 Nutrition Database Integration

| ID | Requirement | Priority |
|---|---|---|
| INT-NUT-001 | USDA FoodData Central API for nutrition data lookup | Should Have |
| INT-NUT-002 | Local nutrition databases (UAE, EU) for region-specific data | Could Have |
| INT-NUT-003 | Branded food nutrition databases (Open Food Facts) | Could Have |

## 7.5 Communication Integration

| ID | Requirement | Priority |
|---|---|---|
| INT-COM-001 | Email integration for PO delivery, notifications, and report distribution | Must Have |
| INT-COM-002 | Slack/Microsoft Teams webhooks for notifications | Could Have |
| INT-COM-003 | WhatsApp Business API for supplier communication | Could Have |

## 7.6 Platform API

| ID | Requirement | Priority |
|---|---|---|
| INT-API-001 | RESTful API for all platform operations | Must Have |
| INT-API-002 | GraphQL API for flexible data querying | Could Have |
| INT-API-003 | Webhook system for event-driven integrations | Should Have |
| INT-API-004 | API documentation (OpenAPI/Swagger) | Must Have |
| INT-API-005 | API rate limiting and usage monitoring | Must Have |
| INT-API-006 | API versioning for backward compatibility | Must Have |
| INT-API-007 | SDK for common languages (JavaScript/TypeScript, Python) | Could Have |

## 7.7 Third-Party Service Integration

| ID | Requirement | Priority |
|---|---|---|
| INT-3RD-001 | Stripe for subscription billing and payment processing | Must Have |
| INT-3RD-002 | SendGrid/Postmark for transactional email | Must Have |
| INT-3RD-003 | Sentry for error tracking | Must Have |
| INT-3RD-004 | Analytics platform (Mixpanel, Amplitude, or PostHog) | Should Have |
| INT-3RD-005 | Cloud storage CDN for global asset delivery | Must Have |

---

# 8. Data Migration Strategy

## 8.1 Overview

Data migration is a critical path item. The existing system's data -- 657 products, 245 sub recipes, and 85 recipes -- must be migrated with perfect accuracy. Any discrepancy in costs, quantities, or formulas between the Excel workbooks and CulinaryCore will undermine user trust and delay adoption.

## 8.2 Migration Sources

### 8.2.1 Sub Rec.xlsm (Primary Source)

| Sheet/Range | Target | Records | Complexity |
|---|---|---|---|
| Product List (Table7) | Products table | 657 products | Medium (31 columns, unit conversions) |
| Product List nutrition columns | Product Nutrition table | 657 records | Low (8 nutrient fields + K.Cal calculation) |
| Index sheet | Sub Recipe metadata | 245 records | Low |
| Individual sub recipe sheets | Sub Recipes + Sub Recipe Ingredients | 245 sub recipes, ~4000 ingredient lines | High (template parsing, formula extraction) |
| SCALE sheet | Configuration | 1 record | Low |
| Back End sheet | Status configuration | 1 record | Low |

### 8.2.2 Recipes.xlsm (Secondary Source)

| Sheet/Range | Target | Records | Complexity |
|---|---|---|---|
| Set Up sheet | Categories + Statuses | 12 categories, 4 statuses | Low |
| Index sheet | Recipe metadata | 85 records | Low |
| Individual recipe sheets | Recipes + Recipe Ingredients | 85 recipes, ~1500 ingredient lines | High (template parsing) |
| Calories sheet | N/A (functionality replaced by Nutrition Engine) | N/A | N/A |

## 8.3 Migration Process

### Phase 1: Product Data Migration

**Input**: Product List (Table7) from Sub Rec.xlsm
**Process**:
1. Export Table7 to CSV
2. Map 31 columns to CulinaryCore product fields
3. Validate all numeric fields (costs, quantities, waste factors)
4. Import nutrition data (8 nutrients per product)
5. Verify K.Cal calculation matches: (Fat*9 + Carbs*4 + Protein*4) [WB-REF]
6. Set all products to status matching their workbook status value

**Validation**:
- Record count: 657 products imported
- Cost spot check: 50 random products, cost/unit matches to 4 decimal places
- Nutrition spot check: 50 random products, all 9 values match
- Ref% verification: 100% of products have correct Ref% = (Waste/Gross)*100

### Phase 2: Sub Recipe Migration

**Input**: 245 sub recipe sheets from Sub Rec.xlsm
**Process**:
1. Parse each sub recipe sheet (42 rows x 26 columns template)
2. Extract recipe name from sheet header
3. Extract ingredient lines (up to 26 per sub recipe)
4. For each ingredient line: extract product name, nett qty, and verify that unit, ref%, gross qty, cost/u, and cost match the Product List lookup
5. Extract batch yield quantity and unit
6. Calculate and verify total cost, cost per unit
7. Link ingredients to imported products by name matching

**Validation**:
- Record count: 245 sub recipes imported
- Ingredient count: all ingredient lines imported (no missed rows)
- Total cost verification: recalculated total cost matches workbook for each sub recipe (tolerance: 0.01 AED)
- Cost per unit verification: matches workbook value
- Where-used verification: sub recipe cross-references are intact

### Phase 3: Recipe Migration

**Input**: 85 recipe sheets from Recipes.xlsm
**Process**:
1. Parse each recipe sheet (39 rows x 27 columns template)
2. Extract recipe name and category
3. Extract ingredient lines (up to 26 per recipe)
4. For each ingredient: link to product or sub recipe
5. Extract yield, selling price (W/VAT and B/VAT)
6. Verify cost calculations: total cost, margin, food cost %, contribution margin
7. Import nutrition data from the nutrition panel

**Validation**:
- Record count: 85 recipes imported
- Category assignment: all recipes correctly categorized per Index sheet
- Cost verification: total cost matches workbook for each recipe (tolerance: 0.01 AED)
- Food cost % verification: matches workbook value (tolerance: 0.1%)
- Contribution margin verification: matches workbook value (tolerance: 0.01 AED)
- Nutrition verification: per-portion nutrition matches workbook values

### Phase 4: Relationship Verification

**Process**:
1. Verify all product -> sub recipe -> recipe relationships are intact
2. Trigger a full cost recalculation and compare to workbook values
3. Change one product price and verify the cascade matches expected behavior
4. Generate the Index view and compare to workbook Index sheets

### Phase 5: Parallel Run

**Process**:
1. Run both systems (Excel and CulinaryCore) in parallel for 2 weeks
2. Any recipe changes made in Excel are also made in CulinaryCore
3. Compare outputs daily
4. Resolve any discrepancies
5. Sign-off from Executive Chef and Finance Manager before Excel retirement

## 8.4 Migration Tooling

| Tool | Purpose |
|---|---|
| Excel Parser (SheetJS/xlsx) | Read .xlsm files programmatically |
| Template Recognizer | Identify recipe template structure and extract data from fixed positions |
| Product Matcher | Fuzzy matching to link ingredient names to products |
| Validation Engine | Compare calculated values against workbook values |
| Migration Dashboard | Track progress, errors, and validation results |
| Rollback Mechanism | Ability to delete all migrated data and start over |

## 8.5 Migration Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| Formula cells with errors (#REF!, #N/A) | Data loss | Medium | Pre-scan workbooks for formula errors; import calculated values where formula is intact, flag errors for manual review |
| Product name mismatches between workbooks | Broken links | High | Build a name normalization mapping; manual review for ambiguous matches |
| Hidden/filtered rows not imported | Missing data | Medium | Ensure import tool reads all rows regardless of filter/hidden state |
| Circular references in sub recipes | Import failure | Low | Detect and flag circular references; import in dependency order |
| Merged cells in templates | Parsing errors | Medium | Map merged cell regions in template recognition |
| Cost rounding differences | Validation failures | High | Define acceptable tolerance (0.01 AED) and document differences |

---

# 9. Future Expansion Roadmap

## 9.1 Phase 1: Foundation (Months 1-6)

**Focus**: Core recipe and cost management that replaces the workbooks.

| Feature | Module | Priority |
|---|---|---|
| Product database (CRUD, search, import) | Product Mgmt | Must Have |
| Sub recipe management | Sub Recipe Mgmt | Must Have |
| Recipe management | Recipe Mgmt | Must Have |
| Cost engine (real-time calculation, cascading) | Cost Engine | Must Have |
| Nutrition engine (basic calculation, display) | Nutrition Engine | Must Have |
| Basic allergen management | Allergen Mgmt | Must Have |
| User authentication (email, Apple Sign In) | User Mgmt | Must Have |
| Role-based access control (default roles) | User Mgmt | Must Have |
| Excel workbook import (migration) | AI Import | Must Have |
| Web application | Cross-Platform | Must Have |
| iPadOS application | Cross-Platform | Must Have |
| Offline read access | Offline | Must Have |
| Version history for recipes | Version Control | Must Have |
| Basic reporting (food cost, recipe index) | Reporting | Must Have |

**Success Criteria**: Complete migration from Excel with verified data accuracy. Chef Khalid no longer opens Excel for recipe management.

## 9.2 Phase 2: Operations (Months 7-12)

**Focus**: Extend beyond recipe costing into operational management.

| Feature | Module | Priority |
|---|---|---|
| Supplier management | Supplier Mgmt | Should Have |
| Purchase order creation and tracking | Purchasing | Should Have |
| Basic inventory management | Inventory | Should Have |
| Stock count functionality | Inventory | Should Have |
| Menu construction | Menu Mgmt | Should Have |
| Production planning (prep lists) | Production | Should Have |
| AI recipe import (photo, PDF, URL) | AI Import | Should Have |
| Advanced nutrition (labeling, claims) | Nutrition | Should Have |
| iOS (iPhone) application | Cross-Platform | P1 |
| macOS application | Cross-Platform | P1 |
| Offline write access | Offline | Should Have |
| Notification system | Notifications | Should Have |
| Advanced reporting (dashboards, trends) | Reporting | Should Have |
| Multi-location support | User Mgmt | Should Have |

**Success Criteria**: Purchasing manager uses CulinaryCore for all purchase orders. Prep lists are generated from the system.

## 9.3 Phase 3: Intelligence (Months 13-18)

**Focus**: AI-powered features and advanced analytics.

| Feature | Module | Priority |
|---|---|---|
| AI assistant (conversational) | AI Assistant | Should Have |
| Menu engineering (BCG matrix) | Menu Mgmt | Should Have |
| Theoretical vs. actual food cost | Inventory | Should Have |
| Cost trend analysis and alerts | Reporting | Should Have |
| Supplier performance scoring | Supplier Mgmt | Could Have |
| Invoice reconciliation | Purchasing | Could Have |
| Production scheduling | Production | Could Have |
| Voice interface | AI Assistant | Could Have |
| Document management | Document Mgmt | Could Have |
| Custom report builder | Reporting | Could Have |
| Multi-currency support | Cost Engine | Could Have |
| Apple Watch companion | Cross-Platform | Could Have |

**Success Criteria**: AI assistant handles 50% of common queries. Menu engineering drives quarterly menu revisions.

## 9.4 Phase 4: Scale & Ecosystem (Months 19-24)

**Focus**: Enterprise features and marketplace expansion.

| Feature | Module | Priority |
|---|---|---|
| POS integration (Lightspeed, Toast) | Integration | Could Have |
| Accounting integration (Xero, QuickBooks) | Integration | Could Have |
| Supplier portal | Supplier Mgmt | Could Have |
| API marketplace / developer platform | Integration | Could Have |
| Advanced AI (predictive analytics, auto-optimization) | AI Assistant | Could Have |
| White-label / franchise support | User Mgmt | Could Have |
| Advanced compliance (HACCP, ISO 22000) | Compliance | Could Have |
| Sustainability / carbon tracking | Product Mgmt | Could Have |
| Dynamic pricing | Menu Mgmt | Could Have |
| Multi-language support (Arabic, French, Hindi) | I18N | Could Have |

**Success Criteria**: Three integrations with major POS/accounting systems live. API available for third-party developers.

## 9.5 Phase 5: Market Leadership (Months 25-36)

**Focus**: Features that establish CulinaryCore as the undisputed market leader.

| Feature | Target |
|---|---|
| AI-powered menu optimization | Predict optimal menu composition for revenue maximization |
| Computer vision for inventory | Camera-based stock level estimation |
| IoT integration | Smart scales, temperature sensors, automated inventory |
| Central kitchen management | Multi-outlet production planning and distribution |
| Catering management | Event-based production planning with guest counts |
| Food safety compliance suite | HACCP automation, temperature logging, audit trails |
| Nutritionist platform | Client-facing nutrition analysis and meal planning |
| Recipe marketplace | Buy/sell/share recipes between organizations |
| Franchise management | Multi-brand, multi-region recipe and cost standardization |
| Global expansion | Multi-region deployment, compliance across jurisdictions |

## 9.6 Competitive Feature Matrix

The following matrix compares CulinaryCore's planned capabilities against key competitors. The goal is to match or exceed every competitor in their strongest area while providing capabilities no competitor offers.

| Feature | CulinaryCore | Apicbase | Meez | MarketMan | Galley | ChefTec |
|---|---|---|---|---|---|---|
| Recipe costing | Phase 1 | Yes | Yes | Basic | Yes | Yes |
| Sub recipe nesting | Phase 1 (unlimited) | Yes (limited) | Yes | No | Yes | Yes |
| Waste-adjusted costing | Phase 1 | Yes | No | No | No | Yes |
| Security margin | Phase 1 | No | No | No | No | No |
| Nutrition calculation | Phase 1 | Yes | Yes | No | Yes | Yes |
| Allergen management | Phase 1 | Yes | Yes | No | Yes | No |
| AI recipe import | Phase 2 | No | Yes (basic) | No | No | No |
| AI assistant | Phase 3 | No | No | No | No | No |
| Menu engineering (BCG) | Phase 3 | Yes | No | No | Yes | No |
| Inventory management | Phase 2 | Yes | No | Yes | Yes | Yes |
| Purchasing automation | Phase 2 | Yes | No | Yes | Yes | Yes |
| Offline-first | Phase 1 | No | No | No | No | Yes (desktop) |
| Apple ecosystem | Phase 1 | No | No | No | No | No |
| Multi-currency | Phase 3 | Yes | No | Yes | Yes | No |
| Voice interface | Phase 3 | No | No | No | No | No |
| Predictive analytics | Phase 4 | No | No | No | No | No |
| IoT integration | Phase 5 | No | No | No | No | No |

---

# 10. Appendices

## 10.1 Appendix A: Workbook Formula Reference

This appendix documents every formula traced from the workbooks, serving as the authoritative reference for the Cost Engine and Nutrition Engine implementations.

### A.1 Product List Formulas (Sub Rec.xlsm -- Table7)

```
Total Weight = PPC * UPP
   Example: 6 pieces/case * 500g/piece = 3000g

Cost per Gross Unit = Buying Cost per Unit / Total Weight
   Example: 150 AED / 3000g = 0.05 AED/g

Waste Amount = Gross Weight - (Gross Weight * Yield%)
   Example: 1000g - (1000g * 0.80) = 200g

Ref% = (Waste Amount / Gross Weight) * 100
   Example: (200g / 1000g) * 100 = 20%

Yield% = 100 - Ref%
   Example: 100 - 20 = 80%

Cost per Nett Unit = Cost per Gross Unit / (Yield% / 100)
   Example: 0.05 / 0.80 = 0.0625 AED/g

K.Cal per 100g = (Fat * 9) + (Carbs * 4) + (Protein * 4)
   Example: (10g * 9) + (5g * 4) + (20g * 4) = 90 + 20 + 80 = 190 kcal
```

### A.2 Recipe / Sub Recipe Ingredient Line Formulas

```
Unit = VLOOKUP(Product Name, Product List, Unit Column)
   Automatically looked up from the Product List when product is selected.

Ref% = VLOOKUP(Product Name, Product List, Ref% Column)
   Automatically looked up from the Product List.

Gross Qty = (100 * Nett Qty) / (100 - Ref%)
   Example: (100 * 800g) / (100 - 20) = 80000 / 80 = 1000g

Cost/U = VLOOKUP(Product Name, Product List, Cost/U Column)
   For products: Cost per Nett Unit from Product List.
   For sub recipes: Cost Per Unit from the sub recipe.

Cost = Gross Qty * Cost/U
   Example: 1000g * 0.0625 AED/g = 62.50 AED
```

### A.3 Recipe Cost Summary Formulas (Recipes.xlsm -- Template Rows 30-39)

```
Row 30: TOTAL COST = SUMIF(Cost column, non-empty ingredient lines)
   Sum of all ingredient line costs.

Row 31: YIELD = User-entered number of portions

Row 34: PRICE W/VAT = User-entered selling price including VAT

Row 35: PRICE B/VAT = PRICE W/VAT / (1 + VAT Rate)
   Example: 95 AED / 1.05 = 90.48 AED (for 5% VAT)

Row 36: TOTAL COST = Same as Row 30 (repeated for reference)

Row 37: TOTAL COST + 5% = TOTAL COST * 1.05
   Example: 28.50 AED * 1.05 = 29.925 AED

Row 38: GROSS CONTRIBUTION MARGIN = PRICE B/VAT - TOTAL COST + 5%
   Example: 90.48 - 29.925 = 60.555 AED

Row 39: FOOD COST % = (TOTAL COST + 5%) / PRICE B/VAT * 100
   Example: (29.925 / 90.48) * 100 = 33.07%
```

### A.4 Sub Recipe Cost Summary Formulas (Sub Rec.xlsm -- Template)

```
Total Cost = SUM(all ingredient line costs)

Total Cost + 5% = Total Cost * 1.05

Total Weight per Batch = User-entered batch yield quantity

Cost Per Unit = Total Cost / Total Weight per Batch
   Example: 45.00 AED / 2000g = 0.0225 AED/g

Cost Per Unit with Margin = (Total Cost * 1.05) / Total Weight per Batch
   Example: (45.00 * 1.05) / 2000 = 0.023625 AED/g
```

### A.5 Nutrition Formulas

```
Per ingredient line:
   Nutrient contribution = (Nett Qty / 100) * Nutrient per 100g
   Example: (200g / 100) * 15g fat/100g = 30g fat

Per recipe/sub recipe:
   Total nutrient = SUM(all ingredient contributions)
   Per portion = Total / Yield

Energy per portion:
   Fat contribution = Fat (g) * 9 kcal/g
   Carbs contribution = Carbs (g) * 4 kcal/g
   Protein contribution = Protein (g) * 4 kcal/g
   Total kcal = Fat contribution + Carbs contribution + Protein contribution

% RDA per portion:
   Vitamin A: (amount / 600 mcg) * 100
   Vitamin C: (amount / 45 mg) * 100
   Calcium: (amount / 1000 mg) * 100
   Iron: (amount / 18 mg) * 100
   Sodium: (amount / 2300 mg) * 100 (Upper Limit, not RDA)
```

## 10.2 Appendix B: Default Category Seed Data

### B.1 Recipe Categories (from Set Up sheet)

| Sort Order | Code | Name | Description |
|---|---|---|---|
| 1 | BITES | 01.BITES | Small plates, appetizers, amuse-bouche |
| 2 | SALADS | 02.SALADS | Salads and cold starters |
| 3 | COLD | 03.COLD | Cold preparations, ceviches, tartares |
| 4 | HOT | 04.HOT | Hot appetizers and starters |
| 5 | MAINS | 05.MAINS | Main courses |
| 6 | GRILL | 06.GRILL | Grilled items and BBQ |
| 7 | SIDES | 07.SIDES | Side dishes and accompaniments |
| 8 | BREAD | 08.BREAD | Bread and baked goods |
| 9 | PIZZA | 09.PIZZA | Pizzas and flatbreads |
| 10 | DESSERT | 10.DESSERT | Desserts and pastries |
| 11 | KIDS | 11.KIDS MENU | Children's menu items |
| 12 | HAPPY_HOUR | 12.HAPPY HOUR | Happy hour specials and bar snacks |

### B.2 Recipe/Product Status Values (from Set Up sheet)

| Status | Meaning | Color |
|---|---|---|
| Actual | Active and in use | Green |
| Pending | Awaiting review/approval | Amber |
| Update | Existing item with pending revision | Blue |
| NEW | Newly created, not yet fully reviewed | Purple |

## 10.3 Appendix C: Sample Recipe Data Structure

### C.1 Example: TENDERLOIN PEPPER (from Recipes.xlsm)

```
Recipe: TENDERLOIN PEPPER
Category: 06.GRILL
Status: Actual
Yield: 1 portion

Ingredient Lines:
| # | Product | Nett Qty | Unit | Ref% | Gross Qty | Cost/U | Cost |
|---|---------|----------|------|------|-----------|--------|------|
| 1 | Beef Tenderloin | 200 | g | 20 | 250 | 0.085 | 21.25 |
| 2 | Black Pepper (crushed) | 3 | g | 0 | 3 | 0.025 | 0.075 |
| 3 | Sea Salt | 2 | g | 0 | 2 | 0.008 | 0.016 |
| 4 | Olive Oil | 15 | ml | 0 | 15 | 0.018 | 0.270 |
| 5 | Pepper Sauce [SUB] | 60 | g | 0 | 60 | 0.032 | 1.920 |
| 6 | Truffle Mash [SUB] | 150 | g | 0 | 150 | 0.028 | 4.200 |
| ... | ... | ... | ... | ... | ... | ... | ... |

Cost Summary:
   Total Cost: 28.50 AED
   Yield: 1 portion
   Cost per Portion: 28.50 AED
   Total Cost + 5%: 29.925 AED
   Price W/VAT: 95.00 AED
   Price B/VAT: 90.48 AED
   Contribution Margin: 60.555 AED
   Food Cost %: 33.07%

Nutrition per Portion:
   Fat: 42g (378 kcal)
   Carbs: 18g (72 kcal)
   Protein: 55g (220 kcal)
   Total: 670 kcal
   Vitamin A: 120 mcg (20% RDA)
   Vitamin C: 8 mg (17.8% RDA)
   Calcium: 45 mg (4.5% RDA)
   Iron: 6.2 mg (34.4% RDA)
   Sodium: 680 mg (29.6% UL)
```

### C.2 Example: CHIMICHURRI BASE (from Sub Rec.xlsm)

```
Sub Recipe: CHIMICHURRI BASE
Status: Actual
Batch Yield: 2000 g

Ingredient Lines:
| # | Product | Nett Qty | Unit | Ref% | Gross Qty | Cost/U | Cost |
|---|---------|----------|------|------|-----------|--------|------|
| 1 | Fresh Parsley | 300 | g | 15 | 352.94 | 0.012 | 4.235 |
| 2 | Fresh Oregano | 100 | g | 10 | 111.11 | 0.018 | 2.000 |
| 3 | Garlic Cloves | 80 | g | 12 | 90.91 | 0.015 | 1.364 |
| 4 | Red Wine Vinegar | 200 | ml | 0 | 200 | 0.008 | 1.600 |
| 5 | Olive Oil | 800 | ml | 0 | 800 | 0.018 | 14.400 |
| 6 | Red Chili Flakes | 20 | g | 0 | 20 | 0.035 | 0.700 |
| 7 | Salt | 30 | g | 0 | 30 | 0.003 | 0.090 |
| 8 | Black Pepper | 10 | g | 0 | 10 | 0.025 | 0.250 |
| ... | ... | ... | ... | ... | ... | ... | ... |

Cost Summary:
   Total Cost: 24.639 AED
   Total Cost + 5%: 25.871 AED
   Batch Yield: 2000 g
   Cost Per Unit: 0.01232 AED/g
   Cost Per Unit + Margin: 0.01294 AED/g
```

## 10.4 Appendix D: Regulatory Reference

### D.1 UAE Food Safety Regulations

| Regulation | Relevance |
|---|---|
| Federal Law No. 10 of 2015 on Food Safety | Overarching food safety law; requires food businesses to ensure safety and consumer information |
| GSO 9/2007 (GCC Standard for Labeling of Pre-packaged Foods) | Defines nutrition labeling requirements for the GCC region |
| ESMA (Emirates Authority for Standardization and Metrology) | UAE-specific implementation of GCC standards |
| Federal Decree-Law No. 45 of 2021 (Data Protection) | Data privacy requirements for software handling personal data |
| UAE VAT rate: 5% (effective 1 January 2018) | Tax calculation for selling prices |

### D.2 EU Regulations (for organizations with EU operations)

| Regulation | Relevance |
|---|---|
| Regulation (EU) No 1169/2011 | Food information to consumers: nutrition labeling, allergen declaration |
| 14 mandatory allergens | Allergen management module |
| Regulation (EC) No 852/2004 | Hygiene of foodstuffs (HACCP requirements) |
| GDPR (Regulation (EU) 2016/679) | Data protection for EU-based organizations |

### D.3 US Regulations (for organizations with US operations)

| Regulation | Relevance |
|---|---|
| FDA 21 CFR 101 | Nutrition labeling (Nutrition Facts panel) |
| FSMA (Food Safety Modernization Act) | Food safety and traceability |
| FASTER Act (2023) | 9 major allergens including sesame |
| CCPA (California Consumer Privacy Act) | Data privacy for US-based organizations |

## 10.5 Appendix E: Glossary of Abbreviations

| Abbreviation | Full Form |
|---|---|
| AED | United Arab Emirates Dirham |
| AI | Artificial Intelligence |
| APNs | Apple Push Notification Service |
| API | Application Programming Interface |
| BCG | Boston Consulting Group (matrix methodology) |
| CCPA | California Consumer Privacy Act |
| CDN | Content Delivery Network |
| CLI | Command Line Interface |
| CORS | Cross-Origin Resource Sharing |
| CRUD | Create, Read, Update, Delete |
| CSP | Content Security Policy |
| CSS | Cascading Style Sheets |
| EDI | Electronic Data Interchange |
| ESMA | Emirates Authority for Standardization and Metrology |
| EU | European Union |
| FDA | Food and Drug Administration (US) |
| FK | Foreign Key |
| FIFO | First In, First Out |
| FSMA | Food Safety Modernization Act |
| GDPR | General Data Protection Regulation |
| GCC | Gulf Cooperation Council |
| GSO | GCC Standardization Organization |
| HACCP | Hazard Analysis and Critical Control Points |
| HTML | Hypertext Markup Language |
| IoT | Internet of Things |
| ISO | International Organization for Standardization |
| JWT | JSON Web Token |
| KDS | Kitchen Display System |
| ML | Machine Learning |
| MFA | Multi-Factor Authentication |
| NFC | Near Field Communication |
| OCR | Optical Character Recognition |
| PII | Personally Identifiable Information |
| PO | Purchase Order |
| POS | Point of Sale |
| PPC | Pieces Per Case |
| PWA | Progressive Web App |
| RBAC | Role-Based Access Control |
| RDA | Reference Daily Amount |
| REST | Representational State Transfer |
| RFQ | Request for Quotation |
| RLS | Row Level Security |
| RPO | Recovery Point Objective |
| RTO | Recovery Time Objective |
| RTL | Right to Left |
| SaaS | Software as a Service |
| SKU | Stock Keeping Unit |
| SLA | Service Level Agreement |
| SOC | System and Organization Controls |
| SQL | Structured Query Language |
| SRS | Software Requirements Specification |
| SSO | Single Sign-On |
| TLS | Transport Layer Security |
| TOTP | Time-Based One-Time Password |
| UAE | United Arab Emirates |
| UL | Upper Limit (nutrition) |
| UPP | Units Per Pack |
| URL | Uniform Resource Locator |
| UUID | Universally Unique Identifier |
| VAT | Value Added Tax |
| WCAG | Web Content Accessibility Guidelines |
| XSS | Cross-Site Scripting |

## 10.6 Appendix F: Requirement Traceability Matrix

This matrix traces key requirements back to their source (workbook analysis, competitive analysis, or new capability).

| Req ID | Description | Source | WB Sheet | Priority |
|---|---|---|---|---|
| RCP-FUNC-001 | Recipe creation | WB + Competitive | Recipe template | Must Have |
| RCP-FUNC-003 | Ingredient line management | WB | Template rows 4-29 | Must Have |
| RCP-FUNC-004 | Cost summary panel | WB | Template rows 30-39 | Must Have |
| RCP-FUNC-005 | Recipe categories | WB | Set Up sheet | Must Have |
| RCP-FUNC-006 | Recipe status workflow | WB | Set Up sheet | Must Have |
| RCP-FUNC-007 | Recipe scaling | WB + SCALE sheet | SCALE | Must Have |
| SRF-FUNC-001 | Sub recipe creation | WB | SubRec template | Must Have |
| SRF-FUNC-002 | Sub recipe as ingredient | WB | Cross-sheet references | Must Have |
| SRF-FUNC-003 | Batch costing | WB | SubRec cost summary | Must Have |
| PRD-FUNC-001 | Product database | WB | Product List (Table7) | Must Have |
| PRD-FUNC-003 | Waste factor management | WB | Ref%, Yield% columns | Must Have |
| PRD-FUNC-004 | Supplier price management | WB + Competitive | Supplier column | Must Have |
| CST-FUNC-001 | Real-time cost calculation | WB | All cost formulas | Must Have |
| CST-FUNC-002 | Cascading price propagation | New capability | N/A | Must Have |
| CST-FUNC-003 | Security margin | WB | 5% margin row | Must Have |
| NUT-FUNC-001 | Automatic nutrition calculation | WB | Nutrition columns | Must Have |
| NUT-FUNC-002 | Nutrition panel display | WB | Nutrition per portion panel | Must Have |
| NUT-FUNC-005 | Dynamic nutrition analysis | WB | Calories sheet | Should Have |
| ALG-FUNC-001 | Product allergen declaration | New capability | N/A | Must Have |
| ALG-FUNC-002 | Recipe allergen inheritance | New capability | N/A | Must Have |
| MNU-FUNC-002 | Menu engineering matrix | Competitive | N/A | Should Have |
| AIR-FUNC-005 | Spreadsheet import | Migration | Recipes.xlsm, Sub Rec.xlsm | Must Have |
| AIA-FUNC-001 | Conversational AI interface | Competitive | N/A | Should Have |

## 10.7 Appendix G: Decision Log

| # | Decision | Rationale | Date | Status |
|---|---|---|---|---|
| 1 | Use Supabase as backend | RLS, real-time, open source, reduced ops overhead | 2026-07-25 | Approved |
| 2 | React + TypeScript for frontend | Type safety, ecosystem, team familiarity | 2026-07-25 | Approved |
| 3 | Offline-first architecture | Kitchen connectivity is unreliable | 2026-07-25 | Approved |
| 4 | AI abstraction layer | Avoid provider lock-in, support on-device AI | 2026-07-25 | Approved |
| 5 | Single codebase, multi-platform | Maximize code reuse, reduce maintenance | 2026-07-25 | Approved |
| 6 | Capacitor for iOS/iPadOS | Better native API access than PWA, single codebase | 2026-07-25 | Approved |
| 7 | Tauri for macOS | Lightweight, Rust-based, better performance than Electron | 2026-07-25 | Approved |
| 8 | Default 5% security margin | Matches existing workbook practice | 2026-07-25 | Approved |
| 9 | AED as default currency | UAE-based primary customer | 2026-07-25 | Approved |
| 10 | EU 14 + US 9 allergen union | Maximum regulatory coverage | 2026-07-25 | Approved |
| 11 | Unlimited ingredient lines | Workbook limit of 26 is arbitrary; remove it | 2026-07-25 | Approved |
| 12 | DECIMAL for financial calculations | Floating point rounding errors are unacceptable for money | 2026-07-25 | Approved |
| 13 | Version control for all entities | Excel's lack of version control is a critical gap | 2026-07-25 | Approved |
| 14 | Parallel run during migration | Builds trust and catches discrepancies | 2026-07-25 | Approved |

---

*End of Document*

*CulinaryCore Master Software Requirements Specification v1.0.0*

*This document is confidential and proprietary. Distribution is restricted to authorized project team members and stakeholders.*
