import { env } from "@/lib/env";

/**
 * Microsoft Graph lookup for service-principal display names, used by the
 * unmapped-runners "Map user" dialog to prefill user_name for SPN runners.
 *
 * Auth mirrors the warehouse client (dal/client.ts): the ENTRA_* app
 * credentials when a secret is configured, otherwise the developer's own
 * `az login` identity. The app registration needs the Application.Read.All
 * (or Directory.Read.All) Graph application permission for the secret path;
 * a signed-in user can read service principals with default directory
 * permissions.
 */

const GRAPH_SCOPE = "https://graph.microsoft.com/.default";
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The credential caches tokens internally; keep one per process.
let getToken: (() => Promise<string>) | null = null;

async function graphToken(): Promise<string> {
  if (!getToken) {
    const { ClientSecretCredential, AzureCliCredential } = await import("@azure/identity");
    const credential =
      env.ENTRA_TENANT_ID && env.ENTRA_CLIENT_ID && env.ENTRA_CLIENT_SECRET
        ? new ClientSecretCredential(
            env.ENTRA_TENANT_ID,
            env.ENTRA_CLIENT_ID,
            env.ENTRA_CLIENT_SECRET,
          )
        : new AzureCliCredential(env.ENTRA_TENANT_ID ? { tenantId: env.ENTRA_TENANT_ID } : {});
    getToken = async () => (await credential.getToken(GRAPH_SCOPE)).token;
  }
  return getToken();
}

async function fetchDisplayName(url: string, token: string): Promise<string | null> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Graph responded ${res.status} for ${url}`);
  const body = (await res.json()) as { displayName?: string | null };
  return body.displayName ?? null;
}

/**
 * Resolve a runner GUID to its Entra ID display name, or null when the
 * directory has no such service principal (e.g. Databricks-native SPs).
 * Throws on config/permission/network failures — callers translate.
 */
export async function lookupServicePrincipalName(id: string): Promise<string | null> {
  // Non-GUID runner ids can't be Entra service principals; the regex gate
  // also keeps raw input out of the OData URL below.
  if (!GUID_RE.test(id)) return null;
  if (env.DAL_MOCK) return `Mock Service Principal ${id.slice(0, 8)}`;
  const token = await graphToken();
  // Databricks records Azure SPs by their application (client) ID — try that
  // first, then fall back to treating the GUID as the directory object id.
  return (
    (await fetchDisplayName(
      `https://graph.microsoft.com/v1.0/servicePrincipals(appId='${id}')?$select=displayName`,
      token,
    )) ??
    (await fetchDisplayName(
      `https://graph.microsoft.com/v1.0/servicePrincipals/${id}?$select=displayName`,
      token,
    ))
  );
}
