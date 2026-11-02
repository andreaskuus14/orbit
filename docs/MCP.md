# MCP servers in ORBIT

An MCP server exposes tools that CORE can discover and call. ORBIT already supports local command/stdio servers and remote Streamable HTTP servers through Profile → Plugins. Adding a server does not install its application, create an account, grant access to a service, or prove that a task completed.

## Connect hosted GitHub without Docker

1. On GitHub, create a fine-grained personal access token restricted to the repositories you want ORBIT to read. Grant only the needed read permissions: Contents, Issues, Pull requests and, for workflow inspection, Actions. Organization policies or approval requirements can also restrict access.
2. On the PC running ORBIT, set `ORBIT_MCP_GITHUB_TOKEN` in `.env.local` to the token alone, without a `Bearer ` prefix. Keep this file local. Never paste the token into chat, plugin JSON, a task, a screenshot or a PR.
3. Restart ORBIT so its server loads the setting.
4. In Profile → Plugins → Suggested plugins, select **GitHub hosted (read-only)** → Fill the form → Add → Test connection. For CI inspection, also add **GitHub Actions hosted (read-only)** using the same setting.
5. A successful test reports the number of discovered tools. Check their modes, then ask CORE to inspect a specific repository/PR and include source links. A tool discovery test proves connection and discovery only; check the actual read result before relying on it.

The saved configuration contains the variable name, not the token:

```json
{
  "name": "github-read",
  "url": "https://api.githubcopilot.com/mcp/readonly",
  "bearerTokenEnv": "ORBIT_MCP_GITHUB_TOKEN",
  "local": false
}
```

The Actions preset uses `https://api.githubcopilot.com/mcp/x/actions/readonly`. These endpoints expose read tools only; the token's own permissions determine which repositories/data they can access. Keep the existing Docker GitHub suggestion if you prefer a local server process.

## Connect vidIQ

1. In vidIQ (app.vidiq.com → MCP settings), create an API key. Every vidIQ plan includes MCP; research calls use vidIQ credits (the free plan has 150 a month), so ORBIT's own free `find_outliers` and YouTube Analytics stay the default for routine numbers.
2. Set `ORBIT_MCP_VIDIQ_KEY` in `.env.local` to the key alone and restart ORBIT.
3. Profile → Plugins → Suggested plugins → **vidIQ (YouTube research)** → Add → Test connection. Tools that change videos are not read-only, so they wait for your Run click.

## Higgsfield

Higgsfield's MCP server (`https://mcp.higgsfield.ai/mcp`) signs in through a browser (OAuth) and has no API key, so it cannot be added here yet. Keep using it from the Claude app until ORBIT supports OAuth connectors.

## Other authenticated HTTP servers

Set `bearerTokenEnv` to an environment variable whose name starts with `ORBIT_MCP_` (for example `ORBIT_MCP_NOTION_TOKEN`) containing that server's bearer token. Any other name is refused, so a pasted plugin config can never send a server secret such as `SUPABASE_SECRET_KEY` to its URL. HTTP plugins accept HTTPS URLs, or HTTP on loopback for local services. Other variable names, credentials in URLs, and invalid token/header values are rejected. Servers requiring OAuth-only login or custom authentication headers need separate support; this change does not add OAuth, browser login or cookies.

Local command plugins continue to use their existing `env` settings. Mark a plugin **local app only** only if its tools stay on the PC and do not reach outside services. Do not mark GitHub, Notion or other online connectors local.

## Diagnose a connection

- **Set VARIABLE … restart ORBIT:** the configured server environment variable is missing or empty. No connection request was sent.
- **Invalid token:** use the raw bearer token, without `Bearer`, embedded whitespace or extra lines. Correct the local setting and restart.
- **Authentication rejected (401):** check the token, expiry and server URL. Replace the local token and restart before retrying. This is not a request to paste the token into ORBIT chat.
- **Access denied (403):** check repository permissions and organization/service restrictions.
- **Other connection error:** check the server URL, service availability and network, then Test connection again. If the service requires OAuth, a bearer token may not be sufficient.

Auth rejection bodies are not copied into errors. Known configured token values are redacted from other connection errors before they reach the panel, cache or Activity. The panel shows the configured variable name, not whether its value is correct; only a successful test establishes access at that time.

## Authority and limits

Existing tool policy remains in force: tools can be auto, ask or off; outside effects require the owner's exact-item Run click; private LIFE/journal text must not be sent to plugins; Stop-all closes active plugin clients. Keep unnecessary tools off. Installing many servers adds maintenance and credentials; start with a service you use and verify a real result.

This integration is code and configuration support, not Windows deployment or a live GitHub credential test. Regression tests use synthetic credentials and a local MCP server; they do not access the owner's GitHub data.

References: [official GitHub MCP server](https://github.com/github/github-mcp-server), [hosted endpoints](https://github.com/github/github-mcp-server/blob/main/docs/remote-server.md), [server configuration and read-only mode](https://github.com/github/github-mcp-server/blob/main/docs/server-configuration.md).
