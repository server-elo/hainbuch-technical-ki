import React from 'react';

/** HAINBUCH collet mark — three jaws around a bore. Same geometry as the app icon. */
export function ColletMark({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={className} aria-hidden="true">
      <defs>
        <clipPath id="cm-slots">
          <path
            d="M0 0h64v64H0z M32 32 L36.4 -17.8 L27.6 -17.8 Z M32 32 L-13.3 53.1 L-9.0 60.7 Z M32 32 L73.0 60.7 L77.3 53.1 Z"
            clipRule="evenodd"
          />
        </clipPath>
      </defs>
      <g clipPath="url(#cm-slots)">
        <circle cx="32" cy="32" r="19" fill="none" stroke="currentColor" strokeWidth="7" />
      </g>
      <circle cx="32" cy="32" r="7.5" fill="currentColor" />
    </svg>
  );
}

export default ColletMark;
