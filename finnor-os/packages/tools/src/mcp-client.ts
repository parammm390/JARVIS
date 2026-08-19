// MCP client connections (§28): GoHighLevel official server + Vapi's MCP server.
// Connection failures are caught and typed — never an unhandled rejection.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { IntegrationError } from "./errors";
import type { TenantCredentialContext } from "@finnor/security";

export interface McpConnection {
  client: Client;
  close(): Promise<void>;
}

async function connect(
  integration: string,
  url: string,
  headers: Record<string, string>,
): Promise<McpConnection> {
  try {
    const client = new Client({ name: "finnor-os", version: "0.1.0" });
    const transport = new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers },
    });
    await client.connect(transport);
    return { client, close: () => client.close() };
  } catch (err) {
    throw new IntegrationError(integration, "MCP connect failed", true);
  }
}

/** GoHighLevel official MCP server (§28). Private Integration Token, least-privilege scopes. */
export async function connectGhl(context: TenantCredentialContext<"ghl">): Promise<McpConnection> {
  return connect("ghl", "https://services.leadconnectorhq.com/mcp/", {
    Authorization: `Bearer ${context.credentials.apiKey}`,
    ...(context.credentials.locationId ? { locationId: context.credentials.locationId } : {}),
  });
}

/** Vapi MCP server for natural-language-to-outbound-call (§28). */
export async function connectVapi(context: TenantCredentialContext<"vapi">): Promise<McpConnection> {
  return connect("vapi", "https://mcp.vapi.ai/mcp", {
    Authorization: `Bearer ${context.credentials.apiKey}`,
  });
}

export async function callMcpTool(
  conn: McpConnection,
  integration: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  try {
    const result = await conn.client.callTool({ name: toolName, arguments: args });
    return { content: result.content ?? [], isError: result.isError ?? false };
  } catch (err) {
    throw new IntegrationError(integration, `tool ${toolName} failed`, true);
  }
}
