import { ServiceError } from '@/lib/api';

/**
 * One short phrase for a failed index-service call.
 *
 * WHY A SHARED HELPER
 *
 * Two pages show the same failure in the same place -- a figure's hint line -- and a hint has to
 * be short. Written inline, each page would collapse the four failure kinds into "unavailable",
 * which throws away the distinction this console exists to keep:
 *
 *   no-route    this page was served without a route to the service. Nothing was asked, and
 *               nothing about the service is known. On a static host this is the normal state.
 *   unreachable the service exists and is not running. A reader can start it.
 *   refused     the service answered and said no. Its own message is in `detail`.
 *   bad URL     a bug in this console, not a problem with the service.
 *
 * Collapsing them sends a reader to debug the wrong thing -- the same mistake `src/lib/api.ts`
 * records about a malformed URL being reported as a service that is down.
 */
export function describeServiceFailure(error: unknown): string {
  if (error instanceof ServiceError) {
    switch (error.kind) {
      case 'no-route':
        return 'this page has no route to the index service';
      case 'unreachable':
        return 'the index service is not running';
      case 'refused':
        return error.status === null ? 'the index service refused the request' : `the index service refused the request (${error.status})`;
      case 'bad-request-url':
        return 'the console built an invalid URL for the index service';
    }
  }
  return 'the index service is unavailable';
}
