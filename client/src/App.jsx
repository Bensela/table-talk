import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import LandingPage from './pages/LandingPage';
import ModeSelection from './pages/ModeSelection';
import SessionGame from './pages/SessionGame';
import Home from './pages/Home';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/t/:tableId" element={<LandingPage />} />
        <Route path="/session/:sessionId/mode" element={<ModeSelection />} />
        <Route path="/session/:sessionId/game" element={<SessionGame />} />
        <Route path="/" element={<Home />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
