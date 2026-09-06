import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import Button from '../components/ui/Button';
import { resolveSession, joinDualSession, publicHandshake, requestTempGeoAccess, clearTempGeoAccessToken, TEMP_GEO_EXPIRED_EVENT } from '../api';
import { storeParticipant, getStoredParticipant, getDualSession, storeDualSession } from '../utils/sessionStorage';
import { useSocket } from '../context/SocketContext';
import { requestCurrentPositionWithFallback, requestHighAccuracyPosition, readGeolocationPermissionState } from '../utils/geolocation';
import useAnalytics from '../hooks/useAnalytics';

/**
 * Small inline banner that shows "Temporary access valid until X:XX AM"
 * with a live countdown. Once the expire time is reached, it calls onExpire
 * so the parent can reset state and bounce the user back to the geo gate.
 */
function TempAccessBanner({ banner, onExpire }) {
  const [remaining, setRemaining] = useState(() => {
    const nowSec = Math.floor(Date.now() / 1000);
    return Math.max(0, Number(banner.expires_at_unix || 0) - nowSec);
  });
  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const left = Math.max(0, Number(banner.expires_at_unix || 0) - nowSec);
      if (!cancelled) setRemaining(left);
      if (left <= 0 && typeof onExpire === 'function' && !cancelled) {
        cancelled = true;
        try { onExpire(); } catch (_) { /* ignore */ }
      }
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [banner.expires_at_unix, onExpire]);

  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  const pad = (n) => String(n).padStart(2, '0');
  const expiresAtLocal = banner.expires_at_unix
    ? new Date(Number(banner.expires_at_unix) * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : null;

  return (
    <div className="w-full inline-flex items-center justify-between gap-3 rounded-2xl border border-[#926B1A]/30 bg-[#FBF7EF] px-4 py-3 text-left">
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-[0.18em] text-[#926B1A] font-semibold">
          Temporary Access
        </p>
        <p className="text-[13px] text-[#35332E] truncate">
          {expiresAtLocal ? `Valid until ${expiresAtLocal}` : 'Limited-time access window'}
        </p>
      </div>
      <div className="shrink-0 text-[#926B1A] font-mono tabular-nums text-sm font-semibold">
        {pad(minutes)}:{pad(seconds)}
      </div>
    </div>
  );
}

export default function WelcomeScreen() {
  const { tableToken, restaurantSlug } = useParams();
  const navigate = useNavigate();
  const { firePublic, fireSession } = useAnalytics();

  const activeRestaurantSlug = restaurantSlug || null;

  const { socket, isConnected, ensureConnection } = useSocket();
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState(null);
  const [setupStatus, setSetupStatus] = useState('available'); // 'available', 'busy', 'granted'
  const [waitingForA, setWaitingForA] = useState(false);
  const [blockedError, setBlockedError] = useState(null);
  const [subscriptionError, setSubscriptionError] = useState(null); // 'suspended' | 'invalid' | 'geofence_denied'
  const [geofenceInfo, setGeofenceInfo] = useState(null);
  const [lastLocationAccuracyM, setLastLocationAccuracyM] = useState(null);
  const [initialValidationPending, setInitialValidationPending] = useState(true);
  const [geoPermissionState, setGeoPermissionState] = useState(null); // 'granted' | 'prompt' | 'denied' | 'unsupported'
  const [tempAccessLoading, setTempAccessLoading] = useState(false);
  const [tempAccessBanner, setTempAccessBanner] = useState(null); // { expires_at_unix, expires_at_iso } | null
  const setupCompletedRef = useRef(false);
  const validatedRef = useRef(false);
  const validationStartedRef = useRef(false);
  const renderedRef = useRef(false);
  const gpsUpgradeAttemptedRef = useRef(false);

  async function attemptLowAccuracyBypass() {
    setChecking(true);
    setStatus('Connecting with reduced location accuracy...');
    firePublic({
      event_type: 'welcome_low_accuracy_bypass_attempt',
      event_data: {
        restaurant_slug: activeRestaurantSlug,
        table_token: tableToken,
        distance_m: geofenceInfo?.distance_m ?? null,
        configured_radius_m: geofenceInfo?.configured_radius_m ?? null,
        last_accuracy_m: lastLocationAccuracyM,
        gps_upgrade_attempted: gpsUpgradeAttemptedRef.current === true
      }
    });
    let locationPayload = null;
    let geolocationStatus = 'prompt';
    const fallback = await requestCurrentPositionWithFallback({
      acceptIfWithinMeters: 1000,
      dedupeKey: `welcome-bypass:${activeRestaurantSlug || 'any'}:${tableToken || 'any'}`
    });
    if (fallback.ok && fallback.coords) {
      locationPayload = {
        latitude: fallback.coords.latitude,
        longitude: fallback.coords.longitude,
        accuracy: fallback.coords.accuracy ?? null
      };
      setLastLocationAccuracyM(fallback.coords.accuracy ?? null);
      geolocationStatus = 'granted';
    } else {
      geolocationStatus = fallback.status || 'denied';
    }
    try {
      const result = await publicHandshake(activeRestaurantSlug, tableToken, {
        location: locationPayload,
        geolocationStatus,
        bypass: 'low_accuracy_device'
      });
      firePublic({
        event_type: 'welcome_low_accuracy_bypass_passed',
        event_data: {
          restaurant_slug: activeRestaurantSlug,
          table_token: tableToken,
          distance_m: geofenceInfo?.distance_m ?? null,
          configured_radius_m: geofenceInfo?.configured_radius_m ?? null,
          low_accuracy_bypass_granted: result.data?.geofence?.low_accuracy_bypass_granted === true,
          radius_overridden: result.data?.geofence?.radius_overridden === true
        }
      });
      validatedRef.current = true;
      setGeofenceInfo(null);
      setSubscriptionError(null);
      setChecking(false);
      setStatus(null);
      setInitialValidationPending(false);
    } catch (err) {
      setChecking(false);
      setStatus(null);
      const code = err?.response?.data?.geofence_code;
      if (err?.response?.status === 403 && code === 'OUTSIDE_RADIUS') {
        setGeofenceInfo({
          distance_m: err.response.data.distance_m,
          configured_radius_m: err.response.data.configured_radius_m,
          restaurant_name: err.response.data.restaurant_name || '',
          suggest_high_accuracy: err.response.data.suggest_high_accuracy === true,
          effective_radius_m: err.response.data.effective_radius_m || err.response.data.configured_radius_m,
          radius_overridden: err.response.data.radius_overridden === true,
          bypass_denied: true
        });
        firePublic({
          event_type: 'welcome_low_accuracy_bypass_denied',
          event_data: {
            restaurant_slug: activeRestaurantSlug,
            table_token: tableToken,
            distance_m: err.response.data.distance_m,
            configured_radius_m: err.response.data.configured_radius_m
          }
        });
        setSubscriptionError('geofence_denied');
        return;
      }
      if (err?.response?.status === 403) {
        setSubscriptionError('suspended');
      } else {
        setSubscriptionError('invalid');
      }
    }
  }

  /**
   * GPS high-accuracy upgrade + handshake re-run. Returns true if inside,
   * false otherwise. On success it leaves the session flow continue (no
   * navigation change since Welcome is already the destination route);
   * on failure it refreshes geofenceInfo with upgraded distance.
   */
  async function upgradeToGpsAndRetryHandshake({ context = 'auto' } = {}) {
    setStatus('Refining location with GPS...');
    firePublic({
      event_type: 'welcome_geolocation_gps_upgrade',
      event_data: {
        restaurant_slug: activeRestaurantSlug,
        table_token: tableToken,
        context
      }
    });
    const gps = await requestHighAccuracyPosition({
      dedupeKey: `welcome-gps:${activeRestaurantSlug || 'any'}:${tableToken || 'any'}:${context}`
    });
    if (gps.ok && gps.coords && typeof gps.coords.accuracy === 'number') {
      setLastLocationAccuracyM(gps.coords.accuracy);
    }
    if (!gps.ok || !gps.coords) {
      firePublic({
        event_type: 'welcome_geolocation_gps_upgrade_failed',
        event_data: {
          restaurant_slug: activeRestaurantSlug,
          table_token: tableToken,
          context,
          status: gps.status,
          error: gps.error || null
        }
      });
      return false;
    }
    try {
      await publicHandshake(activeRestaurantSlug, tableToken, {
        location: { latitude: gps.coords.latitude, longitude: gps.coords.longitude },
        geolocationStatus: 'granted'
      });
      firePublic({
        event_type: 'welcome_geolocation_gps_upgrade_passed',
        event_data: {
          restaurant_slug: activeRestaurantSlug,
          table_token: tableToken,
          context,
          accuracy_m: gps.coords.accuracy ?? null
        }
      });
      setGeofenceInfo(null);
      validatedRef.current = true;
      setInitialValidationPending(false);
      return true;
    } catch (err2) {
      firePublic({
        event_type: 'welcome_geolocation_gps_upgrade_still_outside',
        event_data: {
          restaurant_slug: activeRestaurantSlug,
          table_token: tableToken,
          context,
          distance_m: err2?.response?.data?.distance_m ?? null,
          configured_radius_m: err2?.response?.data?.configured_radius_m ?? null,
          accuracy_m: gps.coords.accuracy ?? null
        }
      });
      if (err2?.response?.status === 403 && err2?.response?.data?.geofence_code === 'OUTSIDE_RADIUS') {
        setGeofenceInfo({
          distance_m: err2.response.data.distance_m,
          configured_radius_m: err2.response.data.configured_radius_m,
          restaurant_name: err2.response.data.restaurant_name || '',
          suggest_high_accuracy: err2.response.data.suggest_high_accuracy === true,
          effective_radius_m: err2.response.data.effective_radius_m || err2.response.data.configured_radius_m,
          radius_overridden: err2.response.data.radius_overridden === true,
          gps_upgrade_failed: true
        });
      }
      return false;
    }
  }

  // ── Route-param change hard reset ─────────────────────────────────────────────
  // React Router v6 reuses the same WelcomeScreen instance whenever the user
  // navigates between two URLs that match /r/:restaurantSlug/t/:tableToken
  // (e.g. scan Bistro QR then scan a lambda / unregistered QR without going
  // through Home first). Without this reset the prior slug's state bleeds
  // across: subscriptionError stays 'geofence_denied', geofenceInfo keeps the
  // old restaurant name+distance, validatedRef / validationStartedRef block
  // re-validation so the new slug never runs handshake and never bounces to
  // the "Invalid QR Code" error page when it should.
  useEffect(() => {
    validationStartedRef.current = false;
    validatedRef.current = false;
    renderedRef.current = false;
    gpsUpgradeAttemptedRef.current = false;
    setupCompletedRef.current = false;
    setSubscriptionError(null);
    setGeofenceInfo(null);
    setLastLocationAccuracyM(null);
    setInitialValidationPending(true);
    setWaitingForA(false);
    setBlockedError(null);
    setChecking(false);
    setSetupStatus('available');
    setStatus(null);
    setTempAccessBanner(null);
    // Reset geo permission state to unknown on QR change; the validation
    // effect will re-read it via readGeolocationPermissionState on run.
    setGeoPermissionState(null);
  }, [restaurantSlug, tableToken]);

  // ── Geo permission warm-read + temp-access expiry redirect ────────────────
  useEffect(() => {
    let cancelled = false;
    readGeolocationPermissionState().then((s) => {
      if (!cancelled) setGeoPermissionState(s || 'prompt');
    }).catch(() => { if (!cancelled) setGeoPermissionState('unsupported'); });

    function onTempGeoExpired() {
      clearTempGeoAccessToken();
      setTempAccessBanner(null);
      // If user is still on WelcomeScreen, reset handshake so they see
      // the geofence denied screen again instead of a stale "Continue".
      if (validatedRef.current) {
        validatedRef.current = false;
        validationStartedRef.current = false;
        setSubscriptionError('geofence_denied');
        setInitialValidationPending(false);
      }
    }
    if (typeof window !== 'undefined') {
      window.addEventListener(TEMP_GEO_EXPIRED_EVENT, onTempGeoExpired);
    }
    return () => {
      cancelled = true;
      if (typeof window !== 'undefined') {
        window.removeEventListener(TEMP_GEO_EXPIRED_EVENT, onTempGeoExpired);
      }
    };
  }, [restaurantSlug, tableToken]);

  // Save the resolved restaurant slug to session state on mount / update
  useEffect(() => {
    if (!activeRestaurantSlug) {
      setSubscriptionError('invalid');
      return;
    }
    sessionStorage.setItem('restaurant_slug', activeRestaurantSlug);
  }, [activeRestaurantSlug]);

  // Funnel event: Welcome screen rendered (fires per new QR / reset)
  useEffect(() => {
    if (renderedRef.current || !activeRestaurantSlug || !tableToken) return;
    renderedRef.current = true;
    firePublic({
      event_type: 'welcome_screen_rendered',
      event_data: {
        restaurant_slug: activeRestaurantSlug,
        table_token: tableToken,
        has_stored_participant: Boolean(getStoredParticipant()?.participantId),
        has_dual_backup: Boolean(getDualSession(tableToken))
      }
    });
  }, [activeRestaurantSlug, tableToken, firePublic]);

  // ── Subscription & Table Validation ────────────────────────────────────────────
  // Runs ASAP to fail fast BEFORE the user can see or interact with the
  // Welcome screen. Restaurant status + geofence are confirmed first.
  useEffect(() => {
    if (!tableToken || !activeRestaurantSlug || validationStartedRef.current) return;

    async function validate() {
      validationStartedRef.current = true;
      setStatus('Checking restaurant & location…');
      try {
        // Best-effort two-stage geolocation: coarse first, upgrade to
        // high-accuracy only if coarse returned a fix worse than ~250m.
        // Permission read runs in parallel so we can tag events correctly.
        const [permission, positionResult] = await Promise.all([
          readGeolocationPermissionState(),
          requestCurrentPositionWithFallback({
            acceptIfWithinMeters: 250,
            dedupeKey: `welcome:${activeRestaurantSlug || 'any'}:${tableToken || 'any'}`
          })
        ]);
        const locationPayload = positionResult.ok && positionResult.coords
          ? { latitude: positionResult.coords.latitude, longitude: positionResult.coords.longitude }
          : null;
        if (positionResult.ok && positionResult.coords && typeof positionResult.coords.accuracy === 'number') {
          setLastLocationAccuracyM(positionResult.coords.accuracy);
        }
        const geolocationStatus = positionResult.ok
          ? 'granted'
          : permission || (positionResult.status === 'denied' ? 'denied' : 'prompt');

        firePublic({
          event_type: 'welcome_geolocation_request',
          event_data: {
            restaurant_slug: activeRestaurantSlug,
            table_token: tableToken,
            permission_state: permission,
            position_status: positionResult.status,
            accuracy_m: positionResult.coords?.accuracy ?? null
          }
        });

        const result = await publicHandshake(activeRestaurantSlug, tableToken, {
          location: locationPayload,
          geolocationStatus
        });
        // If handshake carries temp-access metadata (user had a temp token already
        // stored from a prior tab session and got scoped-access granted), surface
        // the banner so the expiry is visible.
        if (result.data?.geofence?.temp_access_granted === true) {
          setTempAccessBanner({
            expires_at_unix: result.data.geofence.temp_access_expires_at_unix || null,
            expires_at_iso: result.data.geofence.temp_access_expires_at_iso || null
          });
        }
        // eslint-disable-next-line no-unused-vars
        const _h = result;
        // Valid — proceed normally
        validatedRef.current = true;
        setStatus(null);
        setInitialValidationPending(false);
      } catch (err) {
        if (err.response?.status === 403) {
          if (err.response.data && err.response.data.geofence_code === 'LOCATION_PERMISSION_DENIED') {
            setGeoPermissionState('denied');
            setGeofenceInfo({
              restaurant_name: err.response.data.restaurant_name || '',
              geolocation_status: 'denied',
              action_required: err.response.data.action_required || 'enable_location_permission',
              distance_m: err.response.data.distance_m,
              configured_radius_m: err.response.data.configured_radius_m,
              effective_radius_m: err.response.data.effective_radius_m,
              temp_access_possible: false
            });
            setSubscriptionError('geofence_denied');
            setInitialValidationPending(false);
            return;
          }
          if (err.response.data && err.response.data.geofence_code === 'OUTSIDE_RADIUS') {
            // Auto-recovery: when backend detects a wildly-off distance it
            // sets suggest_high_accuracy=true → do one GPS high-accuracy
            // upgrade before failing closed.
            const shouldAutoUpgrade =
              !gpsUpgradeAttemptedRef.current &&
              err.response.data.suggest_high_accuracy === true;
            if (shouldAutoUpgrade) {
              gpsUpgradeAttemptedRef.current = true;
              firePublic({
                event_type: 'welcome_geofence_suggested_upgrade',
                event_data: {
                  restaurant_slug: activeRestaurantSlug,
                  table_token: tableToken,
                  distance_m: err.response.data.distance_m,
                  configured_radius_m: err.response.data.configured_radius_m
                }
              });
              setChecking(true);
              const upgraded = await upgradeToGpsAndRetryHandshake({ context: 'auto-from-validate' });
              setChecking(false);
              setStatus(null);
              if (upgraded) {
                // handshake inside the helper succeeded; clear error flow
                setInitialValidationPending(false);
                return;
              }
              // still outside after GPS upgrade → show block
              setGeofenceInfo({
                distance_m: err.response.data.distance_m,
                configured_radius_m: err.response.data.configured_radius_m,
                restaurant_name: err.response.data.restaurant_name || '',
                suggest_high_accuracy: err.response.data.suggest_high_accuracy === true,
                effective_radius_m: err.response.data.effective_radius_m || err.response.data.configured_radius_m,
                radius_overridden: err.response.data.radius_overridden === true,
                gps_upgrade_failed: true,
                geolocation_status: err.response.data.geolocation_status || null,
                requires_geolocation: err.response.data.requires_geolocation === true,
                temp_access_possible: err.response.data.temp_access_possible === true
              });
              setSubscriptionError('geofence_denied');
              firePublic({
                event_type: 'welcome_geofence_denied',
                event_data: {
                  restaurant_slug: activeRestaurantSlug,
                  table_token: tableToken,
                  distance_m: err.response.data.distance_m,
                  configured_radius_m: err.response.data.configured_radius_m,
                  upgraded_gps: true
                }
              });
              validatedRef.current = true;
              setInitialValidationPending(false);
              return;
            }
            setGeofenceInfo({
              distance_m: err.response.data.distance_m,
              configured_radius_m: err.response.data.configured_radius_m,
              restaurant_name: err.response.data.restaurant_name || '',
              suggest_high_accuracy: err.response.data.suggest_high_accuracy === true,
              effective_radius_m: err.response.data.effective_radius_m || err.response.data.configured_radius_m,
              radius_overridden: err.response.data.radius_overridden === true,
              geolocation_status: err.response.data.geolocation_status || null,
              requires_geolocation: err.response.data.requires_geolocation === true,
              temp_access_possible: err.response.data.temp_access_possible === true
            });
            setSubscriptionError('geofence_denied');
            firePublic({
              event_type: 'welcome_geofence_denied',
              event_data: {
                restaurant_slug: activeRestaurantSlug,
                table_token: tableToken,
                distance_m: err.response.data.distance_m,
                configured_radius_m: err.response.data.configured_radius_m
              }
            });
            validatedRef.current = true;
            setInitialValidationPending(false);
            return;
          }
          setSubscriptionError('suspended');
        } else {
          setSubscriptionError('invalid');
        }
        validatedRef.current = true;
        setStatus(null);
        setInitialValidationPending(false);
      }
    }

    // Kick off validation immediately (handshake is pure REST — no socket
    // dependency). Also register on-connect in case socket-ready timing
    // helps any downstream listeners we already had.
    validate();
    if (socket && !isConnected) {
      const onConnect = () => { /* no-op: validate already started above */ };
      socket.once('connect', onConnect);
    }
  }, [isConnected, socket, tableToken, activeRestaurantSlug, firePublic]);

  // ── Geofence Retry ────────────────────────────────────────────────────────────
  // Asks for location again (handles user granting permission via browser prompt)
  // and re-runs handshake. Explicit retry always starts with true GPS
  // high-accuracy since the user is already at the "check again" interaction.
  const retryGeolocationCheck = async () => {
    setSubscriptionError(null);
    setGeofenceInfo(null);
    setChecking(true);
    setStatus('Checking with GPS location...');

    const upgraded = await upgradeToGpsAndRetryHandshake({ context: 'retry-button' });
    if (upgraded) {
      setChecking(false);
      setStatus(null);
      setInitialValidationPending(false);
      return;
    }

    try {
      const positionResult = await requestCurrentPositionWithFallback({
        acceptIfWithinMeters: 200,
        dedupeKey: `welcome-retry:${activeRestaurantSlug || 'any'}:${tableToken || 'any'}`
      });
      const locationPayload = positionResult.ok && positionResult.coords
        ? { latitude: positionResult.coords.latitude, longitude: positionResult.coords.longitude }
        : null;
      const geolocationStatus = positionResult.ok ? 'granted' : positionResult.status;

      await publicHandshake(activeRestaurantSlug, tableToken, {
        location: locationPayload,
        geolocationStatus
      });

      // Success — clear any prior geofence info and let the user continue.
      validatedRef.current = true;
      setGeofenceInfo(null);
      setChecking(false);
      setStatus(null);
      setInitialValidationPending(false);
    } catch (err) {
      setChecking(false);
      setStatus(null);
      if (err.response?.status === 403) {
        if (err.response.data && err.response.data.geofence_code === 'OUTSIDE_RADIUS') {
          // Last-gasp: if still wildly-outside + GPS not yet retried this run
          if (!gpsUpgradeAttemptedRef.current && err.response.data.suggest_high_accuracy === true) {
            gpsUpgradeAttemptedRef.current = true;
            setChecking(true);
            const finalPass = await upgradeToGpsAndRetryHandshake({ context: 'retry-fallback' });
            setChecking(false);
            if (finalPass) {
              setInitialValidationPending(false);
              return;
            }
          }
          setGeofenceInfo({
            distance_m: err.response.data.distance_m,
            configured_radius_m: err.response.data.configured_radius_m,
            restaurant_name: err.response.data.restaurant_name || '',
            suggest_high_accuracy: err.response.data.suggest_high_accuracy === true,
            effective_radius_m: err.response.data.effective_radius_m || err.response.data.configured_radius_m,
            radius_overridden: err.response.data.radius_overridden === true,
            geolocation_status: err.response.data.geolocation_status || null,
            requires_geolocation: err.response.data.requires_geolocation === true,
            temp_access_possible: err.response.data.temp_access_possible === true
          });
          setSubscriptionError('geofence_denied');
          setInitialValidationPending(false);
          return;
        }
        if (err.response.data && err.response.data.geofence_code === 'LOCATION_PERMISSION_DENIED') {
          setGeoPermissionState('denied');
          setGeofenceInfo({
            restaurant_name: err.response.data.restaurant_name || '',
            geolocation_status: 'denied',
            action_required: err.response.data.action_required || 'enable_location_permission',
            distance_m: err.response.data.distance_m,
            configured_radius_m: err.response.data.configured_radius_m,
            effective_radius_m: err.response.data.effective_radius_m,
            temp_access_possible: false
          });
          setSubscriptionError('geofence_denied');
          setInitialValidationPending(false);
          return;
        }
        setSubscriptionError('suspended');
      } else {
        setSubscriptionError('invalid');
      }
      setInitialValidationPending(false);
    }
  };

  /**
   * Request a 5-minute temporary geolocation access window. Only available
   * when geolocation permission is NOT permanently denied (the backend
   * enforces this too as a second gate). On success, retries the handshake
   * so the user can proceed to the Welcome screen.
   */
  async function requestTemporaryGeoAccess() {
    setTempAccessLoading(true);
    setStatus('Requesting temporary access...');
    firePublic({
      event_type: 'welcome_temp_geo_access_request',
      event_data: {
        restaurant_slug: activeRestaurantSlug,
        table_token: tableToken
      }
    });

    // Get a fresh permission/coords reading so the backend can decide eligibility.
    let locationPayload = null;
    let geolocationStatus = 'prompt';
    try {
      const [permission, positionResult] = await Promise.all([
        readGeolocationPermissionState(),
        requestCurrentPositionWithFallback({
          acceptIfWithinMeters: 1000,
          dedupeKey: `welcome-tempgeo:${activeRestaurantSlug || 'any'}:${tableToken || 'any'}`
        })
      ]);
      setGeoPermissionState(permission || (positionResult.status === 'denied' ? 'denied' : 'prompt'));
      if (positionResult.ok && positionResult.coords) {
        locationPayload = {
          latitude: positionResult.coords.latitude,
          longitude: positionResult.coords.longitude,
          accuracy: positionResult.coords.accuracy ?? null
        };
        setLastLocationAccuracyM(positionResult.coords.accuracy ?? null);
        geolocationStatus = 'granted';
      } else {
        geolocationStatus = permission || positionResult.status || 'prompt';
      }
    } catch (_) {
      geolocationStatus = 'unsupported';
    }

    const result = await requestTempGeoAccess(activeRestaurantSlug, tableToken, {
      location: locationPayload,
      geolocationStatus
    });

    setTempAccessLoading(false);
    setStatus(null);

    if (result.temp_access_granted === true && result.temp_access_token) {
      firePublic({
        event_type: 'welcome_temp_geo_access_granted',
        event_data: {
          restaurant_slug: activeRestaurantSlug,
          table_token: tableToken,
          ttl_seconds: result.ttl_seconds || 300,
          expires_at_unix: result.expires_at_unix || null
        }
      });
      setTempAccessBanner({
        expires_at_unix: result.expires_at_unix || null,
        expires_at_iso: result.expires_at_iso || null
      });
      // Retry handshake — now the temp token is in sessionStorage and the
      // axios interceptor attaches it automatically.
      try {
        const handshakeRes = await publicHandshake(activeRestaurantSlug, tableToken, {
          location: locationPayload,
          geolocationStatus
        });
        if (handshakeRes.data?.geofence) {
          const gf = handshakeRes.data.geofence;
          if (gf.temp_access_granted) {
            setTempAccessBanner({
              expires_at_unix: gf.temp_access_expires_at_unix || result.expires_at_unix || null,
              expires_at_iso: gf.temp_access_expires_at_iso || result.expires_at_iso || null
            });
          }
        }
        validatedRef.current = true;
        setGeofenceInfo(null);
        setSubscriptionError(null);
        setInitialValidationPending(false);
      } catch (err2) {
        // If handshake STILL fails, surface the new error
        if (err2.response?.data?.geofence_code === 'LOCATION_PERMISSION_DENIED') {
          setGeoPermissionState('denied');
        }
        if (err2.response?.status === 403 && err2.response.data && err2.response.data.geofence_code === 'OUTSIDE_RADIUS') {
          setGeofenceInfo({
            distance_m: err2.response.data.distance_m,
            configured_radius_m: err2.response.data.configured_radius_m,
            restaurant_name: err2.response.data.restaurant_name || '',
            suggest_high_accuracy: err2.response.data.suggest_high_accuracy === true,
            effective_radius_m: err2.response.data.effective_radius_m || err2.response.data.configured_radius_m,
            radius_overridden: err2.response.data.radius_overridden === true,
            geolocation_status: err2.response.data.geolocation_status || null,
            temp_access_possible: err2.response.data.temp_access_possible === true
          });
        }
        setSubscriptionError('geofence_denied');
      }
      return;
    }

    // Denied path (geolocation_status === 'denied' from the endpoint)
    if (result.geolocation_status === 'denied' || result.action_required === 'enable_location_permission') {
      setGeoPermissionState('denied');
      setGeofenceInfo({
        restaurant_name: geofenceInfo?.restaurant_name || activeRestaurantSlug || '',
        geolocation_status: 'denied',
        action_required: result.action_required || 'enable_location_permission',
        temp_access_possible: false,
        error: result.error || null
      });
      setSubscriptionError('geofence_denied');
      firePublic({
        event_type: 'welcome_temp_geo_access_denied',
        event_data: {
          restaurant_slug: activeRestaurantSlug,
          table_token: tableToken,
          reason: 'location_permission_denied'
        }
      });
      return;
    }

    // Any other error: keep user on geofence_denied with the error message
    // preserved in geofenceInfo so they can see why temp access was denied
    // (defense-in-depth: the relaxed backend eligibility should make temp
    // access succeed for the stuck-outside case, but if any other unexpected
    // denial occurs we surface it visibly instead of silently no-op'ing).
    if (result.error || result.geofence) {
      setGeofenceInfo((prev) => ({
        ...(prev || {
          restaurant_name: geofenceInfo?.restaurant_name || activeRestaurantSlug || '',
          distance_m: geofenceInfo?.distance_m ?? null,
          configured_radius_m: geofenceInfo?.configured_radius_m ?? null,
          effective_radius_m: geofenceInfo?.effective_radius_m ?? null,
          radius_overridden: geofenceInfo?.radius_overridden === true,
          temp_access_possible: true
        }),
        temp_access_last_error: result.error || null,
        distance_m: result.geofence?.distance_m ?? geofenceInfo?.distance_m ?? null,
        configured_radius_m: result.geofence?.configured_radius_m ?? geofenceInfo?.configured_radius_m ?? null,
        effective_radius_m: result.geofence?.effective_radius_m ?? geofenceInfo?.effective_radius_m ?? null,
        requires_geolocation: result.geofence?.requires_geolocation === true,
        inside: result.geofence?.inside === true
      }));
    }
    firePublic({
      event_type: 'welcome_temp_geo_access_denied',
      event_data: {
        restaurant_slug: activeRestaurantSlug,
        table_token: tableToken,
        error: result.error || 'unknown'
      }
    });
  }

  const contextPath = `/r/${activeRestaurantSlug}/t/${tableToken}/context`;

  // Join setup room on mount
  useEffect(() => {
    if (blockedError) {
      // Auto-redirect after 3 seconds
      const timer = setTimeout(() => {
        setBlockedError(null);
        navigate('/');
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [blockedError, navigate]);
  useEffect(() => {
    if (tableToken && socket) {
      ensureConnection();
    }
  }, [tableToken, socket, ensureConnection]);

  useEffect(() => {
    if (isConnected && socket && tableToken) {
      console.log('[Welcome] Joining setup room for', tableToken);
      const existingLock = sessionStorage.getItem(`table_lock_${tableToken}`);
      socket.emit('join_table_setup', { tableToken, lockToken: existingLock });

      const handleStatus = (data) => {
        console.log('[Welcome] Setup status:', data.status);
        setSetupStatus(data.status);
        if (data.status === 'busy') {
          setWaitingForA(true);
        }
      };

      const handleClaimed = (data) => {
        // Since lockToken is managed internally or by session storage,
        // we can just assume if we receive this, someone else claimed it.
        // If WE claimed it, we would get the response via callback.
        const myLock = sessionStorage.getItem(`table_lock_${tableToken}`);
        if (data.lockToken !== myLock) {
          setSetupStatus('busy');
          setWaitingForA(true);
        }
      };

      const handleReleased = () => {
        setSetupStatus('available');
        setWaitingForA(false);
      };

      const handleSetupCompleted = async (data) => {
        console.log('[Welcome] Setup completed by partner:', data);
        setupCompletedRef.current = true;
        
        if (data.mode === 'dual-phone') {
          setStatus('Joining partner...');
          try {
            const joinRes = await joinDualSession({ session_id: data.sessionId, restaurant_slug: activeRestaurantSlug });
            const { participant_id, participant_token, session_id } = joinRes.data;
            storeParticipant(participant_id, session_id, participant_token);
            storeDualSession(tableToken, session_id, participant_id, participant_token);
            navigate(`/session/${session_id}/game`);
          } catch (err) {
            console.error('Auto-join failed:', err);
            setWaitingForA(false);
            setStatus(null);
          }
        } else {
          // Phone A chose Single Mode. Phone B is released to start their own.
          console.log('[Welcome] Partner chose Single Mode. Proceeding to create new session.');
          setWaitingForA(false);
          setStatus('Checking availability...');
          setSetupStatus('available');
          
          // Duplicate start_new logic to safely claim lock for Phone B before proceeding
          if (socket) {
              const doClaim = () => {
                  const existingLock = sessionStorage.getItem(`table_lock_${tableToken}`);
                  // Proceed with claim
                  socket.emit('claim_setup', { tableToken, lockToken: existingLock }, (response) => {
                      if (response.status === 'granted') {
                          sessionStorage.setItem(`table_lock_${tableToken}`, response.lockToken);
                          setStatus('Ready to start');
                          navigate(contextPath);
                      } else {
                          setWaitingForA(true);
                          setStatus(null);
                      }
                  });
              };
              
              if (socket.connected) {
                  doClaim();
              } else {
                  console.log('[Welcome] Socket disconnected, waiting to reconnect before claiming setup...');
                  socket.connect();
                  socket.once('connect', doClaim);
              }
          } else {
              // If disconnected entirely, just navigate and let next page handle errors
              navigate(contextPath);
          }
        }
      };

      socket.on('setup_status', handleStatus);
      socket.on('setup_claimed', handleClaimed);
      socket.on('setup_released', handleReleased);
      socket.on('setup_completed', handleSetupCompleted);

      return () => {
        socket.off('setup_status', handleStatus);
        socket.off('setup_claimed', handleClaimed);
        socket.off('setup_released', handleReleased);
        socket.off('setup_completed', handleSetupCompleted);
      };
    }
  }, [isConnected, socket, tableToken, navigate]);

  const handleContinue = async () => {
    // Defense-in-depth: do not let the user proceed until the initial
    // geofence + restaurant validation has completed. The loading gate
    // already prevents this button from rendering during pending, but
    // guard here anyway for fast-click / race cases.
    if (initialValidationPending) return;
    setChecking(true);
    setStatus('Connecting...');

    firePublic({
      event_type: 'welcome_continue_clicked',
      event_data: {
        restaurant_slug: activeRestaurantSlug,
        table_token: tableToken
      }
    });
    
    try {
      // 1. Check for existing credentials (active or backup from dual mode)
      const stored = getStoredParticipant();
      const dualStored = getDualSession(tableToken);
      
      console.log("[Welcome] Stored Creds:", stored);
      console.log("[Welcome] Dual Backup:", dualStored);

      // Use active token first, fallback to backup token if we just "started fresh" but want to resume
      const deviceToken = stored.participantToken || dualStored?.participantToken;
      
      console.log("[Welcome] Using Device Token:", deviceToken);

      // 2. Resolve Session State
      const resolveRes = await resolveSession({ 
          table_token: tableToken, 
          device_token: deviceToken,
          restaurant_slug: activeRestaurantSlug
      });
      
      const { action, session_id, participant_id, participant_token, mode, reason, role } = resolveRes.data;
      console.log('[Welcome] Resolution Action:', action);

      if (action === 'blocked_active_session') {
          setStatus(null);
          // Show fine UI popup instead of alert
          setBlockedError("You have an active Dual session at another table. Wait for your partner to leave, or return to your original table.");
          return;
      }

      if (action === 'resume') {
          setStatus('Resuming session...');
          // Restore credentials if we used backup token
          if (!stored.participantToken && deviceToken) {
              console.log('[Welcome] Restoring backup credentials to session storage');
              storeParticipant(participant_id, session_id, deviceToken);
          }
          // Navigate to game directly
          navigate(`/session/${session_id}/game`);
          return;
      }

      if (action === 'join_dual' || action === 'reclaim_dual') {
          setStatus('Joining partner...');
          console.log(`[Welcome] Auto-joining dual session (${action}):`, session_id);
          // Auto-join waiting session (Phone B joins Phone A) or Reclaim spot
          const joinRes = await joinDualSession({ 
              session_id,
              reclaim_role: action === 'reclaim_dual' ? role : undefined,
              restaurant_slug: activeRestaurantSlug
          });
          const { 
              participant_id: newPid, 
              participant_token: newToken, 
              session_id: newSid 
          } = joinRes.data;

          // Store credentials
          storeParticipant(newPid, newSid, newToken);
          // Store backup for this new session
          storeDualSession(tableToken, newSid, newPid, newToken);
          
          navigate(`/session/${newSid}/game`);
          return;
      }

      if (action === 'start_new') {
          // If we resolved to "Start New", it means we should go to context selection
          // NEW LOGIC: Check Setup Lock
          setStatus('Checking availability...');
          
          const claimPromise = new Promise((resolve) => {
              if (socket) {
                  const doClaim = () => {
                      const existingLock = sessionStorage.getItem(`table_lock_${tableToken}`);
                      socket.emit('claim_setup', { tableToken, lockToken: existingLock }, (response) => {
                          if (response.status === 'granted') {
                              sessionStorage.setItem(`table_lock_${tableToken}`, response.lockToken);
                          }
                          resolve(response);
                      });
                  };
                  
                  if (socket.connected) {
                      doClaim();
                  } else {
                      console.log('[Welcome] Socket not connected, waiting for connection before claim...');
                      socket.connect();
                      socket.once('connect', doClaim);
                  }
                  // Timeout fallback
                  setTimeout(() => resolve({ status: 'timeout' }), 4000);
              } else {
                  resolve({ status: 'offline' }); 
              }
          });
          
          const claimRes = await claimPromise;
          console.log('[Welcome] Claim result:', claimRes);
          
          if (claimRes.status === 'granted') {
              setStatus('Ready to start');
              navigate(contextPath);
          } else if (claimRes.status === 'offline') {
              // Show error, don't bypass lock
              alert("Connection issue. Please wait and try again.");
              setStatus(null);
          } else {
              // Busy or timeout
              setWaitingForA(true);
              setStatus(null);
          }
          return;
      }

    } catch (err) {
      console.error('Resolution error:', err);
      // Fallback: Start New Flow
      navigate(contextPath);
    } finally {
      setChecking(false);
    }
  };

  // Subscription Error: Service Suspended
  if (subscriptionError === 'suspended') {
    return (
      <div className="min-h-screen bg-[#F3EDE1] flex flex-col items-center justify-center p-6 text-center relative overflow-hidden">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', duration: 0.8 }}
          className="max-w-md w-full bg-white/70 border border-[#35332E]/10 rounded-3xl p-8 md:p-10 shadow-xl relative z-10"
        >
          <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 text-4xl bg-[#35332E]/10">🛠️</div>
          <h1 className="text-3xl font-bold tracking-tight text-[#35332E] mb-4 leading-tight">
            Service Temporarily Unavailable
          </h1>
          <p className="text-[#6E6A60] text-base leading-relaxed mb-8">
            This restaurant's subscription is inactive or suspended. Please contact the restaurant or try again later.
          </p>
          <Button onClick={() => navigate('/')} variant="outline" fullWidth className="border-[#35332E]/20 text-[#35332E] hover:bg-[#35332E]/5">
            Go Home
          </Button>
        </motion.div>
      </div>
    );
  }

  // Geofence Denied: split into two UX paths —
  //  A) geolocation permission permanently DENIED → "Enable Location" only (no bypass).
  //  B) GPS unavailable / permission prompt / coarse coords → allow 5-minute temp access.
  if (subscriptionError === 'geofence_denied') {
    const geoStatusDenied =
      geofenceInfo?.geolocation_status === 'denied' ||
      geoPermissionState === 'denied' ||
      geofenceInfo?.action_required === 'enable_location_permission';
    // Show the NEW temporary-access CTA when:
    //   - permission is NOT permanently denied, AND
    //   - either the restaurant has no registered coords / phone has no GPS fix
    //     (requires_geolocation=true), OR permission still prompt/unsupported.
    // The LEGACY "low accuracy device" bypass is preserved for the specific
    // case where an actual GPS coarse fix exists and placed the device >2km
    // away (real OUTSIDE_RADIUS reading, not a permission/no-fix issue).
    const allowTempAccessButton =
      !geoStatusDenied &&
      (
        geofenceInfo?.requires_geolocation === true ||
        geofenceInfo?.temp_access_possible === true ||
        (geoPermissionState && geoPermissionState !== 'granted') ||
        geofenceInfo?.geolocation_status === 'prompt' ||
        geofenceInfo?.geolocation_status === 'unsupported' ||
        lastLocationAccuracyM == null
      );

    return (
      <div className="min-h-screen bg-[#F3EDE1] flex flex-col items-center justify-center p-6 text-center relative overflow-hidden">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', duration: 0.8 }}
          className="max-w-md w-full bg-white/70 border border-[#35332E]/10 rounded-3xl p-8 md:p-10 shadow-xl relative z-10"
        >
          <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 text-4xl bg-[#35332E]/10">
            📍
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-[#35332E] mb-4 leading-tight">
            {geoStatusDenied ? 'Location permission is required' : 'Please visit us in person'}
          </h1>
          <p className="text-[#6E6A60] text-base leading-relaxed mb-4">
            {geoStatusDenied ? (
              <>
                This table works only at{' '}
                <span className="text-[#35332E] font-semibold">
                  {geofenceInfo?.restaurant_name || 'the restaurant'}
                </span>
                . Please allow location access for this site in your browser settings.
              </>
            ) : (
              <>
                This table works only at{' '}
                <span className="text-[#35332E] font-semibold">
                  {geofenceInfo?.restaurant_name || 'the restaurant'}
                </span>
                .
              </>
            )}
          </p>
          {geoStatusDenied && (
            <div className="rounded-2xl bg-[#FBF7EF] border border-[#DCD3C2] text-sm text-left text-[#35332E] p-4 mb-6">
              <p className="text-[#6E6A60] text-xs uppercase tracking-[0.18em] mb-2">Enable Location</p>
              <ol className="space-y-1 text-[13px] leading-relaxed list-decimal list-inside">
                <li>Tap the lock or info icon in your browser address bar.</li>
                <li>Find &ldquo;Location&rdquo; and choose &ldquo;Allow&rdquo;.</li>
                <li>Tap &ldquo;Check again&rdquo; below once enabled.</li>
              </ol>
            </div>
          )}
          {!geoStatusDenied && geofenceInfo?.distance_m != null && (
            <div className="rounded-2xl bg-[#FBF7EF] border border-[#DCD3C2] text-sm text-[#35332E] p-4 mb-6">
              <div className="flex items-center justify-between">
                <span className="text-[#6E6A60] text-xs uppercase tracking-[0.18em]">You are</span>
                <span className="font-semibold">
                  ~{Math.round(geofenceInfo.distance_m)} m away
                </span>
              </div>
              <div className="flex items-center justify-between pt-2">
                <span className="text-[#6E6A60] text-xs uppercase tracking-[0.18em]">Table area</span>
                <span>
                  {geofenceInfo.configured_radius_m} m radius
                </span>
              </div>
              {geofenceInfo.radius_overridden && (
                <div className="mt-2 text-[11px] text-[#926B1A]">
                  Dev mode detected — effective radius {geofenceInfo.effective_radius_m}m
                </div>
              )}
            </div>
          )}
          <div className="space-y-3">
            <Button onClick={retryGeolocationCheck} variant="ink" fullWidth className="shadow-lg">
              {checking ? 'Checking location...' : 'Check again / Allow Location'}
            </Button>
            <Button onClick={() => navigate('/')} variant="outline" fullWidth className="border-[#35332E]/20 text-[#35332E] hover:bg-[#35332E]/5">
              Scan Again / Home
            </Button>
            {allowTempAccessButton && (
              <Button
                onClick={requestTemporaryGeoAccess}
                disabled={tempAccessLoading || checking}
                variant="ghost"
                fullWidth
                className="border border-[#926B1A]/30 text-[#926B1A] hover:bg-[#926B1A]/10 hover:text-[#825e17]"
              >
                {tempAccessLoading ? 'Requesting temporary access...' : 'Temporarily Use (5 minutes)'}
              </Button>
            )}
            {(() => {
              // Legacy low-accuracy bypass: only visible when an actual GPS
              // coarse fix placed the user far away (not a permission/no-GPS
              // issue). This keeps the pre-existing path for users with
              // genuinely broken GPS chips while the temp-access path above
              // becomes the canonical "no GPS/permission prompt" flow.
              if (geoStatusDenied) return null;
              if (allowTempAccessButton) return null;
              const suggestHigh = geofenceInfo?.suggest_high_accuracy === true;
              const gpsUpgradeFailed = geofenceInfo?.gps_upgrade_failed === true || gpsUpgradeAttemptedRef.current === true;
              const badAccuracy = lastLocationAccuracyM == null ? false : lastLocationAccuracyM > 200;
              const distKmLarge = typeof geofenceInfo?.distance_m === 'number' && geofenceInfo.distance_m > 2000;
              const devGraceStillOutside =
                geofenceInfo?.radius_overridden === true &&
                typeof geofenceInfo?.distance_m === 'number' &&
                typeof geofenceInfo?.effective_radius_m === 'number' &&
                geofenceInfo.distance_m > geofenceInfo.effective_radius_m;
              const devGraceMassiveDist =
                devGraceStillOutside && typeof geofenceInfo?.distance_m === 'number' && geofenceInfo.distance_m > 2000;
              const shouldShow =
                (suggestHigh && (gpsUpgradeFailed || badAccuracy || distKmLarge)) ||
                devGraceMassiveDist;
              if (!shouldShow) return null;
              return (
                <Button
                  onClick={attemptLowAccuracyBypass}
                  variant="ghost"
                  fullWidth
                  className="border border-[#926B1A]/30 text-[#926B1A] hover:bg-[#926B1A]/10 hover:text-[#825e17]"
                >
                  Temporarily use anyway (low accuracy device)
                </Button>
              );
            })()}
          </div>
        </motion.div>
      </div>
    );
  }

  // Subscription Error: Invalid / Unregistered
  if (subscriptionError === 'invalid') {
    return (
      <div className="min-h-screen bg-[#F3EDE1] flex flex-col items-center justify-center p-6 text-center relative overflow-hidden">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', duration: 0.8 }}
          className="max-w-md w-full bg-white/70 border border-[#35332E]/10 rounded-3xl p-8 md:p-10 shadow-xl relative z-10"
        >
          <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 text-4xl bg-[#35332E]/10">⚠️</div>
          <h1 className="text-3xl font-bold tracking-tight text-[#35332E] mb-4 leading-tight">
            Invalid QR Code
          </h1>
          <p className="text-[#6E6A60] text-base leading-relaxed mb-8">
            This QR code is invalid, expired, or the table is not registered with any active restaurant. Please scan a valid QR code.
          </p>
          <Button onClick={() => navigate('/')} variant="ink" fullWidth className="shadow-lg">
            Scan Again / Home
          </Button>
        </motion.div>
      </div>
    );
  }

  // Waiting UI for Phone B
  if (waitingForA) {
    return (
      <div className="min-h-screen bg-[#F3EDE1] flex flex-col items-center justify-center p-6 text-center relative overflow-hidden">
        <div className="relative z-10">
          <div className="w-20 h-20 bg-[#FBF7EF] rounded-full flex items-center justify-center mb-6 shadow-[inset_0_2px_6px_rgba(53,51,46,0.08)] relative mx-auto">
            <div className="absolute inset-0 border-4 border-[#35332E] rounded-full border-t-transparent animate-spin opacity-60"></div>
            <img src="/catalyst-logo.png" alt="" className="w-10 h-10 object-contain relative z-10" draggable={false} />
          </div>

          <h2 className="text-2xl font-bold text-[#35332E] mb-4 tracking-tight">
            Waiting for Partner
          </h2>
          <p className="text-[#6E6A60] max-w-xs mx-auto mb-10 leading-relaxed">
            Partner will select Context and Mode to start session.
          </p>

          <div className="space-y-4">
            <div className="flex justify-center gap-2">
              <span className="w-2 h-2 bg-[#35332E]/70 rounded-full animate-bounce" style={{ animationDelay: '0s' }}></span>
              <span className="w-2 h-2 bg-[#35332E]/70 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></span>
              <span className="w-2 h-2 bg-[#35332E]/70 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></span>
            </div>

            <button
               onClick={() => setWaitingForA(false)}
               className="text-sm font-semibold text-[#6E6A60] hover:text-[#35332E] transition-colors uppercase tracking-widest mt-8"
            >
               Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Loading gate: show spinner until first-pass geofence + restaurant
  // handshake completes (success OR error). The Welcome content (including
  // the Continue button) never renders before validation is resolved so the
  // user cannot click-through and create a session before geofence rejects.
  if ((initialValidationPending && !subscriptionError) || status) {
    const spinnerText = status || 'Checking restaurant & location…';
    return (
      <div className="min-h-screen bg-[#F3EDE1] flex flex-col items-center justify-center p-6">
        <div className="text-center">
          <div className="w-20 h-20 bg-[#FBF7EF] rounded-full flex items-center justify-center mb-6 shadow-[inset_0_2px_6px_rgba(53,51,46,0.08)] relative mx-auto">
            <div className="absolute inset-0 border-4 border-[#35332E] rounded-full border-t-transparent animate-spin opacity-60"></div>
            <img src="/catalyst-logo.png" alt="" className="w-10 h-10 object-contain relative z-10" draggable={false} />
          </div>
          <p className="text-[#6E6A60] font-medium">{spinnerText}</p>
        </div>
      </div>
    );
  }

  // Otherwise, show the Welcome Screen
  return (
    <div className="min-h-screen bg-[#F3EDE1] flex flex-col items-center justify-center p-6 relative overflow-hidden selection:bg-[#35332E]/10 selection:text-[#35332E]">

      {/* Blocked Error Modal */}
      <AnimatePresence>
        {blockedError && (
          <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-[#35332E]/60 backdrop-blur-sm"
              onClick={() => {
                  setBlockedError(null);
                  navigate('/');
              }}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="relative bg-[#F3EDE1] w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden p-6 border border-[#35332E]/10"
            >
              <div className="flex items-center gap-2 mb-4">
                <svg className="w-5 h-5 text-[#35332E]" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                </svg>
                <span className="text-[#35332E] font-semibold text-sm tracking-wide">
                  Catalyst
                </span>
              </div>

              <p className="text-[#35332E] text-[15px] leading-relaxed mb-6">
                {blockedError}
              </p>

              <div className="w-full bg-[#35332E]/10 h-1 rounded-full overflow-hidden mb-6">
                  <motion.div
                    initial={{ width: "0%" }}
                    animate={{ width: "100%" }}
                    transition={{ duration: 3, ease: "linear" }}
                    className="h-full bg-[#35332E]"
                  />
              </div>

              <div className="flex justify-end">
                <button
                  onClick={() => {
                      setBlockedError(null);
                      navigate('/');
                  }}
                  className="bg-[#35332E] hover:bg-[#26241F] text-[#F3EDE1] font-semibold px-6 py-2 rounded-xl shadow-md transition-colors"
                >
                  OK
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.7, ease: "easeOut" }}
        className="max-w-md w-full text-center relative z-10"
      >
        {/* Temporary Geolocation Access Banner */}
        <AnimatePresence>
          {tempAccessBanner?.expires_at_unix && (
            <motion.div
              initial={{ opacity: 0, y: -8, height: 0 }}
              animate={{ opacity: 1, y: 0, height: 'auto' }}
              exit={{ opacity: 0, y: -8, height: 0 }}
              transition={{ duration: 0.3 }}
              className="mb-6 overflow-hidden"
            >
              <TempAccessBanner banner={tempAccessBanner} onExpire={() => {
                clearTempGeoAccessToken();
                setTempAccessBanner(null);
                setSubscriptionError('geofence_denied');
              }} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Droplet Logo */}
        <div className="mb-12">
          <motion.div
            initial={{ scale: 0.85, opacity: 0, y: 10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            transition={{ delay: 0.1, duration: 0.7, type: "spring" }}
            className="w-36 h-36 mx-auto flex items-center justify-center"
          >
            <img src="/catalyst-logo.png" alt="Catalyst" className="w-full h-full object-contain drop-shadow-lg" />
          </motion.div>
        </div>

        {/* Heading Hierarchy */}
        <div className="space-y-3 mb-8">
          <h1 className="text-4xl md:text-5xl font-bold text-[#35332E] tracking-tight leading-[1.05]">
            Welcome to
          </h1>
          <h1 className="text-5xl md:text-6xl font-bold text-[#35332E] tracking-tight leading-[1.05]">
            Catalyst
          </h1>
          <p className="text-lg md:text-xl text-[#35332E] font-medium italic mt-4">
            Starts a conversation. Gets out of your way.
          </p>
        </div>

        {/* Body Copy */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25, duration: 0.6 }}
          className="space-y-6"
        >
          <p className="text-[17px] text-[#35332E] leading-relaxed">
            Catalyst offers questions for two people. Explore new topics together … and stay curious.
          </p>
          <p className="text-base text-[#6E6A60] leading-relaxed">
            Stay as long as the food takes. Or stop anytime.
          </p>
        </motion.div>

        {/* Continue CTA */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.5 }}
          className="pt-12"
        >
          <Button
            onClick={handleContinue}
            disabled={checking}
            variant="ink"
            size="xl"
            fullWidth
            className="shadow-xl shadow-[#35332E]/10 hover:shadow-2xl hover:shadow-[#35332E]/15 transition-all text-lg"
            icon={!checking && <span className="group-hover:translate-x-1 transition-transform">→</span>}
          >
            {checking ? 'Connecting...' : 'Continue'}
          </Button>

          <p className="mt-10 text-xs text-[#6E6A60] tracking-[0.2em] uppercase font-medium">
            Anonymous Session · No Data Stored
          </p>
        </motion.div>
      </motion.div>
    </div>
  );
}
