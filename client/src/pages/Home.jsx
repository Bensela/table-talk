import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import QRScanner from '../components/QRScanner';

export default function Home() {
  const navigate = useNavigate();
  const [tableInput, setTableInput] = useState('');
  const [showScanner, setShowScanner] = useState(false);

  const handleManualJoin = (e) => {
    e.preventDefault();
    if (tableInput.trim()) {
      navigate(`/t/${tableInput.trim()}`);
    }
  };

  const handleScanSuccess = (decodedText) => {
    try {
      // Handle URL format: https://tabletalk.app/t/123 or just 123
      let tableId = decodedText;
      if (decodedText.includes('/t/')) {
        const parts = decodedText.split('/t/');
        if (parts.length > 1) {
          tableId = parts[1].replace(/\/$/, ''); // Remove trailing slash if any
        }
      }
      
      if (tableId) {
        setShowScanner(false);
        navigate(`/t/${tableId}`);
      }
    } catch (e) {
      console.error("Invalid QR format", e);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6">
      <div className="max-w-md w-full text-center space-y-8">
        {/* Hero Section */}
        <div className="space-y-4">
          <div className="w-20 h-20 bg-black rounded-2xl mx-auto flex items-center justify-center shadow-xl rotate-3">
            <span className="text-4xl">💬</span>
          </div>
          <h1 className="text-4xl font-bold text-gray-900 tracking-tight">
            Table-Talk
          </h1>
          <p className="text-lg text-gray-600 leading-relaxed">
            Meaningful conversations, served fresh at your table.
          </p>
        </div>

        {/* Actions Card */}
        <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100">
          <h2 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4">
            Start a Conversation
          </h2>
          
          <button
            onClick={() => setShowScanner(true)}
            className="w-full bg-black text-white font-bold py-4 rounded-xl hover:bg-gray-800 transition-all flex items-center justify-center gap-2 mb-6 shadow-lg shadow-gray-200"
          >
            <span className="text-xl">📷</span>
            Scan QR Code
          </button>

          <div className="relative mb-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-200"></div>
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-white px-2 text-gray-400">Or enter manually</span>
            </div>
          </div>
          
          <form onSubmit={handleManualJoin} className="space-y-4">
            <div>
              <label htmlFor="table-id" className="sr-only">Table ID</label>
              <input
                id="table-id"
                type="text"
                placeholder="Enter Table ID (e.g. 123)"
                value={tableInput}
                onChange={(e) => setTableInput(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-black focus:ring-1 focus:ring-black outline-none transition-all text-center text-lg placeholder:text-gray-300"
              />
            </div>
            <button
              type="submit"
              disabled={!tableInput.trim()}
              className="w-full bg-gray-100 text-gray-900 font-bold py-3 rounded-xl hover:bg-gray-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Join Table
            </button>
          </form>
        </div>

        {/* Features / How it works */}
        <div className="grid grid-cols-2 gap-4 text-left">
          <div className="p-4 bg-white rounded-2xl border border-gray-100">
            <span className="text-2xl mb-2 block">📱</span>
            <h3 className="font-bold text-sm">Single Mode</h3>
            <p className="text-xs text-gray-500 mt-1">Pass one phone around the table.</p>
          </div>
          <div className="p-4 bg-white rounded-2xl border border-gray-100">
            <span className="text-2xl mb-2 block">⚡</span>
            <h3 className="font-bold text-sm">Dual Sync</h3>
            <p className="text-xs text-gray-500 mt-1">Connect two phones for real-time magic.</p>
          </div>
        </div>
      </div>

      {/* Scanner Overlay */}
      {showScanner && (
        <QRScanner 
          onScan={handleScanSuccess} 
          onClose={() => setShowScanner(false)}
        />
      )}
    </div>
  );
}
