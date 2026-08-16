import React from 'react';

export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="w-full bg-[#F3EDE1] border-t border-[#35332E]/10 py-6 mt-auto">
      <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-4 text-sm text-[#6E6A60]">

        <div className="flex items-center gap-2">
          <span className="font-bold text-[#35332E]">Catalyst</span>
          <span className="text-[#35332E]/15">|</span>
          <span>© {year}</span>
        </div>

        <div className="flex items-center gap-6">
          <a href="#" className="hover:text-[#35332E] transition-colors">About</a>
          <a href="#" className="hover:text-[#35332E] transition-colors">Privacy</a>
          <a href="#" className="hover:text-[#35332E] transition-colors">Terms</a>
        </div>

        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-[#35332E]/5 text-[#6E6A60] text-xs font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-[#35332E]/60 animate-pulse"></span>
            Systems Operational
          </span>
        </div>
      </div>
    </footer>
  );
}
