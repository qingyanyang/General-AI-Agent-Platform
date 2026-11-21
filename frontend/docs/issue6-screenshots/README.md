# Issue 6 visual comparison screenshots

Captured during local validation on `feat/52-53-production-ui`.

| File | What |
|---|---|
| `issue6-production-signin-desktop.png` | Production Auth0 sign-in (desktop). Teal accent + serif headline. `/health` failed — local API not running. |
| `issue6-production-signin-mobile.png` | Same screen at ~390×844. |
| `issue6-prototype-chat-desktop.png` | Approved prototype Chat workspace (desktop) layout baseline. |
| `issue6-prototype-chat-mobile.png` | Prototype Chat at ~390×844 (shows prototype Chat-header Publish — **not** shipped in production). |

## Intentional deviations visible in comparison

- Production nav uses **Groups** instead of prototype **Users**.
- Production has **no** Chat-header Publish; Instruction Skills Publish is Configure-only.
- Production keeps Auth0 sign-in (no persona / Demo controls banner).

## Skipped live checks

Authenticated production Chat / Settings / Groups with local API + real login were **skipped**:

- Local API `/health` failed (`Failed to fetch`).
- Attempted Auth0 login hit callback URL mismatch; Auth0 was not modified.

Mocked Vitest coverage does **not** count as live end-to-end validation.
