import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { createSession } from '../api';
import Button from '../components/ui/Button';

export default function LandingPage() {
  const { tableId } = useParams();
  const navigate = useNavigate();
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const initSession = async () => {
      if (!tableId) {
        setError('No table ID provided');
        setLoading(false);
        return;
      }

      try {
        const response = await createSession(tableId);
        const { session_id, mode } = response.data;
        
        sessionStorage.setItem('session_id', session_id);
        
        navigate(`/session/${session_id}/mode`);
      } catch (err) {
        console.error(err);
        setError('Failed to start session. Please try scanning again.');
      } finally {
        setLoading(false);
      }
    };

    initSession();
  }, [tableId, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto mb-4"></div>
          <p className="text-gray-600">Connecting to Table {tableId}...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="bg-white p-6 rounded-lg shadow-md max-w-sm w-full text-center">
          <div className="text-red-500 text-4xl mb-4">⚠️</div>
          <h1 className="text-xl font-bold mb-2">Error</h1>
          <p className="text-gray-600 mb-4">{error}</p>
          <Button 
            onClick={() => window.location.reload()}
            variant="black"
            fullWidth
          >
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return null;
}
