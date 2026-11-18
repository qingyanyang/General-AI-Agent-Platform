/** PROTOTYPE (#54): display helpers for directory users with missing profile fields. */
import type { DirectoryUser } from './mock/users-data'

export function userPrimaryLabel(user: Pick<DirectoryUser, 'id' | 'display_name'>): string {
  return user.display_name?.trim() || user.id
}

export function userSecondaryLabel(user: Pick<DirectoryUser, 'id' | 'display_name' | 'email'>): string | null {
  if (user.display_name?.trim()) {
    return user.email?.trim() || user.id
  }
  return user.email?.trim() || null
}
