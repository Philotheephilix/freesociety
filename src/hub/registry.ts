import { McpClient } from "../mcp.js";

export type PermissionsMap = Record<"swiggy" | "jaw" | "bitrefill", Record<string, boolean>>;

export class Registry {
  swiggy: McpClient | null = null;
  jaw: McpClient | null = null;
  permissions: PermissionsMap = {
    swiggy: {},
    jaw: {},
    bitrefill: {},
  };

  isAllowed(service: "swiggy" | "jaw" | "bitrefill", toolName: string): boolean {
    return this.permissions[service][toolName] ?? true;
  }

  setPermission(service: "swiggy" | "jaw" | "bitrefill", toolName: string, allow: boolean): void {
    this.permissions[service][toolName] = allow;
  }
}
