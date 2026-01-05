import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Landing from './pages/Landing';
import ModeSelection from './pages/ModeSelection';
import QuestionLoop from './pages/QuestionLoop';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/session/:sessionId/mode" element={<ModeSelection />} />
        <Route path="/session/:sessionId/play" element={<QuestionLoop />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}

export default App;
