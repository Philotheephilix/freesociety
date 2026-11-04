import { McpClient } from "../mcp.js";
import type { RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";

export type Service = "swiggy" | "jaw" | "bitrefill";

export type PermissionsMap = Record<Service, Record<string, boolean>>;

export class Registry {
  swiggy: McpClient | null = null;
  jaw: McpClient | null = null;
  bitrefillKey: string | null = null;
  permissions: PermissionsMap = {
    swiggy: {},
    jaw: {},
    bitrefill: {},
  };

  // Passthrough tool handles registered per service, so that a reconnect can
  // remove the previous batch before re-registering (no duplicate tools).
  registeredTools: Record<Service, RegisteredTool[]> = {
    swiggy: [],
    jaw: [],
    bitrefill: [],
  };

  isAllowed(service: Service, toolName: string): boolean {
    return this.permissions[service][toolName] ?? true;
  }

  setPermission(service: Service, toolName: string, allow: boolean): void {
    this.permissions[service][toolName] = allow;
  }
}
