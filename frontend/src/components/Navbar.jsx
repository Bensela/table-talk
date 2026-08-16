import React from 'react';
import { motion } from 'framer-motion';

export default function Navbar() {
  return (
    <motion.nav
      initial={{ y: -100 }}
      animate={{ y: 0 }}
      transition={{ duration: 0.5 }}
      className="fixed top-0 left-0 right-0 bg-[#F3EDE1]/85 backdrop-blur-md z-40 border-b border-[#35332E]/10"
    >
      <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <img src="/catalyst-logo.png" alt="Catalyst" className="h-14 w-auto object-contain drop-shadow-sm" />
        </div>

        <div className="hidden md:flex items-center gap-8 text-sm font-medium text-[#6E6A60]">
          <a href="#how-it-works" className="hover:text-[#35332E] transition-colors">How it Works</a>
          <a href="#scan" className="hover:text-[#35332E] transition-colors">Scan</a>
          <a href="#about" className="hover:text-[#35332E] transition-colors">About</a>
        </div>

        <div className="md:hidden"></div>
      </div>
    </motion.nav>
  );
}
