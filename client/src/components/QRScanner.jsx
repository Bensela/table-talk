import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';

const playScanSound = () => {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.type = 'sine';
    osc.frequency.setValueAtTime(1000, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(500, ctx.currentTime + 0.1);
    
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);

    osc.start();
    osc.stop(ctx.currentTime + 0.1);
  } catch (e) {
    console.error("Audio playback failed", e);
  }
};

export default function QRScanner({ onScan, onClose, onError }) {
  const [error, setError] = useState(null);
  const [isPaused, setIsPaused] = useState(false);
  const [cameras, setCameras] = useState([]);
  const [currentCameraId, setCurrentCameraId] = useState(null);
  const [isFlashOn, setIsFlashOn] = useState(false); // Note: Html5Qrcode support for flash is limited in some browsers
  
  const scannerRef = useRef(null);
  const scannerContainerId = "qr-reader";
  const timeoutRef = useRef(null);

  // Initialize and get cameras
  useEffect(() => {
    let mounted = true;

    const init = async () => {
      try {
        // Get cameras
        const devices = await Html5Qrcode.getCameras();
        if (mounted) {
          setCameras(devices);
          if (devices && devices.length > 0) {
            // Prefer back camera if possible, usually the last one or one labeled 'back'
            const backCamera = devices.find(d => d.label.toLowerCase().includes('back')) || devices[devices.length - 1];
            setCurrentCameraId(backCamera.id);
          } else {
             setError("No cameras found.");
          }
        }
      } catch (err) {
        console.error("Error getting cameras", err);
        if (mounted) setError("Failed to access camera devices.");
      }
    };

    init();

    return () => {
      mounted = false;
    };
  }, []);

  // Start scanning when camera ID is set
  useEffect(() => {
    if (!currentCameraId) return;

    const scanner = new Html5Qrcode(scannerContainerId);
    scannerRef.current = scanner;

    const config = {
      fps: 30,
      qrbox: { width: 250, height: 250 },
      aspectRatio: 1.0,
      formatsToSupport: [ Html5QrcodeSupportedFormats.QR_CODE ]
    };

    const startScanning = async () => {
      try {
        await scanner.start(
          currentCameraId,
          config,
          (decodedText) => {
            // Success
            if (navigator.vibrate) navigator.vibrate(50);
            playScanSound();
            resetTimeout();
            onScan(decodedText);
          },
          (errorMessage) => {
            // Ignore parse errors
          }
        );
        resetTimeout();
      } catch (err) {
        console.error("Failed to start scanner", err);
        setError("Failed to start camera stream.");
      }
    };

    startScanning();

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (scanner.isScanning) {
        scanner.stop().catch(console.error);
      }
    };
  }, [currentCameraId, onScan]);

  const resetTimeout = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      handleStop();
      // Only show error if we haven't already closed
      // if (onError) onError("Scanner timed out"); 
    }, 30000);
  };

  const handleStop = async () => {
    if (scannerRef.current && scannerRef.current.isScanning) {
      try {
        await scannerRef.current.stop();
        setIsPaused(true);
      } catch (err) {
        console.error("Failed to stop scanner", err);
      }
    }
  };

  const handleSwitchCamera = () => {
    if (cameras.length < 2) return;
    
    // Find next camera index
    const currentIndex = cameras.findIndex(c => c.id === currentCameraId);
    const nextIndex = (currentIndex + 1) % cameras.length;
    setCurrentCameraId(cameras[nextIndex].id);
  };

  return (
    <div className="fixed inset-0 bg-black/90 z-50 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-3xl overflow-hidden shadow-2xl relative flex flex-col">
        {/* Header */}
        <div className="bg-black text-white p-4 flex justify-between items-center z-10">
          <h3 className="font-bold text-lg">Scan QR Code</h3>
          <button 
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-800 hover:bg-gray-700 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Scanner Area */}
        <div className="relative bg-black h-[400px] flex items-center justify-center overflow-hidden">
          {!error && !isPaused && (
             <div id={scannerContainerId} className="w-full h-full"></div>
          )}
          
          {/* Custom Overlay (Optional - to make it look cooler than default) */}
          {!error && !isPaused && (
            <div className="absolute inset-0 pointer-events-none border-[30px] border-black/50">
               <div className="w-full h-full border-2 border-white/50 relative">
                  <div className="absolute top-0 left-0 w-4 h-4 border-t-4 border-l-4 border-white"></div>
                  <div className="absolute top-0 right-0 w-4 h-4 border-t-4 border-r-4 border-white"></div>
                  <div className="absolute bottom-0 left-0 w-4 h-4 border-b-4 border-l-4 border-white"></div>
                  <div className="absolute bottom-0 right-0 w-4 h-4 border-b-4 border-r-4 border-white"></div>
                  {/* Scan line animation */}
                  <div className="absolute top-0 left-0 w-full h-0.5 bg-red-500 animate-[scan_2s_infinite]"></div>
               </div>
            </div>
          )}

          {error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center z-20">
              <span className="text-4xl mb-4">🚫</span>
              <p className="text-white font-medium mb-2">{error}</p>
              <button onClick={() => window.location.reload()} className="mt-4 px-4 py-2 bg-white text-black rounded-full text-sm">
                Retry
              </button>
            </div>
          )}

           {isPaused && !error && (
             <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 text-white z-20">
               <p className="mb-4">Scanner Paused</p>
               <button onClick={() => window.location.reload()} className="bg-white text-black px-6 py-2 rounded-full text-sm font-bold">
                 Resume
               </button>
             </div>
           )}
           
           {/* Camera Controls */}
           <div className="absolute bottom-4 left-0 w-full flex justify-center gap-4 z-20">
             {cameras.length > 1 && (
               <button 
                 onClick={handleSwitchCamera}
                 className="w-10 h-10 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center text-white hover:bg-white/30 transition-all"
                 title="Switch Camera"
               >
                 🔄
               </button>
             )}
           </div>
        </div>

        {/* Footer */}
        <div className="p-4 bg-gray-50 text-center">
           <p className="text-sm text-gray-600">
             Point camera at a Table-Talk QR code
           </p>
        </div>
      </div>
      
      <style>{`
        @keyframes scan {
          0% { top: 0; opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { top: 100%; opacity: 0; }
        }
      `}</style>
    </div>
  );
}
