// MCP client connections (§28): GoHighLevel official server + Vapi's MCP server.
// Connection failures are caught and typed — never an unhandled rejection.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { IntegrationError } from "./errors";

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
    throw new IntegrationError(integration, `MCP connect failed: ${(err as Error).message}`, true);
  }
}

/** GoHighLevel official MCP server (§28). Private Integration Token, least-privilege scopes. */
export async function connectGhl(): Promise<McpConnection> {
  const token = process.env.GOHIGHLEVEL_API_KEY;
  if (!token) throw new IntegrationError("ghl", "GOHIGHLEVEL_API_KEY is not set", false);
  return connect("ghl", "https://services.leadconnectorhq.com/mcp/", {
    Authorization: `Bearer ${token}`,
    ...(process.env.GHL_LOCATION_ID ? { locationId: process.env.GHL_LOCATION_ID } : {}),
  });
}

/** Vapi MCP server for natural-language-to-outbound-call (§28). */
export async function connectVapi(): Promise<McpConnection> {
  const token = process.env.VAPI_API_KEY;
  if (!token) throw new IntegrationError("vapi", "VAPI_API_KEY is not set", false);
  return connect("vapi", "https://mcp.vapi.ai/mcp", {
    Authorization: `Bearer ${token}`,
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
    throw new IntegrationError(integration, `tool ${toolName} failed: ${(err as Error).message}`, true);
  }
}
