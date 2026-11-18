/**
 * PROTOTYPE-ONLY platform permissions.
 * Not added to production `@/lib/permissions` until integration is approved.
 *
 * - `agents:prompt` distinguishes prompt-only editing from full `agents:configure`.
 * - `platform:technical` gates technical settings for Super Admin only.
 * - `directory:browse` allows the basic People list for every signed-in user.
 * - `users:read` unlocks administrator user-detail / membership inspection.
 */
export const USERS_READ = 'users:read'
export const USAGE_READ_ANY = 'usage:read:any'
export const AGENTS_PROMPT = 'agents:prompt'
export const PLATFORM_TECHNICAL = 'platform:technical'
export const DIRECTORY_BROWSE = 'directory:browse'
