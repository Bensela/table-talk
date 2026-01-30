import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import QRScanner from '../components/QRScanner';
import Button from '../components/ui/Button';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';

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
      let tableId = decodedText;
      if (decodedText.includes('/t/')) {
        const parts = decodedText.split('/t/');
        if (parts.length > 1) {
          tableId = parts[1].replace(/\/$/, '');
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
    <div className="min-h-screen bg-white font-sans text-gray-900 selection:bg-blue-100 selection:text-blue-900 flex flex-col">
      <Navbar />

      <main className="flex-1 pt-32 pb-16 flex flex-col justify-center">
        {/* HERO SECTION - Compact & Centered */}
        <section className="px-6 max-w-4xl mx-auto w-full text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <span className="inline-block px-4 py-1.5 rounded-full bg-blue-50 text-blue-600 text-xs font-bold tracking-wide uppercase mb-8 border border-blue-100">
              Table-Talk MVP 1.2
            </span>
            <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight leading-[1.1] mb-6">
              Connect Deeper <br/>
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-purple-600">
                At The Table
              </span>
            </h1>
            <p className="text-xl text-gray-500 leading-relaxed max-w-xl mx-auto mb-12">
              Scan the QR code at your table to unlock curated conversation starters designed for meaningful connection.
            </p>
          </motion.div>

          <motion.div
            id="scan"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="flex flex-col items-center gap-6 scroll-mt-32"
          >
            <Button
              onClick={() => setShowScanner(true)}
              variant="black"
              size="xl"
              icon={<span className="text-xl">📷</span>}
              className="shadow-xl shadow-gray-200 hover:shadow-2xl transition-all px-12 py-5 text-lg"
            >
              Scan QR Code
            </Button>

            {/* Manual Entry Fallback - Compact */}
            <form onSubmit={handleManualJoin} className="relative w-full max-w-xs group">
              <input
                type="text"
                placeholder="Or enter table code..."
                value={tableInput}
                onChange={(e) => setTableInput(e.target.value)}
                className="w-full pl-4 pr-16 py-3 bg-transparent border-b-2 border-gray-200 focus:border-black rounded-none outline-none transition-all text-center placeholder:text-gray-300 focus:placeholder:text-gray-400"
              />
              <button
                type="submit"
                disabled={!tableInput.trim()}
                className="absolute right-0 top-0 bottom-0 text-sm font-bold uppercase text-gray-400 hover:text-black disabled:opacity-0 transition-all"
              >
                Join
              </button>
            </form>
          </motion.div>

          {/* Mini How-It-Works Row */}
          <motion.div 
            id="how-it-works"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6 }}
            className="mt-20 pt-12 border-t border-gray-100 grid grid-cols-3 gap-4 text-center scroll-mt-32"
          >
             <div className="space-y-2">
               <div className="text-2xl">📷</div>
               <div className="text-xs font-bold uppercase tracking-widest text-gray-400">Scan</div>
             </div>
             <div className="space-y-2">
               <div className="text-2xl">🌱</div>
               <div className="text-xs font-bold uppercase tracking-widest text-gray-400">Pick Context</div>
             </div>
             <div className="space-y-2">
               <div className="text-2xl">💬</div>
               <div className="text-xs font-bold uppercase tracking-widest text-gray-400">Talk</div>
             </div>
          </motion.div>

        </section>
      </main>

      <div id="about">
        <Footer />
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
