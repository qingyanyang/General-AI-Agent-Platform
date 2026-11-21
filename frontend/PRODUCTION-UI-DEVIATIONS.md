# Production UI deviations (Issue 6 / #52–#53)

Intentional differences from `frontend/prototypes/agent-management` after production integration.

## Authorization and eligibility

- No prototype personas, `agents:prompt`, or demo controls. JWT permissions drive UI visibility; the API remains authoritative.
- Instruction Skills editability is probed with `GET /agents/{id}/instruction-skills` for the **selected** agent only (or the settings-route agent). `200` → editor, `403` → hide editor and stay signed in, network/5xx → retryable error.
- Technical configuration and catalogs require `platform:technical`. Admins without it can still edit metadata, Access, and Instruction Skills when eligible.
- Group Leaders may list memberships; membership PUT/DELETE controls are hidden without `agent-access:manage`.

## Navigation and IA

- Primary rail is **Chat** + **Groups** (not Users). `/directory` redirects to `/groups`.
- `/manage` redirects to `/agents`. Agent settings live at `/agents/:id/settings/:section?`.
- Chat is the default entry (`/` → `/chat`). There is **no** Chat-header Publish for Instruction Skills; publish lives only in the Configure tab.
- Account menu shows the signed-in label and **Sign out** only (no profile rename).

## Independent save states

- Metadata, Access (draft save + activate), Instruction Skills Publish, and technical configuration each save independently.
- Instruction Skills Publish is one full-replacement PUT. Failure keeps the local draft. Empty collections are allowed. Discard requires confirmation. Server response becomes the new baseline (IDs may change).

## Intentional prototype deviations (this slice)

- **Groups replaces the Users/Groups directory for now.** Primary nav is Chat + Groups; `/directory` redirects to `/groups`.
- **Adding members** uses an existing user’s exact Auth0 subject (`user_id`). No directory search, names, emails, or avatars.
- **Users list** and **administrator user-detail Access/Usage** remain **deferred product requirements** (missing directory list and cross-user execution contracts). They are not cancelled by this integration.
- **No backend additions** were authorized or shipped in this slice (no eligibility flag, no directory HTTP API).
- **No Chat-header Publish** for Instruction Skills; Publish lives only in Configure (sticky bar on the Instruction Skills section).
- Instruction Skills reorder uses accessible **Move up / Move down** (no drag-and-drop).

## Fidelity pass (existing features)

Production Chat / settings / Access / Groups chrome was brought closer to the prototype:

- Chat agent **picker**, conversation list, serif **AgentIntro**, rounded composer with circular Send/Stop (no attach/voice).
- Settings `max-w-5xl` header (eyebrow, serif title, CopyText id), sticky Instruction Skills publish bar, technical SectionCards.
- Access radio cards + rounded lists (Issue 4 semantics unchanged).
- Groups directory-style list / detail header.

## Hidden / unavailable (unsupported or out of scope)

- File upload, voice, generated-file chrome
- MCP server URL/credential UI and knowledge ingestion UI
- Invites, profile rename, role administration
- Combined Configure “Publish everything” (prototype); production keeps separate actions
- Server-side shared drafts / draft badges

## Membership labels

- Membership add uses an exact Auth0 subject text field.
- UI displays the opaque `user_id` only (no directory display names).

## Access semantics

- Issue 4 AccessPanel behavior is preserved: draft save, explicit activate while on legacy grants, owning-group rules, and hiding legacy grant chrome after audience activation on the agent Access tab.
- Legacy grant management by typed agent ID remains on the Agents list page for `agent-access:manage` callers.
