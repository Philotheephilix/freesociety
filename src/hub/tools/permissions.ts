import { Registry } from "../registry.js";

export function handleConfigurePermissions(
  registry: Registry,
  service: string,
  permissions: Record<string, boolean>
): string {
  // Validate service
  if (service !== "swiggy" && service !== "jaw" && service !== "bitrefill") {
    return JSON.stringify({ ok: false, error: `unknown service: ${service}` });
  }

  // Set permissions for each tool
  for (const [toolName, allow] of Object.entries(permissions)) {
    registry.setPermission(service as "swiggy" | "jaw" | "bitrefill", toolName, allow);
  }

  return JSON.stringify({ ok: true });
}
