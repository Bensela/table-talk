import React, { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Button from './Button';

const VARIANT_STYLES = {
  light: {
    panel: 'bg-white text-slate-900 border border-slate-200/80',
    backdrop: 'bg-slate-950/40',
    accent: 'text-slate-900',
    header: 'text-slate-900',
    body: 'text-slate-600',
    blobs: ['bg-indigo-100/60', 'bg-fuchsia-100/60'],
    closeBtn: 'hover:bg-slate-100 text-slate-500 hover:text-slate-800'
  },
  dark: {
    panel: 'bg-slate-900/95 text-white border border-slate-800/80 shadow-[0_30px_80px_-15px_rgba(124,58,237,0.35)]',
    backdrop: 'bg-slate-950/70',
    accent: 'text-violet-200',
    header: 'text-white',
    body: 'text-slate-300',
    blobs: ['bg-violet-600/20', 'bg-fuchsia-500/20'],
    closeBtn: 'hover:bg-slate-800 text-slate-400 hover:text-white'
  },
  danger: {
    panel: 'bg-slate-900/95 text-white border border-rose-500/40 shadow-[0_30px_80px_-15px_rgba(244,63,94,0.45)]',
    backdrop: 'bg-rose-950/60',
    accent: 'text-rose-200',
    header: 'text-white',
    body: 'text-rose-100/80',
    blobs: ['bg-rose-600/25', 'bg-fuchsia-500/15'],
    closeBtn: 'hover:bg-rose-500/10 text-rose-200/70 hover:text-white'
  },
  success: {
    panel: 'bg-slate-900/95 text-white border border-emerald-500/40 shadow-[0_30px_80px_-15px_rgba(16,185,129,0.35)]',
    backdrop: 'bg-emerald-950/50',
    accent: 'text-emerald-200',
    header: 'text-white',
    body: 'text-emerald-50/80',
    blobs: ['bg-emerald-500/20', 'bg-teal-400/15'],
    closeBtn: 'hover:bg-emerald-500/10 text-emerald-100/70 hover:text-white'
  }
};

const SIZE_STYLES = {
  sm: 'max-w-xs',
  md: 'max-w-md',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  '2xl': 'max-w-5xl',
  fullscreen: 'max-w-[96vw] h-[92vh]'
};

/**
 * Accessible shared Modal component used across the whole app.
 * - AnimatePresence mount/unmount transitions (scale + fade + slight slide)
 * - Backdrop blur (3 tiers based on variant)
 * - Escape key closes
 * - Body scroll lock while open (restored on unmount)
 * - role=dialog + aria-modal + aria-labelledby for a11y
 * - Close (×) button in the header
 * - Auto-focus first primary action or close button
 */
export default function Modal({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  actionLabel,
  onAction,
  actionDisabled = false,
  actionLoading = false,
  actionVariant = 'primary',
  closeLabel = 'Close',
  closeVariant = 'secondary',
  showCloseButton = true,
  closeButtonLabel = null,
  icon = null,
  variant = 'dark', // 'light' | 'dark' | 'danger' | 'success'
  size = 'md', // 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'fullscreen'
  closeOnBackdrop = true,
  closeOnEscape = true,
  footer, // optional React node to replace the default button row
  align = 'center', // 'center' | 'left'
  className = '',
  panelClassName = ''
}) {
  const panelRef = useRef(null);
  const theme = VARIANT_STYLES[variant] || VARIANT_STYLES.dark;
  const sizeCls = SIZE_STYLES[size] || SIZE_STYLES.md;
  const titleId = useRef(`modal-title-${Math.random().toString(36).slice(2, 9)}`).current;

  // Scroll lock + Esc key + focus first button when opened.
  useEffect(() => {
    if (!isOpen) return undefined;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKey = (e) => {
      if (!closeOnEscape) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose && onClose();
      }
    };
    document.addEventListener('keydown', onKey);

    // Focus first primary/action button, else the close button.
    requestAnimationFrame(() => {
      if (!panelRef.current) return;
      const primary = panelRef.current.querySelector('[data-modal-primary="true"]')
        || panelRef.current.querySelector('[data-modal-close="true"]');
      if (primary && typeof primary.focus === 'function') primary.focus({ preventScroll: true });
    });

    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', onKey);
    };
  }, [isOpen, onClose, closeOnEscape]);

  const alignClass = align === 'left' ? 'items-start text-left' : 'items-center text-center';
  const iconContainer = align === 'left'
    ? 'mb-3 self-start inline-flex items-center justify-center rounded-2xl p-3 bg-violet-500/15 text-violet-200 border border-violet-500/30'
    : 'mb-4 inline-flex items-center justify-center rounded-2xl p-4 bg-violet-500/15 text-violet-200 border border-violet-500/30';

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 sm:p-6">
          {/* Backdrop */}
          <motion.div
            key={`backdrop-${titleId}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            onClick={() => closeOnBackdrop && onClose && onClose()}
            className={`absolute inset-0 backdrop-blur-md ${theme.backdrop}`}
            aria-hidden
          />

          {/* Modal panel */}
          <motion.div
            key={`panel-${titleId}`}
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? titleId : undefined}
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className={`relative w-full ${sizeCls} rounded-[28px] shadow-2xl overflow-hidden ${theme.panel} ${className} ${panelClassName}`}
          >
            {/* Decorative background blobs */}
            <div aria-hidden className={`pointer-events-none absolute -top-16 -right-16 w-52 h-52 rounded-full blur-3xl opacity-90 ${theme.blobs[0]}`} />
            <div aria-hidden className={`pointer-events-none absolute -bottom-20 -left-16 w-60 h-60 rounded-full blur-3xl opacity-90 ${theme.blobs[1]}`} />

            {/* Close (×) button */}
            {showCloseButton && onClose && (
              <button
                type="button"
                data-modal-close="true"
                onClick={onClose}
                aria-label={closeLabel}
                title={closeLabel}
                className={`absolute top-3 right-3 z-20 inline-flex items-center justify-center w-10 h-10 rounded-xl transition-colors ${theme.closeBtn}`}
              >
                <svg aria-hidden viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}

            <div className={`relative z-10 flex flex-col ${alignClass} p-6 sm:p-7 ${size === 'fullscreen' ? 'h-full overflow-hidden' : ''}`}>
              {icon && <div className={iconContainer}>{icon}</div>}

              {title && (
                <h3 id={titleId} className={`text-xl sm:text-2xl font-extrabold tracking-tight ${theme.header} ${icon ? '' : align === 'left' ? '' : 'mt-1'}`}>
                  {title}
                </h3>
              )}
              {subtitle && (
                <p className={`text-sm mt-2 ${theme.body} ${align === 'left' ? '' : 'max-w-md mx-auto'}`}>
                  {subtitle}
                </p>
              )}

              <div className={`${theme.body} leading-relaxed ${size === 'fullscreen' ? 'mt-4 flex-1 min-h-0 overflow-auto pr-1 -mr-1' : title || icon ? 'mt-4' : ''} mb-6`}>
                {children}
              </div>

              {/* Footer / actions */}
              {footer !== undefined ? (
                <div className="relative z-10">
                  {footer}
                </div>
              ) : (onAction || actionLabel || onClose) ? (
                <div className={`relative z-10 flex flex-col-reverse sm:flex-row gap-2.5 w-full ${align === 'left' ? '' : 'justify-center'}`}>
                  {onClose && (
                    <Button
                      data-modal-close="true"
                      variant={closeVariant}
                      onClick={onClose}
                      fullWidth
                    >
                      {closeLabel}
                    </Button>
                  )}
                  {onAction && actionLabel && (
                    <Button
                      data-modal-primary="true"
                      variant={actionVariant}
                      onClick={onAction}
                      fullWidth
                      disabled={actionDisabled || actionLoading}
                      isLoading={actionLoading}
                    >
                      {actionLabel}
                    </Button>
                  )}
                </div>
              ) : null}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
