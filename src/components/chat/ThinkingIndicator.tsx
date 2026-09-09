import React, { useState, useRef, useEffect } from 'react';
import { Loader2, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import type { PipelineStatus } from '../../types';

export function ThinkingIndicator({ pipeline, fallback }: { pipeline: PipelineStatus; fallback: string }) {
  const [open, setOpen] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [pipeline.log.length, open]);

  const latest = pipeline.log[pipeline.log.length - 1] || fallback;

  return (
    <div className="max-w-[85%]">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 text-neutral-400 hover:text-neutral-600 transition-colors group"
      >
        <Loader2 size={11} className="animate-spin text-red-600 shrink-0" />
        <span className="text-[10px] font-medium animate-pulse">
          {open ? fallback : latest}
        </span>
        <ChevronRight
          size={10}
          className={`shrink-0 transition-transform text-neutral-300 group-hover:text-neutral-500 ${open ? 'rotate-90' : ''}`}
        />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div
              ref={logRef}
              className="mt-1.5 ml-4 pl-3 border-l-2 border-neutral-200 max-h-32 overflow-y-auto space-y-1"
            >
              {pipeline.log.map((line, i) => (
                <p
                  key={i}
                  className={`text-[10px] leading-relaxed ${
                    i === pipeline.log.length - 1 ? 'text-neutral-500' : 'text-neutral-400'
                  }`}
                >
                  {line}
                </p>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default ThinkingIndicator;
