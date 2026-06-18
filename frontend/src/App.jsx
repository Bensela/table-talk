import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import ModeSelection from './pages/ModeSelection';
import SessionGame from './pages/SessionGame';
import Home from './pages/Home';
import WelcomeScreen from './pages/WelcomeScreen';
import ContextSelection from './pages/ContextSelection';
import Login from './pages/Login';
import SuperAdminDashboard from './pages/SuperAdminDashboard';
import RestaurantAdminDashboard from './pages/RestaurantAdminDashboard';
import RestaurantSubscriptionPage from './pages/RestaurantSubscriptionPage';
import LegacyQrBlocked from './pages/LegacyQrBlocked';
import { SocketProvider } from './context/SocketContext';

function App() {
  return (
    <SocketProvider>
      <BrowserRouter>
        <Routes>
          {/* Admin routes */}
          <Route path="/admin/login" element={<Login />} />
          <Route path="/admin" element={<SuperAdminDashboard />} />
          <Route path="/dashboard" element={<RestaurantAdminDashboard />} />
          <Route path="/subscribe/:token" element={<RestaurantSubscriptionPage />} />

          {/* QR code routes → WelcomeScreen handles all validation */}
          <Route path="/r/:restaurantSlug/t/:tableToken" element={<WelcomeScreen />} />
          <Route path="/r/:restaurantSlug/t/:tableToken/context" element={<ContextSelection />} />
          <Route path="/r/:restaurantSlug/t/:tableToken/mode" element={<ModeSelection />} />

          {/* Legacy QR routes are intentionally blocked in multi-tenant mode */}
          <Route path="/t/:tableToken" element={<LegacyQrBlocked />} />
          <Route path="/t/:tableToken/context" element={<LegacyQrBlocked />} />
          <Route path="/t/:tableToken/mode" element={<LegacyQrBlocked />} />
          <Route path="/table:legacyTableToken" element={<LegacyQrBlocked />} />
          
          {/* Active Session */}
          <Route path="/session/:sessionId/game" element={<SessionGame />} />
          
          {/* Legacy/Dev routes */}
          <Route path="/session/:sessionId/mode" element={<ModeSelection />} /> {/* Keep for backward compat if needed */}
          <Route path="/" element={<Home />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </BrowserRouter>
    </SocketProvider>
  );
}

export default App;
