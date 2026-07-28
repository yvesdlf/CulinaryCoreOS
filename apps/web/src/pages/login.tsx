import { useState } from "react";
import { toast } from "sonner";
import { UtensilsCrossed, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { useAuthStore } from "@/stores/auth-store";

type Mode = "signin" | "signup";

export function LoginPage() {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [orgName, setOrgName] = useState("");
  const [busy, setBusy] = useState(false);

  const signIn = useAuthStore((s) => s.signIn);
  const signUp = useAuthStore((s) => s.signUp);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) {
      toast.error("Email and password are required");
      return;
    }
    setBusy(true);
    try {
      if (mode === "signin") {
        await signIn(email.trim(), password);
      } else {
        await signUp(email.trim(), password, orgName.trim() || undefined);
        toast.success("Account created", {
          description: "A new kitchen has been set up for you.",
        });
      }
    } catch (err) {
      toast.error(mode === "signin" ? "Could not sign in" : "Could not sign up", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex items-center justify-center gap-2">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <UtensilsCrossed className="size-5" />
          </div>
          <div>
            <p className="font-semibold leading-tight">CulinaryCore</p>
            <p className="text-xs text-muted-foreground">Recipe Management</p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>
              {mode === "signin" ? "Sign in" : "Create an account"}
            </CardTitle>
            <CardDescription>
              {mode === "signin"
                ? "Your recipes and costs are scoped to your kitchen."
                : "We'll set up a new kitchen for you automatically."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="chef@yourvenue.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete={
                    mode === "signin" ? "current-password" : "new-password"
                  }
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              {mode === "signup" && (
                <div className="space-y-1.5">
                  <Label htmlFor="org">Kitchen name (optional)</Label>
                  <Input
                    id="org"
                    placeholder="e.g. Warung Nusantara"
                    value={orgName}
                    onChange={(e) => setOrgName(e.target.value)}
                  />
                </div>
              )}

              <Button type="submit" className="w-full" disabled={busy}>
                {busy && <Loader2 className="mr-1 size-4 animate-spin" />}
                {mode === "signin" ? "Sign in" : "Create account"}
              </Button>
            </form>

            <div className="mt-4 text-center text-sm text-muted-foreground">
              {mode === "signin" ? (
                <>
                  No account?{" "}
                  <button
                    type="button"
                    className="text-foreground underline underline-offset-4"
                    onClick={() => setMode("signup")}
                  >
                    Create one
                  </button>
                </>
              ) : (
                <>
                  Already have an account?{" "}
                  <button
                    type="button"
                    className="text-foreground underline underline-offset-4"
                    onClick={() => setMode("signin")}
                  >
                    Sign in
                  </button>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
