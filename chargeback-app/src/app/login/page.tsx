import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { env } from "@/lib/env";
import { signIn } from "@/lib/auth";

export const metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted p-4">
      <Card className="w-full max-w-sm text-center">
        <CardHeader>
          <CardTitle>Databricks Chargeback</CardTitle>
          <CardDescription>Reference data &amp; monthly chargeback reporting</CardDescription>
        </CardHeader>
        <CardContent className="pt-2">
          {env.AUTH_DEV_BYPASS ? (
            <>
              <Button asChild className="w-full">
                <Link href="/">Continue as Dev User ({env.AUTH_DEV_ROLE})</Link>
              </Button>
              <p className="mt-3 text-xs text-amber-600">
                AUTH_DEV_BYPASS is on — local development only.
              </p>
            </>
          ) : env.ENTRA_CLIENT_ID ? (
            <form
              action={async () => {
                "use server";
                await signIn("microsoft-entra-id", { redirectTo: "/" });
              }}
            >
              <Button type="submit" className="w-full">
                Sign in with Microsoft Entra ID
              </Button>
            </form>
          ) : (
            <p className="text-sm text-destructive">
              No identity provider configured. Set the ENTRA_* variables, or
              AUTH_DEV_BYPASS=true for local development.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
