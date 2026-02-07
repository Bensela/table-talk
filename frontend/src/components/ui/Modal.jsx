import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Button from './Button';

export default function Modal({
  isOpen,
  onClose,
  title,
  children,
  actionLabel,
  onAction,
  icon = null
}) {
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
          />

          {/* Modal Content */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            className="relative bg-white w-full max-w-sm rounded-3xl shadow-2xl p-6 overflow-hidden"
          >
            {/* Decorative Background Blobs */}
            <div className="absolute top-[-50px] right-[-50px] w-32 h-32 bg-blue-50 rounded-full blur-2xl pointer-events-none" />
            <div className="absolute bottom-[-50px] left-[-50px] w-32 h-32 bg-purple-50 rounded-full blur-2xl pointer-events-none" />

            <div className="relative z-10 flex flex-col items-center text-center">
              {icon && (
                <div className="mb-4 text-4xl">
                  {icon}
                </div>
              )}
              
              {title && (
                <h3 className="text-xl font-bold text-gray-900 mb-2">
                  {title}
                </h3>
              )}
              
              <div className="text-gray-600 mb-6 leading-relaxed">
                {children}
              </div>

              <div className="flex gap-3 w-full">
                {onClose && (
                  <Button 
                    variant="secondary" 
                    onClick={onClose} 
                    fullWidth
                  >
                    Close
                  </Button>
                )}
                {onAction && actionLabel && (
                  <Button 
                    variant="primary" 
                    onClick={onAction} 
                    fullWidth
                  >
                    {actionLabel}
                  </Button>
                )}
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
