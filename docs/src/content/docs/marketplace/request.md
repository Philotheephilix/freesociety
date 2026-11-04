---
title: Request an integration
description: The pull-request-style format for requesting a custom MCP integration.
---

Integration requests use a **pull-request-style format**: a structured
description our developers can read, scope, and implement. Once a request is
submitted, our developers pick it up and build the integration into the hub.
This is the dream workflow — a well-formed request in, a working integration
out.

## The request format

Copy this template and fill every section. The clearer the request, the faster
it ships.

```md
## Title
<One line: the company and the job to automate.>

## Service
- Name:        <the external service or platform>
- API / docs:  <link to the API, or a note that there is none yet>
- Auth:        <how access is granted — API key, OAuth, etc.>

## The gap
<What can an agent NOT do today? What is the missing piece —
like Swiggy Money gift cards that had no redemption path?>

## Actions an agent needs
<List the discrete operations. Each becomes a passthrough tool.>
- action 1 — <inputs → result>
- action 2 — <inputs → result>

## Money movement
<Does this move money? Which rail? What should the spend cap gate?>

## Acceptance
<How do we know it works? The concrete end-to-end result.>

## Notes
<Rate limits, regions, constraints, anything else.>
```

## What happens to each section

| Section | How we use it |
| --- | --- |
| **Service** | Determines whether we wrap an MCP server or a REST API (like Bitrefill's four hand-written tools). |
| **The gap** | Confirms there is real missing capability — the reason the integration exists. |
| **Actions** | Each action becomes one namespaced passthrough tool (`<service>__<action>`). |
| **Money movement** | Decides how the spend cap and permission gate apply. |
| **Acceptance** | Becomes the end-to-end test we ship against. |

## After you submit

1. **Review.** We confirm feasibility, scope, and fit with the hub's safety
   model.
2. **Build.** Our developers implement the integration.
3. **Ship.** The new `<service>__*` tools appear on the hub via
   `notifications/tools/list_changed`; your agents call them like any other
   passthrough tool. See [The passthrough model](/internal/passthrough/).

## Cost

Building the integration is free. The only charge is the standard **1% of
Bitrefill's commission** on settled transactions — see the
[Business model](/marketplace/business-model/).

If your request is not yet fully specified, [join the
waitlist](/marketplace/waitlist/) and we will help you shape it.
