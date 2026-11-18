# Production follow-up (not implemented in this phase)

Documented for planning after prototype approval. Do not implement without an explicit production integration request.

## Auth0 role / permission mapping

- Three fixed platform roles: Super Admin, Admin, User.
- Group leadership is **not** an Auth0 role; store Leader/Member per group membership in EAP.
- Roles and operation permissions stay in Auth0; EAP must not offer a role or permission editor.
- Prompt-only permission distinct from full `agents:configure` (prototype: `agents:prompt`).
- Super Admin alone retains platform technical permissions (`platform:technical`).
- Basic directory browse may be implicit for all signed-in users (prototype: `directory:browse`).

## Backend operation and scope checks

- Authorize from validated token permissions **and** resource scope (membership, leadership, access audience, owning group).
- Access audience: company-wide **or** selected groups. Access grants use rights only, never Prompt editing.
- Owning group optional (null = administrator-only Prompt editing); at most one; when audience is selected groups, include the owning group for use and block removing it until ownership changes.
- Changing ownership must not silently remove the previous group’s usage access.
- User Leaders: membership management only for led groups; prompt edit only when leading the agent’s owning group. Access-only group Leaders cannot edit the Prompt.
- Prompt-editing rights do not grant permission to change ownership, access assignments, metadata, technical configuration, or lifecycle.
- Cross-user Access/Usage: Admin/Super Admin only. Users keep personal execution history.

## Migration away from direct capability grants

- Do not silently convert or discard existing View / Configure / Execute grants.
- Inventory grants, map to audience + group assignments + owning group, dual-read during cutover, then remove grant bypass paths.
- Tests proving legacy grants cannot remain a hidden access bypass after cutover.

## Prompt-only update contract

- Dedicated prompt update endpoint or server-side field allowlist so Users/Admins without technical permission cannot change tools, models, credentials, or approval policy via a full configuration PUT.

## Technical settings

- Restrict models, tools, MCP, skills, approval policies, and credentials to Super Admin.
- Admin business configuration: create/deactivate, metadata, prompts, access audience, owning group.
