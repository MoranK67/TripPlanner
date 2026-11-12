/** Where to go after signing in: the guarded page the user asked for, else the trips list. */
export function redirectTarget(state: unknown): string {
  if (typeof state === 'object' && state !== null && 'from' in state) {
    const from = (state as { from?: unknown }).from;
    if (typeof from === 'object' && from !== null) {
      const {
        pathname,
        search = '',
        hash = '',
      } = from as {
        pathname?: unknown;
        search?: unknown;
        hash?: unknown;
      };
      // Only same-app paths (no protocol-relative "//host" or the auth pages themselves).
      if (
        typeof pathname === 'string' &&
        pathname.startsWith('/') &&
        !pathname.startsWith('//') &&
        !pathname.startsWith('/\\') &&
        pathname !== '/login' &&
        typeof search === 'string' &&
        typeof hash === 'string'
      ) {
        return `${pathname}${search}${hash}`;
      }
    }
  }
  return '/trips';
}
