import { Link } from "react-router-dom";
import { Package, ChefHat, Layers, ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const stats = [
  {
    title: "Products",
    value: "20",
    description: "Ingredients in your catalog",
    icon: Package,
    href: "/products",
  },
  {
    title: "Recipes",
    value: "5",
    description: "Menu items with costing",
    icon: ChefHat,
    href: "/recipes",
  },
  {
    title: "Sub Recipes",
    value: "5",
    description: "Reusable preparations",
    icon: Layers,
    href: "/sub-recipes",
  },
];

export function DashboardPage() {
  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Overview of your recipe management system"
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((stat) => (
          <Card key={stat.title}>
            <CardHeader>
              <CardDescription className="flex items-center gap-2">
                <stat.icon className="size-4" />
                {stat.title}
              </CardDescription>
              <CardTitle className="text-3xl">{stat.value}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-3 text-xs text-muted-foreground">
                {stat.description}
              </p>
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={<Link to={stat.href} />}
              >
                View {stat.title}
                <ArrowRight className="ml-1 size-3" />
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
