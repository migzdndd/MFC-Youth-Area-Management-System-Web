import { loadSession } from './auth-session.js';

export const SUPER_ADMIN_ROLES = new Set([
  'couple_coordinator',
  'area_servant',
  'lit_servant'
]);

export function isSuperAdminRole(role) {
  return SUPER_ADMIN_ROLES.has(String(role || '').trim().toLowerCase());
}

export function isChapterServantRole(role) {
  return String(role || '').trim().toLowerCase() === 'chapter_servant';
}

export async function requireAuthenticatedProfile(req) {
  const session = await loadSession(req);
  if (!session) {
    const error = new Error('Session is invalid or expired.');
    error.statusCode = 401;
    error.code = 'INVALID_SESSION';
    throw error;
  }

  return {
    account: session.account,
    user: {
      id: session.account.id,
      email: session.account.email,
      user_metadata: {
        display_name: session.account.display_name
      }
    },
    profile: session.profile,
    tokenHash: session.tokenHash,
    sessionId: session.sessionId
  };
}
