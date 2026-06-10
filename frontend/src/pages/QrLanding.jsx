import { useState, useEffect } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { publicHandshake } from '../api';
import Button from '../components/ui/Button';

export default function QrLanding() {
  const { restaurantSlug } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  const queryParams = new URLSearchParams(location.search);
  const tableParam = queryParams.get('table');

  const [loading, setLoading] = useState(true);
  const [errorState, setErrorState] = useState(null); // 'suspended' | 'invalid'
  const [restaurantName, setRestaurantName] = useState('');

  useEffect(() => {
    async function performHandshake() {
      if (!restaurantSlug || !tableParam) {
        setErrorState('invalid');
        setLoading(false);
        return;
      }

      const startTime = Date.now();

      try {
        const response = await publicHandshake(restaurantSlug, tableParam);
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

        setTimeout(() => {
          if (err.response && err.response.status === 403) {
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
            Setting up your table...
          </h2>
          <p className="text-slate-400 text-sm max-w-xs mx-auto leading-relaxed">
            Verifying secure session configurations.
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
