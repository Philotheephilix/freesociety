import { McpClient } from "../mcp.js";
import type { RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";

export type Service = "swiggy" | "jaw" | "bitrefill";

export type PermissionsMap = Record<Service, Record<string, boolean>>;

export class Registry {
  swiggy: McpClient | null = null;
  jaw: McpClient | null = null;
  bitrefillKey: string | null = null;

  // The account this session is bound to. Set the first time a connect_* tool
  // supplies a non-default accountId; all later token refreshes and gift-card
  // payments in the session use it, so a user never falls back to another
  // account's stored credentials. Defaults to "default" for single-user use.
  accountId = "default";

  permissions: PermissionsMap = {
    swiggy: {},
    jaw: {},
    bitrefill: {},
  };

  // Bind this session to an account. The first non-default id wins; supplying a
  // different non-default id afterwards is a client error (mixing identities in
  // one session) and throws rather than silently rebinding to someone else.
  bindAccount(accountId: string): void {
    if (accountId === this.accountId) return;
    if (this.accountId !== "default") {
      throw new Error(
        `This session is already bound to account "${this.accountId}"; ` +
          `cannot switch to "${accountId}". Start a new MCP session for a different account.`
      );
    }
    this.accountId = accountId;
  }

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
