import React from 'react';
import { motion } from 'framer-motion';

export default function SelectionCard({
  title,
  description,
  icon,
  onClick,
  selected = false,
  disabled = false,
  className = ''
}) {
  return (
    <motion.button
      onClick={onClick}
      disabled={disabled}
      whileHover={!disabled ? { scale: 1.02, y: -2 } : {}}
      whileTap={!disabled ? { scale: 0.98 } : {}}
      className={`
        relative w-full text-left p-6 rounded-2xl border-2 transition-all duration-200
        flex flex-col gap-3 group bg-white
        ${selected 
          ? 'border-blue-500 shadow-lg shadow-blue-500/10 ring-4 ring-blue-500/10' 
          : 'border-transparent shadow-sm hover:border-gray-200 hover:shadow-md'
        }
        ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}
        ${className}
      `}
    >
      <div className="flex items-center justify-between w-full">
        <h3 className={`text-xl font-bold ${selected ? 'text-blue-600' : 'text-gray-900 group-hover:text-blue-600'} transition-colors`}>
          {title}
        </h3>
        {icon && <span className="text-2xl">{icon}</span>}
      </div>
      
      {description && (
        <p className="text-gray-600 text-sm leading-relaxed">
          {description}
        </p>
      )}
      
      {/* Selection Indicator */}
      <div className={`
        absolute top-6 right-6 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors
        ${selected ? 'bg-blue-500 border-blue-500' : 'border-gray-200 group-hover:border-blue-300'}
        ${icon ? 'hidden' : ''}
      `}>
        {selected && (
          <motion.svg 
            initial={{ scale: 0 }} 
            animate={{ scale: 1 }} 
            className="w-3 h-3 text-white" 
            viewBox="0 0 24 24" 
            fill="none" 
            stroke="currentColor" 
            strokeWidth="4" 
            strokeLinecap="round" 
            strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </motion.svg>
        )}
      </div>
    </motion.button>
  );
}
