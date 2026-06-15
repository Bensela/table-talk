// useAuth.js — React hook for admin authentication guard
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export function useAdminAuth() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);

  useEffect(() => {
    const storedToken = localStorage.getItem('adminToken');
    const storedUser = localStorage.getItem('adminUser');

    if (!storedToken) {
      navigate('/admin/login', { replace: true });
      return;
    }

    let parsedUser = null;
    try {
      parsedUser = storedUser ? JSON.parse(storedUser) : null;
    } catch {
      parsedUser = null;
    }

    setToken(storedToken);
    setUser(parsedUser);
    setChecking(false);
  }, [navigate]);

  const logout = () => {
    localStorage.removeItem('adminToken');
    localStorage.removeItem('adminUser');
    navigate('/admin/login', { replace: true });
  };

  return { checking, token, user, logout };
}

export function getAdminHeaders() {
  const token = localStorage.getItem('adminToken');
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  };
}
