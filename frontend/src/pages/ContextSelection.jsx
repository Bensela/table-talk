import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import SelectionCard from '../components/ui/SelectionCard';

export default function ContextSelection() {
  const { tableToken } = useParams();
  const navigate = useNavigate();

  const handleSelectContext = (context) => {
    navigate(`/t/${tableToken}/mode`, { state: { context } });
  };

  const contexts = [
    {
      id: 'Exploring',
      title: 'Exploring',
      icon: '🌱',
      color: 'bg-blue-50 text-blue-600',
      description: 'A personal connection - new or existing - oriented toward discovery'
    },
    {
      id: 'Established',
      title: 'Established',
      icon: '💑',
      color: 'bg-purple-50 text-purple-600',
      description: 'An ongoing, committed romantic relationship'
    }
  ];

  const container = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1
      }
    }
  };

  const item = {
    hidden: { opacity: 0, y: 20 },
    show: { opacity: 1, y: 0 }
  };

  return (
    <div className="min-h-screen bg-white flex flex-col p-6 relative overflow-hidden font-sans selection:bg-blue-100 selection:text-blue-900">
      
      {/* Background Ambience */}
      <div className="absolute top-[-20%] right-[-20%] w-[500px] h-[500px] bg-blue-50/60 rounded-full blur-3xl pointer-events-none opacity-60" />
      <div className="absolute bottom-[-20%] left-[-20%] w-[500px] h-[500px] bg-purple-50/60 rounded-full blur-3xl pointer-events-none opacity-60" />

      <header className="mb-12 mt-8 text-center relative z-10 max-w-md mx-auto">
        <motion.div 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="inline-flex items-center justify-center gap-2 px-3 py-1 bg-gray-50 rounded-full border border-gray-100 mb-6"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></span>
          <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Step 1 of 2</span>
        </motion.div>
        
        <motion.h1 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="text-4xl font-extrabold text-gray-900 tracking-tight mb-4"
        >
          Choose Context
        </motion.h1>
        
        <motion.p 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="text-gray-500 text-lg leading-relaxed"
        >
          Select the vibe that best fits your relationship right now.
        </motion.p>
      </header>

      <main className="flex-1 flex flex-col justify-start max-w-md mx-auto w-full relative z-10 pb-8">
        <motion.div 
          variants={container}
          initial="hidden"
          animate="show"
          className="flex flex-col gap-6"
        >
          {contexts.map((ctx) => (
            <motion.div key={ctx.id} variants={item}>
              <SelectionCard
                title={ctx.title}
                description={ctx.description}
                onClick={() => handleSelectContext(ctx.id)}
                icon={
                  <div className={`w-14 h-14 rounded-2xl ${ctx.color} flex items-center justify-center text-3xl shadow-sm transition-transform group-hover:scale-110 duration-300`}>
                    {ctx.icon}
                  </div>
                }
                className="hover:border-blue-200 hover:shadow-xl hover:shadow-blue-500/5 py-8"
              />
            </motion.div>
          ))}
        </motion.div>
      </main>
    </div>
  );
}
