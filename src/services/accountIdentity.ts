import type { User } from "../types";

// Some profile-write responses intentionally return only public profile fields.
// Preserve previously server-issued identity metadata for the *same* account
// when those fields are omitted. An explicit null badge always revokes the UI
// seal; switching accounts never carries identity metadata across users.
export function reconcileAccountIdentity(previous: User | null, incoming: User): User {
  if (!previous || previous.id !== incoming.id || previous.username !== incoming.username) {
    return incoming;
  }

  return {
    ...incoming,
    ...(incoming.badgeType === undefined && previous.badgeType !== undefined
      ? { badgeType: previous.badgeType }
      : {}),
    ...(incoming.role === undefined && previous.role !== undefined
      ? { role: previous.role }
      : {}),
  };
}
