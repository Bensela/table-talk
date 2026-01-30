import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import ModeSelection from './pages/ModeSelection';
import SessionGame from './pages/SessionGame';
import Home from './pages/Home';
import WelcomeScreen from './pages/WelcomeScreen';
import ContextSelection from './pages/ContextSelection';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Entry point from QR code */}
        <Route path="/t/:tableToken" element={<WelcomeScreen />} />
        
        {/* Flow steps */}
        <Route path="/t/:tableToken/context" element={<ContextSelection />} />
        <Route path="/t/:tableToken/mode" element={<ModeSelection />} />
        
        {/* Active Session */}
        <Route path="/session/:sessionId/game" element={<SessionGame />} />
        
        {/* Legacy/Dev routes */}
        <Route path="/session/:sessionId/mode" element={<ModeSelection />} /> {/* Keep for backward compat if needed */}
        <Route path="/" element={<Home />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
