// useAuth.js — React hook for SA/RA admin authentication guard
import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  getAdminToken,
  getAdminTokenInfo,
  clearAdminAuth as clearAdminAuthStorage,
  setAdminAuth as setAdminAuthStorage,
  AUTH_EXPIRED_EVENT
} from '../api';

const LOGIN_PATH = '/admin/login';

function loginPathWithReturn(returnTo) {
  try {
    const base = returnTo && typeof returnTo === 'string' && returnTo.length > 0
      ? returnTo
      : (typeof window !== 'undefined' ? window.location.pathname + window.location.search + window.location.hash : '/admin');
    if (base.startsWith(LOGIN_PATH)) return LOGIN_PATH;
    const params = new URLSearchParams();
    params.set('returnTo', base);
    return `${LOGIN_PATH}?${params.toString()}`;
  } catch {
    return LOGIN_PATH;
  }
}

export function useAdminAuth() {
  const navigate = useNavigate();
  const location = useLocation();
  const [checking, setChecking] = useState(true);
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [authError, setAuthError] = useState(null);
  const expiryTimerRef = useRef(null);
  const pollIntervalRef = useRef(null);
  const mountedRef = useRef(true);

  const clearAndRedirect = useCallback((reason) => {
    if (!mountedRef.current) return;
    clearAdminAuthStorage(reason || 'TOKEN_REVOKED');
    setToken(null);
    setUser(null);
    setChecking(true);
    const currentPath = location.pathname + location.search + location.hash;
    const target = loginPathWithReturn(currentPath);
    navigate(target, { replace: true });
  }, [navigate, location]);

  const applyValidSession = useCallback((storedToken, parsedUser) => {
    const info = getAdminTokenInfo(storedToken);
    if (!info.valid || info.needsRefresh) {
      return false;
    }
    if (!parsedUser) return false;
    // Ensure user role claim matches token role (anti-tamper check)
    if (info.payload.role && parsedUser.role && String(info.payload.role) !== String(parsedUser.role)) {
      return false;
    }
    setToken(storedToken);
    setUser(parsedUser);
    setAuthError(null);

    // Schedule a precise timer to trigger redirect at exact expiry time
    if (expiryTimerRef.current) {
      clearTimeout(expiryTimerRef.current);
      expiryTimerRef.current = null;
    }
    if (info.expiresAtMs) {
      const fireInMs = Math.max(0, info.expiresAtMs - Date.now());
      expiryTimerRef.current = setTimeout(() => {
        clearAndRedirect('TOKEN_EXPIRED');
      }, fireInMs + 250); // fire just after expiry
    }
    return true;
  }, [clearAndRedirect]);

  // Initial mount + recheck whenever location or storage changes
  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;

    function runCheck() {
      if (cancelled) return;
      const storedToken = getAdminToken();
      const rawUser = localStorage.getItem('adminUser');
      let parsedUser = null;
      try {
        parsedUser = rawUser ? JSON.parse(rawUser) : null;
      } catch {
        parsedUser = null;
      }

      if (!storedToken) {
        clearAndRedirect('TOKEN_REQUIRED');
        return;
      }

      const applied = applyValidSession(storedToken, parsedUser);
      if (!applied) {
        clearAndRedirect('TOKEN_INVALID');
        return;
      }
      setChecking(false);
    }

    runCheck();

    // Passive poll every 2 minutes — catches expiry even if timer drifted
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    pollIntervalRef.current = setInterval(runCheck, 2 * 60 * 1000);

    // Listen for auth-expired events from the apiFetch/axios interceptors
    function handleAuthExpired() {
      clearAndRedirect('TOKEN_EXPIRED_INTERCEPT');
    }
    window.addEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);

    // React to storage events (logout / auth cleared in another tab)
    function handleStorageChange(event) {
      if (event.key === 'adminToken' || event.key === 'adminUser') {
        runCheck();
      }
    }
    window.addEventListener('storage', handleStorageChange);

    return () => {
      cancelled = true;
      mountedRef.current = false;
      window.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
      window.removeEventListener('storage', handleStorageChange);
      if (expiryTimerRef.current) clearTimeout(expiryTimerRef.current);
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [applyValidSession, clearAndRedirect]);

  const logout = useCallback(() => {
    clearAndRedirect('USER_LOGOUT');
  }, [clearAndRedirect]);

  return { checking, token, user, logout, authError };
}

export function getAdminHeaders() {
  const token = getAdminToken();
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  };
}

export { setAdminAuthStorage as setAdminAuth, clearAdminAuthStorage as clearAdminAuth };
