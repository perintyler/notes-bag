import { findBagResourceUrl } from "@barry-rocks/bags";

const DEFAULT_PORT = 3870;

/**
 * Where the tools reach the service.
 *
 * Read from the bag resource registry rather than a central port table, so the
 * port stays declared in this bag's manifest and core needs no entry for it.
 */
function baseUrl(): string {
  if (process.env.NOTES_SERVICE_URL) return process.env.NOTES_SERVICE_URL;
  return findBagResourceUrl("notes", "api") ?? `http://127.0.0.1:${DEFAULT_PORT}`;
}

/**
 * The tools run on the same Mac as the service, so they reach it on loopback
 * where it takes no auth. The secret is still sent when one is bound, so a
 * service started WITH a secret does not reject its own bag's tools.
 */
function authHeaders(): Record<string, string> {
  const secret = process.env.BARRY_SECRET;
  return secret ? { authorization: `Bearer ${secret}` } : {};
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${baseUrl()}${path}`;
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: { "content-type": "application/json", ...authHeaders(), ...init?.headers },
    });
  } catch (err) {
    // Name the service and the likely fix: "fetch failed" on its own has sent
    // people looking for a bug in the tool rather than a stopped service.
    throw new Error(
      `notes service unreachable at ${baseUrl()} — is the com.barry.bag.notes.api ` +
        `service running? (${err instanceof Error ? err.message : String(err)})`,
    );
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`notes service error ${response.status}: ${text}`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
