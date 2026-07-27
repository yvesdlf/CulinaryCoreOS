import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export function NotFoundPage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <h1 className="text-4xl font-bold tracking-tight">404</h1>
      <p className="text-lg text-muted-foreground">
        The page you are looking for does not exist.
      </p>
      <Button variant="outline" nativeButton={false} render={<Link to="/" />}>
        <ArrowLeft className="mr-2 size-4" />
        Back to Dashboard
      </Button>
    </div>
  );
}
