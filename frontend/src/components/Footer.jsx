import React from 'react';

export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="w-full bg-white border-t border-gray-100 py-6 mt-auto">
      <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-4 text-sm text-gray-500">
        
        {/* Left: Brand & Copyright */}
        <div className="flex items-center gap-2">
          <span className="font-bold text-gray-900">Table-Talk</span>
          <span className="text-gray-300">|</span>
          <span>© {year}</span>
        </div>

        {/* Center: Links */}
        <div className="flex items-center gap-6">
          <a href="#" className="hover:text-black transition-colors">About</a>
          <a href="#" className="hover:text-black transition-colors">Privacy</a>
          <a href="#" className="hover:text-black transition-colors">Terms</a>
        </div>

        {/* Right: Social / Status */}
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-green-50 text-green-700 text-xs font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
            Systems Operational
          </span>
        </div>
      </div>
    </footer>
  );
}
