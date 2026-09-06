import { useState, useEffect, useRef } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { publicHandshake, requestTempGeoAccess, clearTempGeoAccessToken, TEMP_GEO_EXPIRED_EVENT } from '../api';
import Button from '../components/ui/Button';
import { requestCurrentPositionWithFallback, requestHighAccuracyPosition, readGeolocationPermissionState } from '../utils/geolocation';
import useAnalytics from '../hooks/useAnalytics';

export default function QrLanding() {
  const { restaurantSlug } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { firePublic } = useAnalytics();

  const queryParams = new URLSearchParams(location.search);
  const tableParam = queryParams.get('table');

  const [loading, setLoading] = useState(true);
  const [loadingText, setLoadingText] = useState('Setting up your table...');
  const [errorState, setErrorState] = useState(null); // 'suspended' | 'invalid' | 'geofence_denied'
  const [geofenceInfo, setGeofenceInfo] = useState(null);
  const [restaurantName, setRestaurantName] = useState('');
  const [lastLocationAccuracyM, setLastLocationAccuracyM] = useState(null);
  const [geoPermissionState, setGeoPermissionState] = useState(null);
  const [tempAccessLoading, setTempAccessLoading] = useState(false);
  const startedRef = useRef(false);
  const gpsUpgradeAttemptedRef = useRef(false);

  /**
   * Attempt the low-accuracy bypass handshake. Called when the end-user
   * taps "Temporarily allow anyway" on a device (typically a desktop) whose
   * GPS chip is missing or wildly inaccurate so the 24.8km 100m-radius
   * false-positive block is otherwise unrecoverable.
   */
  async function attemptLowAccuracyBypass() {
    setLoading(true);
    setLoadingText('Connecting with reduced location accuracy...');
    firePublic({
      event_type: 'qr_landing_low_accuracy_bypass_attempt',
      event_data: {
        restaurant_slug: restaurantSlug,
        table_token: tableParam,
        distance_m: geofenceInfo?.distance_m ?? null,
        configured_radius_m: geofenceInfo?.configured_radius_m ?? null,
        last_accuracy_m: lastLocationAccuracyM,
        gps_upgrade_attempted: gpsUpgradeAttemptedRef.current === true
      }
    });

    let locationPayload = null;
    let geolocationStatus = 'prompt';

    // Reuse any prior position we already have. The backend gates the
    // bypass on the computed distance threshold rather than the presence
    // of coordinates, so if we have *no* position we still pass and
    // rely on the backend REQUIRES_GEOLOCATION fallback path.
    const fallback = await requestCurrentPositionWithFallback({
      acceptIfWithinMeters: 1000,
      dedupeKey: `qrlanding-bypass:${restaurantSlug || 'any'}:${tableParam || 'any'}`
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
      const response = await publicHandshake(restaurantSlug, tableParam, {
        location: locationPayload,
        geolocationStatus,
        bypass: 'low_accuracy_device'
      });
      const { restaurant_name, session_token } = response.data;
      localStorage.setItem('restaurant_slug', restaurantSlug);
      localStorage.setItem('table_token', tableParam);
      localStorage.setItem('handshake_token', session_token);
      sessionStorage.setItem('restaurant_slug', restaurantSlug);
      setRestaurantName(restaurant_name);
      firePublic({
        event_type: 'qr_landing_low_accuracy_bypass_passed',
        event_data: {
          restaurant_slug: restaurantSlug,
          table_token: tableParam,
          distance_m: geofenceInfo?.distance_m ?? null,
          configured_radius_m: geofenceInfo?.configured_radius_m ?? null,
          low_accuracy_bypass_granted: response.data.geofence?.low_accuracy_bypass_granted === true,
          radius_overridden: response.data.geofence?.radius_overridden === true
        }
      });
      window.setTimeout(() => navigate(`/r/${restaurantSlug}/t/${tableParam}`), 250);
    } catch (err) {
      setLoading(false);
      const code = err?.response?.data?.geofence_code;
      if (err?.response?.status === 403 && code === 'LOCATION_PERMISSION_DENIED') {
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
        setErrorState('geofence_denied');
        return;
      }
      if (err?.response?.status === 403 && code === 'OUTSIDE_RADIUS') {
        // Bypass denied (probably distance is legitimately close rather
        // than the 20km+ false-positive scenario, so the backend refused
        // the bypass to keep real production geo-gating strict).
        setGeofenceInfo({
          distance_m: err.response.data.distance_m,
          configured_radius_m: err.response.data.configured_radius_m,
          restaurant_name: err.response.data.restaurant_name || '',
          suggest_high_accuracy: err.response.data.suggest_high_accuracy === true,
          bypass_denied: true,
          geolocation_status: err.response.data.geolocation_status || null,
          requires_geolocation: err.response.data.requires_geolocation === true,
          temp_access_possible: err.response.data.temp_access_possible === true
        });
        firePublic({
          event_type: 'qr_landing_low_accuracy_bypass_denied',
          event_data: {
            restaurant_slug: restaurantSlug,
            table_token: tableParam,
            distance_m: err.response.data.distance_m,
            configured_radius_m: err.response.data.configured_radius_m
          }
        });
        setErrorState('geofence_denied');
        return;
      }
      if (err?.response?.status === 403) {
        setErrorState('suspended');
      } else {
        setErrorState('invalid');
      }
    }
  }

  /**
   * Request a 5-minute temporary geolocation access window. Mirrors
   * WelcomeScreen behavior — denies permanent-denied users, otherwise
   * issues a scoped token and navigates to the Welcome route.
   */
  async function requestTemporaryGeoAccess() {
    setTempAccessLoading(true);
    setLoading(true);
    setLoadingText('Requesting temporary access...');
    firePublic({
      event_type: 'qr_landing_temp_geo_access_request',
      event_data: {
        restaurant_slug: restaurantSlug,
        table_token: tableParam
      }
    });
    let locationPayload = null;
    let geolocationStatus = 'prompt';
    try {
      const [permission, positionResult] = await Promise.all([
        readGeolocationPermissionState(),
        requestCurrentPositionWithFallback({
          acceptIfWithinMeters: 1000,
          dedupeKey: `qrlanding-tempgeo:${restaurantSlug || 'any'}:${tableParam || 'any'}`
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

    const result = await requestTempGeoAccess(restaurantSlug, tableParam, {
      location: locationPayload,
      geolocationStatus
    });

    setTempAccessLoading(false);

    if (result.temp_access_granted === true && result.temp_access_token) {
      firePublic({
        event_type: 'qr_landing_temp_geo_access_granted',
        event_data: {
          restaurant_slug: restaurantSlug,
          table_token: tableParam,
          ttl_seconds: result.ttl_seconds || 300
        }
      });
      // Navigate to Welcome screen; handshake there will inherit the
      // temp token from sessionStorage via the axios interceptor.
      setLoading(false);
      navigate(`/r/${restaurantSlug}/t/${tableParam}`);
      return;
    }

    setLoading(false);
    if (result.geolocation_status === 'denied' || result.action_required === 'enable_location_permission') {
      setGeoPermissionState('denied');
      setGeofenceInfo({
        restaurant_name: geofenceInfo?.restaurant_name || restaurantSlug || '',
        geolocation_status: 'denied',
        action_required: result.action_required || 'enable_location_permission',
        temp_access_possible: false,
        error: result.error || null
      });
      setErrorState('geofence_denied');
      firePublic({
        event_type: 'qr_landing_temp_geo_access_denied',
        event_data: {
          restaurant_slug: restaurantSlug,
          table_token: tableParam,
          reason: 'location_permission_denied'
        }
      });
      return;
    }

    firePublic({
      event_type: 'qr_landing_temp_geo_access_denied',
      event_data: {
        restaurant_slug: restaurantSlug,
        table_token: tableParam,
        error: result.error || 'unknown'
      }
    });
  }

  /**
   * Upgrade a prior coarse location to GPS high-accuracy and re-run the
   * handshake. Returns true when the upgraded handshake let the user in
   * (the caller should stop rendering the geofence block). Returns false
   * if GPS either failed or still returned OUTSIDE_RADIUS (block shown).
   */
  async function upgradeToGpsAndRetryHandshake({ context = 'auto' } = {}) {
    setLoadingText('Refining location with GPS...');
    firePublic({
      event_type: 'qr_landing_geolocation_gps_upgrade',
      event_data: {
        restaurant_slug: restaurantSlug,
        table_token: tableParam,
        context
      }
    });

    const gps = await requestHighAccuracyPosition({
      dedupeKey: `qrlanding-gps:${restaurantSlug || 'any'}:${tableParam || 'any'}:${context}`
    });

    if (gps.ok && gps.coords && typeof gps.coords.accuracy === 'number') {
      setLastLocationAccuracyM(gps.coords.accuracy);
    }

    if (!gps.ok || !gps.coords) {
      firePublic({
        event_type: 'qr_landing_geolocation_gps_upgrade_failed',
        event_data: {
          restaurant_slug: restaurantSlug,
          table_token: tableParam,
          context,
          status: gps.status,
          error: gps.error || null
        }
      });
      return false;
    }

    const locationPayload = {
      latitude: gps.coords.latitude,
      longitude: gps.coords.longitude
    };

    try {
      const response = await publicHandshake(restaurantSlug, tableParam, {
        location: locationPayload,
        geolocationStatus: 'granted'
      });
      const { restaurant_name, session_token } = response.data;
      localStorage.setItem('restaurant_slug', restaurantSlug);
      localStorage.setItem('table_token', tableParam);
      localStorage.setItem('handshake_token', session_token);
      sessionStorage.setItem('restaurant_slug', restaurantSlug);
      setRestaurantName(restaurant_name);
      firePublic({
        event_type: 'qr_landing_geolocation_gps_upgrade_passed',
        event_data: {
          restaurant_slug: restaurantSlug,
          table_token: tableParam,
          context,
          accuracy_m: gps.coords.accuracy ?? null
        }
      });
      window.setTimeout(() => navigate(`/r/${restaurantSlug}/t/${tableParam}`), 400);
      return true;
    } catch (err2) {
      firePublic({
        event_type: 'qr_landing_geolocation_gps_upgrade_still_outside',
        event_data: {
          restaurant_slug: restaurantSlug,
          table_token: tableParam,
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
          gps_upgrade_failed: true,
          geolocation_status: err2.response.data.geolocation_status || null,
          requires_geolocation: err2.response.data.requires_geolocation === true,
          temp_access_possible: err2.response.data.temp_access_possible === true
        });
      }
      return false;
    }
  }

  useEffect(() => {
    let cancelled = false;
    readGeolocationPermissionState()
      .then((s) => { if (!cancelled) setGeoPermissionState(s || 'prompt'); })
      .catch(() => { if (!cancelled) setGeoPermissionState('unsupported'); });
    function onTempGeoExpired() { clearTempGeoAccessToken(); }
    if (typeof window !== 'undefined') {
      window.addEventListener(TEMP_GEO_EXPIRED_EVENT, onTempGeoExpired);
    }
    return () => {
      cancelled = true;
      if (typeof window !== 'undefined') {
        window.removeEventListener(TEMP_GEO_EXPIRED_EVENT, onTempGeoExpired);
      }
    };
  }, [restaurantSlug, tableParam]);

  useEffect(() => {
    if (startedRef.current || !restaurantSlug || !tableParam) {
      if (!restaurantSlug || !tableParam) {
        setErrorState('invalid');
        setLoading(false);
      }
      return;
    }
    startedRef.current = true;

    async function performHandshake() {
      const startTime = Date.now();

      try {
        // Phase 1 — best-effort two-stage geolocation request.
        // Coarse first (fast, low battery), upgraded to high-accuracy only if
        // the returned fix is worse than ~250m. Permission reads run in
        // parallel so we know how to tag geolocation_status in analytics.
        setLoadingText('Checking location permission...');
        const permissionPromise = readGeolocationPermissionState();
        const positionPromise = requestCurrentPositionWithFallback({
          acceptIfWithinMeters: 250,
          dedupeKey: `qrlanding:${restaurantSlug || 'any'}:${tableParam || 'any'}`
        });

        const [permission, positionResult] = await Promise.all([permissionPromise, positionPromise]);
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
          event_type: 'qr_landing_geolocation_request',
          event_data: {
            restaurant_slug: restaurantSlug,
            table_token: tableParam,
            permission_state: permission,
            position_status: positionResult.status,
            accuracy_m: positionResult.coords?.accuracy ?? null
          }
        });

        setLoadingText('Verifying your table...');

        // Phase 2 — public handshake with optional geolocation envelope.
        const response = await publicHandshake(restaurantSlug, tableParam, {
          location: locationPayload,
          geolocationStatus
        });
        const { restaurant_name, session_token } = response.data;

        // Save session identifiers to localStorage
        localStorage.setItem('restaurant_slug', restaurantSlug);
        localStorage.setItem('table_token', tableParam);
        localStorage.setItem('handshake_token', session_token);

        // Keep session storage synced for existing logic compatibility
        sessionStorage.setItem('restaurant_slug', restaurantSlug);

        setRestaurantName(restaurant_name);

        // Ensure loader displays for a minimum time (e.g. 500ms) for smooth UX transition
        const elapsed = Date.now() - startTime;
        const delay = Math.max(500 - elapsed, 0);

        setTimeout(() => {
          navigate(`/r/${restaurantSlug}/t/${tableParam}`);
        }, delay);

      } catch (err) {
        console.error('Handshake verification failed:', err);
        const elapsed = Date.now() - startTime;
        const delay = Math.max(500 - elapsed, 0);

        // Auto-recovery path: when the backend says the distance is wildly
        // outside the radius (typical of IP/cell tower coarse fixes)
        // upgrade the position once with true GPS before failing closed.
        const isOutsideRadius =
          err?.response?.status === 403 &&
          err?.response?.data?.geofence_code === 'OUTSIDE_RADIUS';
        const shouldAutoUpgrade =
          isOutsideRadius &&
          !gpsUpgradeAttemptedRef.current &&
          (err?.response?.data?.suggest_high_accuracy === true);

        if (shouldAutoUpgrade) {
          gpsUpgradeAttemptedRef.current = true;
          firePublic({
            event_type: 'qr_landing_geofence_suggested_upgrade',
            event_data: {
              restaurant_slug: restaurantSlug,
              table_token: tableParam,
              distance_m: err.response.data.distance_m,
              configured_radius_m: err.response.data.configured_radius_m
            }
          });
          const upgraded = await upgradeToGpsAndRetryHandshake({ context: 'auto-from-handshake' });
          if (upgraded) return; // navigated inside the helper
          // GPS still outside → continue to show geofence_denied block
          // with the updated distance from the upgraded call (already
          // saved into geofenceInfo by the helper).
          setLoading(false);
          setErrorState('geofence_denied');
          return;
        }

        setTimeout(() => {
          if (err.response?.status === 403) {
            if (err.response.data && err.response.data.geofence_code === 'LOCATION_PERMISSION_DENIED') {
              setGeoPermissionState('denied');
              setErrorState('geofence_denied');
              setGeofenceInfo({
                restaurant_name: err.response.data.restaurant_name || '',
                geolocation_status: 'denied',
                action_required: err.response.data.action_required || 'enable_location_permission',
                distance_m: err.response.data.distance_m,
                configured_radius_m: err.response.data.configured_radius_m,
                effective_radius_m: err.response.data.effective_radius_m,
                temp_access_possible: false
              });
              setLoading(false);
              return;
            }
            if (err.response.data && err.response.data.geofence_code === 'OUTSIDE_RADIUS') {
              setErrorState('geofence_denied');
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
              firePublic({
                event_type: 'qr_landing_geofence_denied',
                event_data: {
                  restaurant_slug: restaurantSlug,
                  table_token: tableParam,
                  distance_m: err.response.data.distance_m,
                  configured_radius_m: err.response.data.configured_radius_m,
                  geolocation_status: err.response.data.geolocation_status || null,
                  requires_geolocation: err.response.data.requires_geolocation === true
                }
              });
              setLoading(false);
              return;
            }
            setErrorState('suspended');
          } else {
            setErrorState('invalid');
          }
          setLoading(false);
        }, delay);
      }
    }

    performHandshake();
  }, [restaurantSlug, tableParam, navigate]);

  // Retry handler: attempt another geolocation read + handshake. Used when
  // the user moves closer to the restaurant or toggles location permission
  // on their device. Starts with GPS high-accuracy directly since this is
  // the explicit "Check again" action from the geofence block screen.
  const retryWithGeolocation = async () => {
    setLoading(true);
    setLoadingText('Checking with GPS location...');
    setErrorState(null);

    // Auto-try a GPS upgrade first; if the user is actually at the
    // restaurant, a proper GPS fix clears the false-positive immediately.
    const autoUpgraded = await upgradeToGpsAndRetryHandshake({ context: 'retry-button' });
    if (autoUpgraded) return;

    // Fall back to a coarse lookup if GPS returned nothing usable (user
    // denied GPS permission specifically, or chip is unavailable).
    try {
      const result = await requestCurrentPositionWithFallback({
        acceptIfWithinMeters: 200,
        dedupeKey: `qrlanding-retry:${restaurantSlug || 'any'}:${tableParam || 'any'}`
      });
      const locationPayload = result.ok && result.coords
        ? { latitude: result.coords.latitude, longitude: result.coords.longitude }
        : null;
      const geolocationStatus = result.ok ? 'granted' : result.status;

      setLoadingText('Verifying your table...');
      const response = await publicHandshake(restaurantSlug, tableParam, {
        location: locationPayload,
        geolocationStatus
      });
      const { session_token, restaurant_name } = response.data;

      localStorage.setItem('restaurant_slug', restaurantSlug);
      localStorage.setItem('table_token', tableParam);
      localStorage.setItem('handshake_token', session_token);
      sessionStorage.setItem('restaurant_slug', restaurantSlug);

      setRestaurantName(restaurant_name);
      navigate(`/r/${restaurantSlug}/t/${tableParam}`);
    } catch (err) {
      setLoading(false);
      if (err.response?.status === 403 && err.response.data?.geofence_code === 'LOCATION_PERMISSION_DENIED') {
        setGeoPermissionState('denied');
        setErrorState('geofence_denied');
        setGeofenceInfo({
          restaurant_name: err.response.data.restaurant_name || '',
          geolocation_status: 'denied',
          action_required: err.response.data.action_required || 'enable_location_permission',
          distance_m: err.response.data.distance_m,
          configured_radius_m: err.response.data.configured_radius_m,
          effective_radius_m: err.response.data.effective_radius_m,
          temp_access_possible: false
        });
        return;
      }
      if (err.response?.status === 403 && err.response.data?.geofence_code === 'OUTSIDE_RADIUS') {
        // Even on explicit retry: if we haven't yet tried a true-GPS upgrade
        // and the distance is wildly off, give it one shot before failing.
        if (!gpsUpgradeAttemptedRef.current && err.response.data?.suggest_high_accuracy === true) {
          gpsUpgradeAttemptedRef.current = true;
          setLoading(true);
          const secondPass = await upgradeToGpsAndRetryHandshake({ context: 'retry-after-coarse' });
          if (secondPass) return;
        }

        setErrorState('geofence_denied');
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
        return;
      }
      if (err.response?.status === 403) {
        setErrorState('suspended');
      } else {
        setErrorState('invalid');
      }
    }
  };

  // Loading/Welcome Bouncer State
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-center relative overflow-hidden font-sans">
        {/* Animated ambient backgrounds */}
        <div className="absolute top-[-10%] left-[-10%] w-[400px] h-[400px] bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[400px] h-[400px] bg-violet-600/10 rounded-full blur-3xl pointer-events-none" />

        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="relative z-10 space-y-6"
        >
          <div className="w-20 h-20 bg-gradient-to-tr from-cyan-400 to-violet-500 rounded-3xl mx-auto flex items-center justify-center shadow-xl shadow-cyan-500/10 relative">
            <span className="text-4xl animate-pulse">💬</span>
            <div className="absolute inset-0 rounded-3xl border border-cyan-400/30 animate-ping opacity-75" />
          </div>
          
          <h2 className="text-2xl font-bold text-slate-100 tracking-tight">
            {loadingText}
          </h2>
          <p className="text-slate-400 text-sm max-w-xs mx-auto leading-relaxed">
            {locationPayloadInProgressHint(loadingText)}
          </p>

          <div className="flex justify-center gap-1.5 pt-4">
            <span className="w-2.5 h-2.5 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: '0s' }}></span>
            <span className="w-2.5 h-2.5 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: '0.15s' }}></span>
            <span className="w-2.5 h-2.5 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: '0.3s' }}></span>
          </div>
        </motion.div>
      </div>
    );
  }

  // GEOFENCE_DENIED: user is outside the restaurant radius or geo permission denied
  if (errorState === 'geofence_denied') {
    const geoStatusDenied =
      geofenceInfo?.geolocation_status === 'denied' ||
      geoPermissionState === 'denied' ||
      geofenceInfo?.action_required === 'enable_location_permission';

    const infoRequiresGeo = geofenceInfo?.requires_geolocation === true;
    const infoTempPossible = geofenceInfo?.temp_access_possible === true;
    const geoPermPrompt = geoPermissionState === 'prompt' || geoPermissionState === 'unsupported' || geoPermissionState == null;
    const infoGeoPrompt = geofenceInfo?.geolocation_status === 'prompt' || geofenceInfo?.geolocation_status === 'unsupported' || geofenceInfo?.geolocation_status == null;
    const noAccuracyReading = lastLocationAccuracyM == null;

    const allowTempAccessButton =
      !geoStatusDenied &&
      (infoRequiresGeo || infoTempPossible || geoPermPrompt || infoGeoPrompt || noAccuracyReading);

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
    const shouldShowLowAcc =
      !geoStatusDenied &&
      !allowTempAccessButton &&
      ((suggestHigh && (gpsUpgradeFailed || badAccuracy || distKmLarge)) || devGraceMassiveDist);

    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-center relative overflow-hidden font-sans">
        <div className="absolute top-[-20%] left-[-20%] w-[500px] h-[500px] bg-amber-500/5 rounded-full blur-3xl pointer-events-none" />

        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', duration: 0.8 }}
          className="max-w-md w-full backdrop-blur-xl bg-slate-900/60 border border-slate-800/80 rounded-3xl p-8 md:p-10 shadow-2xl relative z-10"
        >
          <div className="w-20 h-20 bg-amber-500/10 border border-amber-500/20 rounded-full flex items-center justify-center mx-auto mb-6 text-4xl">
            📍
          </div>

          {geoStatusDenied ? (
            <>
              <h1 className="text-3xl font-extrabold text-slate-100 mb-4 tracking-tight leading-tight">
                Location permission required
              </h1>
              <p className="text-slate-400 text-base leading-relaxed mb-6">
                This table works only at{' '}
                <span className="text-slate-200 font-medium">
                  {geofenceInfo?.restaurant_name || 'the restaurant'}
                </span>
                . Location services must be enabled to verify you are at the table.
              </p>
              <div className="rounded-2xl bg-amber-500/5 border border-amber-500/20 text-left p-4 mb-6">
                <p className="text-amber-300 text-sm font-semibold mb-3 tracking-wide uppercase">Enable Location</p>
                <ol className="text-slate-400 text-sm space-y-2 pl-5 list-decimal marker:text-amber-400">
                  <li className="pl-1">Tap the lock icon in your browser address bar</li>
                  <li className="pl-1">Find the Location permission setting</li>
                  <li className="pl-1">Choose <span className="text-slate-200 font-medium">Allow</span>, then tap Check again below</li>
                </ol>
              </div>
            </>
          ) : (
            <>
              <h1 className="text-3xl font-extrabold text-slate-100 mb-4 tracking-tight leading-tight">
                Please visit us in person
              </h1>
              <p className="text-slate-400 text-base leading-relaxed mb-4">
                This table works only at{' '}
                <span className="text-slate-200 font-medium">
                  {geofenceInfo?.restaurant_name || 'the restaurant'}
                </span>
                .
              </p>
              {geofenceInfo?.distance_m != null && (
                <div className="rounded-2xl bg-slate-950/60 border border-slate-800 text-sm text-slate-300 p-3 mb-6">
                  <div className="flex items-center justify-between px-2">
                    <span className="text-slate-500 text-xs uppercase tracking-[0.18em]">You are</span>
                    <span className="text-slate-200 font-semibold">
                      ~{Math.round(geofenceInfo.distance_m)} m away
                    </span>
                  </div>
                  <div className="flex items-center justify-between px-2 pt-1">
                    <span className="text-slate-500 text-xs uppercase tracking-[0.18em]">Table area</span>
                    <span className="text-slate-300">
                      {geofenceInfo.configured_radius_m} m radius
                    </span>
                  </div>
                  {geofenceInfo.radius_overridden && (
                    <div className="mt-2 px-2 text-[11px] text-amber-300/80">
                      Dev mode detected — effective radius {geofenceInfo.effective_radius_m}m
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          <div className="space-y-3">
            <Button
              onClick={retryWithGeolocation}
              variant="primary"
              fullWidth
              disabled={tempAccessLoading}
              className="bg-cyan-500 hover:bg-cyan-600 text-white shadow-lg shadow-cyan-500/20 disabled:opacity-50"
            >
              Check again / Allow Location
            </Button>
            <Button
              onClick={() => navigate('/')}
              variant="outline"
              fullWidth
              disabled={tempAccessLoading}
              className="border-slate-800 text-slate-300 hover:bg-slate-800 disabled:opacity-50"
            >
              Go Back Home
            </Button>
            {allowTempAccessButton && !geoStatusDenied && (
              <Button
                onClick={requestTemporaryGeoAccess}
                variant="ghost"
                fullWidth
                loading={tempAccessLoading}
                disabled={tempAccessLoading}
                className="border border-amber-500/20 text-amber-300 hover:bg-amber-500/10 hover:text-amber-200 disabled:opacity-50"
              >
                {tempAccessLoading ? 'Requesting access…' : 'Temporarily Use (5 minutes)'}
              </Button>
            )}
            {shouldShowLowAcc && (
              <Button
                onClick={attemptLowAccuracyBypass}
                variant="ghost"
                fullWidth
                disabled={tempAccessLoading}
                className="border border-amber-500/20 text-amber-300 hover:bg-amber-500/10 hover:text-amber-200 disabled:opacity-50"
              >
                Temporarily use anyway (low accuracy device)
              </Button>
            )}
          </div>
        </motion.div>
      </div>
    );
  }

  // SUSPENDED BILLING: friendly maintenance fallback screen
  if (errorState === 'suspended') {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-center relative overflow-hidden font-sans">
        <div className="absolute top-[-20%] left-[-20%] w-[500px] h-[500px] bg-amber-500/5 rounded-full blur-3xl pointer-events-none" />
        
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', duration: 0.8 }}
          className="max-w-md w-full backdrop-blur-xl bg-slate-900/60 border border-slate-800/80 rounded-3xl p-8 md:p-10 shadow-2xl relative z-10"
        >
          <div className="w-20 h-20 bg-amber-500/10 border border-amber-500/20 rounded-full flex items-center justify-center mx-auto mb-6 text-4xl">
            🛠️
          </div>
          
          <h1 className="text-3xl font-extrabold text-slate-100 mb-4 tracking-tight leading-tight">
            Undergoing Maintenance
          </h1>
          
          <p className="text-slate-400 text-base leading-relaxed mb-8">
            This table's conversation service is undergoing temporary maintenance. Please check back shortly or let a member of our staff know!
          </p>

          <Button 
            onClick={() => navigate('/')}
            variant="outline"
            fullWidth
            className="border-slate-800 text-slate-300 hover:bg-slate-800"
          >
            Go Back Home
          </Button>
        </motion.div>
      </div>
    );
  }

  // INVALID SLUG/404: Invalid QR Code state
  if (errorState === 'invalid') {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-center relative overflow-hidden font-sans">
        <div className="absolute top-[-20%] left-[-20%] w-[500px] h-[500px] bg-rose-500/5 rounded-full blur-3xl pointer-events-none" />

        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', duration: 0.8 }}
          className="max-w-md w-full backdrop-blur-xl bg-slate-900/60 border border-slate-800/80 rounded-3xl p-8 md:p-10 shadow-2xl relative z-10"
        >
          <div className="w-20 h-20 bg-rose-500/10 border border-rose-500/20 rounded-full flex items-center justify-center mx-auto mb-6 text-4xl">
            ⚠️
          </div>

          <h1 className="text-3xl font-extrabold text-slate-100 mb-4 tracking-tight leading-tight">
            Invalid QR Code
          </h1>

          <p className="text-slate-400 text-base leading-relaxed mb-8">
            The QR code you scanned is invalid, expired, or belongs to an unregistered table. Please try scanning the code again.
          </p>

          <Button 
            onClick={() => navigate('/')}
            variant="primary"
            fullWidth
            className="bg-rose-500 hover:bg-rose-600 text-white shadow-lg shadow-rose-500/20"
          >
            Scan Again / Home
          </Button>
        </motion.div>
      </div>
    );
  }

  return null;
}

function locationPayloadInProgressHint(text) {
  if (/location/i.test(text)) {
    return 'We only use location to confirm you are at the restaurant table.';
  }
  return 'Verifying secure session configurations.';
}
