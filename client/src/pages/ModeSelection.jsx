import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getSession, updateSessionMode } from '../api';

export default function ModeSelection() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [currentMode, setCurrentMode] = useState(null);

  useEffect(() => {
    const checkSession = async () => {
      try {
        const { data } = await getSession(sessionId);
        if (data.mode) {
          setCurrentMode(data.mode);
          // Redirect to game immediately if mode is already set
          navigate(`/session/${sessionId}/game`);
        }
      } catch (err) {
        console.error(err);
      }
    };
    checkSession();
  }, [sessionId, navigate]);

  const handleSelectMode = async (mode) => {
    setLoading(true);
    try {
      await updateSessionMode(sessionId, mode);
      navigate(`/session/${sessionId}/game`);
    } catch (err) {
      console.error(err);
      alert('Failed to update mode');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 p-6">
      <header className="mb-8 mt-4">
        <h1 className="text-3xl font-bold text-gray-900">Table-Talk</h1>
        <p className="text-gray-600 mt-2">Choose your experience</p>
      </header>

      <main className="flex-1 flex flex-col gap-4 max-w-md mx-auto w-full">
        <button
          onClick={() => handleSelectMode('single')}
          disabled={loading}
          className="group relative bg-white p-6 rounded-2xl shadow-sm border-2 border-transparent hover:border-black transition-all text-left"
        >
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xl font-bold">Single-Phone Mode</h2>
            <span className="text-2xl">📱</span>
          </div>
          <p className="text-gray-600 text-sm">
            Pass one phone around the table. Simple and easy.
          </p>
        </button>

        <button
          onClick={() => handleSelectMode('dual')}
          disabled={loading}
          className="group relative bg-white p-6 rounded-2xl shadow-sm border-2 border-transparent hover:border-black transition-all text-left"
        >
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xl font-bold">Dual-Phone Mode</h2>
            <span className="text-2xl">📱⚡📱</span>
          </div>
          <p className="text-gray-600 text-sm">
            Sync two phones for a coordinated experience.
          </p>
        </button>
      </main>
      
      {loading && (
        <div className="fixed inset-0 bg-black/20 flex items-center justify-center">
           <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
        </div>
      )}
    </div>
  );
}
