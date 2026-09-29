import { bagServiceUrl } from "@barry-rocks/sdk/host";

/** Where the tools reach the service: this instance's registry, at call time. */
function baseUrl(): string {
  return bagServiceUrl("notes", "api");
}

/** The service takes the instance secret on every request, loopback included. */
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
      `notes service unreachable at ${baseUrl()} — is it running? \`barry service status notes.api\` ` +
        `(${err instanceof Error ? err.message : String(err)})`,
    );
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`notes service error ${response.status}: ${text}`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
