// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

interface WindowsLogoProps {
  /** Tailwind sizing / layout classes, e.g. "h-3 w-3". */
  className?: string;
  /** Accessible label; defaults to "Windows". */
  title?: string;
}

/**
 * The four-color Microsoft logo mark, used as the Windows-platform
 * indicator across baseline cards, the Microsoft Baselines catalog,
 * and the editor. Rendered as an inline SVG so it stays crisp at any
 * size and needs no font/emoji support. Linux uses the 🐧 emoji.
 */
export function WindowsLogo({ className, title = "Windows" }: WindowsLogoProps) {
  return (
    <svg
      viewBox="0 0 23 23"
      className={className}
      role="img"
      aria-label={title}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="1" y="1" width="10" height="10" fill="#F25022" />
      <rect x="12" y="1" width="10" height="10" fill="#7FBA00" />
      <rect x="1" y="12" width="10" height="10" fill="#00A4EF" />
      <rect x="12" y="12" width="10" height="10" fill="#FFB900" />
    </svg>
  );
}
