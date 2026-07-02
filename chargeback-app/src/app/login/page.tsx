import Link from "next/link";
import { env } from "@/lib/env";
import { signIn } from "@/lib/auth";

export const metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <div className="card w-full max-w-sm text-center">
        <h1 className="text-lg font-semibold text-slate-900">Databricks Chargeback</h1>
        <p className="mt-1 text-sm text-slate-500">
          Reference data &amp; monthly chargeback reporting
        </p>
        <div className="mt-6">
          {env.AUTH_DEV_BYPASS ? (
            <>
              <Link href="/" className="btn w-full justify-center">
                Continue as Dev User ({env.AUTH_DEV_ROLE})
              </Link>
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
              <button type="submit" className="btn w-full justify-center">
                Sign in with Microsoft Entra ID
              </button>
            </form>
          ) : (
            <p className="text-sm text-red-600">
              No identity provider configured. Set the ENTRA_* variables, or
              AUTH_DEV_BYPASS=true for local development.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
