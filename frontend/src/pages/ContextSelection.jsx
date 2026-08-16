import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';

export default function ContextSelection() {
  const { tableToken, restaurantSlug } = useParams();
  const navigate = useNavigate();

  const handleSelectContext = (context) => {
    const modePath = restaurantSlug
      ? `/r/${restaurantSlug}/t/${tableToken}/mode`
      : `/t/${tableToken}/mode`;
    navigate(modePath, { state: { context } });
  };

  // Internal context IDs stay 'Exploring' / 'Established' for backend/deck compatibility.
  // Display labels are now vibe-based, no relationship-definition required.
  const contexts = [
    {
      id: 'Exploring',
      title: 'Keep it light',
      description: 'Playful and easy.'
    },
    {
      id: 'Established',
      title: 'Go deeper',
      description: 'More personal. Questions about the two of you.'
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
    <div className="min-h-screen bg-[#F3EDE1] flex flex-col p-6 relative overflow-hidden selection:bg-[#35332E]/10 selection:text-[#35332E]">

      <header className="mb-12 mt-10 text-left relative z-10 max-w-md mx-auto w-full">
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mb-6"
        >
          <span className="text-xs font-semibold text-[#6E6A60] uppercase tracking-[0.18em]">Step 1 of 2</span>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.08 }}
          className="text-4xl md:text-5xl font-bold text-[#35332E] tracking-tight leading-[1.1]"
        >
          What kind of questions?
        </motion.h1>
      </header>

      <main className="flex-1 flex flex-col justify-start max-w-md mx-auto w-full relative z-10 pb-8">
        <motion.div
          variants={container}
          initial="hidden"
          animate="show"
          className="flex flex-col gap-4"
        >
          {contexts.map((ctx) => (
            <motion.button
              key={ctx.id}
              variants={item}
              onClick={() => handleSelectContext(ctx.id)}
              whileHover={{ scale: 1.015, y: -1 }}
              whileTap={{ scale: 0.99 }}
              className="group relative w-full text-left p-7 rounded-2xl border transition-all duration-150 bg-[#FBF7EF] border-[#DCD3C2] hover:bg-[#35332E] hover:border-[#35332E] active:bg-[#26241F] active:border-[#26241F] shadow-sm hover:shadow-xl hover:shadow-[#35332E]/8 focus:outline-none focus:ring-4 focus:ring-[#35332E]/10"
            >
              <h3 className={`text-2xl font-semibold transition-colors text-[#35332E] group-hover:text-[#F3EDE1] group-active:text-[#F3EDE1]`}>
                {ctx.title}
              </h3>
              {ctx.description && (
                <p className={`mt-3 text-base leading-relaxed transition-colors text-[#6E6A60] group-hover:text-[#F3EDE1]/85 group-active:text-[#F3EDE1]/85`}>
                  {ctx.description}
                </p>
              )}
            </motion.button>
          ))}
        </motion.div>
      </main>
    </div>
  );
}
