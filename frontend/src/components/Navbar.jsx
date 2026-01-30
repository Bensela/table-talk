import React from 'react';
import { motion } from 'framer-motion';

export default function Navbar() {
  return (
    <motion.nav 
      initial={{ y: -100 }}
      animate={{ y: 0 }}
      transition={{ duration: 0.5 }}
      className="fixed top-0 left-0 right-0 bg-white/80 backdrop-blur-md z-40 border-b border-gray-100"
    >
      <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-2xl">💬</span>
          <span className="font-bold text-xl tracking-tight text-gray-900">Table-Talk</span>
        </div>
        
        {/* Desktop Links (Optional for MVP, but good for "Modern" feel) */}
        <div className="hidden md:flex items-center gap-8 text-sm font-medium text-gray-600">
          <a href="#how-it-works" className="hover:text-black transition-colors">How it Works</a>
          <a href="#scan" className="hover:text-black transition-colors">Scan</a>
          <a href="#about" className="hover:text-black transition-colors">About</a>
        </div>

        {/* Mobile Menu Icon (Placeholder) */}
        <div className="md:hidden">
          {/* We can add a mobile menu later if needed */}
        </div>
      </div>
    </motion.nav>
  );
}
