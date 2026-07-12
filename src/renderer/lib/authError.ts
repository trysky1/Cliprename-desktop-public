// Raw auth-server errors ("invalid_grant", "Invalid login credentials") mean
// nothing to a consumer — translate the known ones into a next step.
export function friendlyAuthError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e)
  const l = raw.toLowerCase()
  if (l.includes('invalid login') || l.includes('invalid_grant') || l.includes('invalid credentials'))
    return 'That email and password don’t match. Try again, or reset your password on cliprename.com.'
  if (l.includes('fetch') || l.includes('network') || l.includes('enotfound') || l.includes('timeout'))
    return 'Couldn’t reach cliprename.com — check your internet connection and try again.'
  if (l.includes('email not confirmed'))
    return 'Confirm your email first — check your inbox for the cliprename.com confirmation link.'
  return raw
}
