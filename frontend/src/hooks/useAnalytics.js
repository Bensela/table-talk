import { useCallback, useRef, useEffect } from 'react';
import {
  trackPublicEvent,
  trackSessionEvent,
  firePublicEvent,
  fireSessionEvent,
  getAnonymousId
} from '../utils/analytics';

/**
 * React hook exposing the analytics tracker helpers as stable callback refs.
 *
 * - Auto-injects anonymous_id from sessionStorage on every call.
 * - Accepts optional `ids: { session_id, participant_id }` on a per-call basis
 *   for components that already have them via handshake context/props, or
 *   pulls them from shared sessionStorage when the caller doesn't supply.
 * - trackPublic/trackSession return promises (awaitable when needed).
 * - firePublic/fireSession are fire-and-forget (no return) for use in onClick /
 *   sync callbacks where promise dangling would be a distraction.
 *
 * Usage:
 *   const { firePublic, fireSession, trackSession } = useAnalytics();
 *   useEffect(() => firePublic({ event_type: 'welcome_screen_rendered' }), []);
 *   <Button onClick={() => firePublic({ event_type: 'welcome_continue_clicked' })} />
 */
export default function useAnalytics(identityOverrides = {}) {
  const idsRef = useRef({});
  idsRef.current = identityOverrides || {};

  // One-shot: ensure anonymous_id exists in sessionStorage as early as possible
  // so even very first page-render events carry the funnel id.
  useEffect(() => {
    getAnonymousId();
  }, []);

  const trackPublic = useCallback((payload = {}) => {
    const merged = {
      ...payload,
      ids: { ...(payload.ids || {}), ...idsRef.current }
    };
    return trackPublicEvent(merged);
  }, []);

  const trackSession = useCallback((payload = {}) => {
    const merged = {
      ...payload,
      ids: { ...(payload.ids || {}), ...idsRef.current }
    };
    return trackSessionEvent(merged);
  }, []);

  const firePublic = useCallback((payload = {}) => {
    const merged = {
      ...payload,
      ids: { ...(payload.ids || {}), ...idsRef.current }
    };
    firePublicEvent(merged);
  }, []);

  const fireSession = useCallback((payload = {}) => {
    const merged = {
      ...payload,
      ids: { ...(payload.ids || {}), ...idsRef.current }
    };
    fireSessionEvent(merged);
  }, []);

  return {
    trackPublic,
    trackSession,
    firePublic,
    fireSession,
    getAnonymousId
  };
}
