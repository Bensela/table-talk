import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import Button from '../components/ui/Button';

export default function LegacyQrBlocked() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6 relative overflow-hidden font-sans">
      <div className="absolute top-[-20%] left-[-10%] w-[420px] h-[420px] bg-rose-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[420px] h-[420px] bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.45 }}
        className="relative z-10 w-full max-w-lg rounded-[32px] border border-slate-800 bg-slate-900/80 backdrop-blur-xl p-8 shadow-2xl text-center"
      >
        <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-3xl border border-rose-500/20 bg-rose-500/10 text-4xl">
          QR
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight text-white mb-4">
          Legacy QR Code No Longer Supported
        </h1>
        <p className="text-slate-400 leading-7 mb-4">
          Catalyst now uses tenant-specific QR codes for each subscribed restaurant and table.
          Older direct QR codes cannot open the app anymore.
        </p>
        <p className="text-slate-500 text-sm leading-6 mb-8">
          Please scan the new QR code generated from the restaurant dashboard so the app can identify
          the correct restaurant and validate the table.
        </p>

        <Button
          onClick={() => navigate('/')}
          variant="primary"
          fullWidth
          className="shadow-xl shadow-cyan-500/20"
        >
          Return To Scanner
        </Button>
      </motion.div>
    </div>
  );
}
