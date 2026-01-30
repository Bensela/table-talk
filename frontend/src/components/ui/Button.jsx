import React from 'react';
import { motion } from 'framer-motion';

/**
 * Reusable Button Component
 * 
 * Variants:
 * - primary: Blue background, white text (Call to Action)
 * - black: Black background, white text (High contrast, often used in game)
 * - secondary: Gray background, dark text (Alternative actions)
 * - outline: Transparent background, border (Low emphasis)
 * - ghost: No background (Text links)
 * - danger: Red background (Destructive actions)
 */
export default function Button({
  children,
  onClick,
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  isLoading = false,
  disabled = false,
  icon = null,
  iconPosition = 'right',
  className = '',
  type = 'button',
  ...props
}) {
  const baseStyles = "inline-flex items-center justify-center font-bold rounded-xl transition-all duration-200 focus:outline-none focus:ring-4 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100";
  
  const variants = {
    primary: "bg-[#007AFF] text-white hover:bg-blue-600 shadow-lg shadow-blue-500/30 active:shadow-blue-500/20 focus:ring-blue-500/40",
    black: "bg-gray-900 text-white hover:bg-gray-800 shadow-lg shadow-gray-900/20 active:shadow-gray-900/10 focus:ring-gray-900/30",
    secondary: "bg-gray-100 text-gray-900 hover:bg-gray-200 focus:ring-gray-200/50",
    outline: "bg-transparent border-2 border-gray-200 text-gray-900 hover:border-gray-900 hover:bg-gray-50 focus:ring-gray-200/50",
    ghost: "bg-transparent text-black hover:bg-gray-100/50 focus:ring-gray-200/30",
    danger: "bg-red-500 text-white hover:bg-red-600 shadow-lg shadow-red-500/30 focus:ring-red-500/40",
  };

  const sizes = {
    sm: "px-3 py-1.5 text-sm",
    md: "px-5 py-2.5 text-base",
    lg: "px-6 py-3.5 text-lg",
    xl: "px-8 py-4 text-xl",
  };

  return (
    <motion.button
      type={type}
      onClick={onClick}
      disabled={disabled || isLoading}
      whileTap={!(disabled || isLoading) ? { scale: 0.96 } : {}}
      whileHover={!(disabled || isLoading) ? { scale: 1.01 } : {}}
      className={`
        ${baseStyles}
        ${variants[variant]}
        ${sizes[size]}
        ${fullWidth ? 'w-full' : ''}
        ${className}
      `}
      {...props}
    >
      {isLoading ? (
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
          <span>Loading...</span>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          {icon && iconPosition === 'left' && <span>{icon}</span>}
          <span>{children}</span>
          {icon && iconPosition === 'right' && <span>{icon}</span>}
        </div>
      )}
    </motion.button>
  );
}
