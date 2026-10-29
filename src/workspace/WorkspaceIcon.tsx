import { useId } from 'react';

const paths: Record<string, string> = {
  home: 'M5 14h10V5H5z M21 5h6v9h-6z M5 21h10v6H5z M21 20h6v7h-6z',
  compose: 'M7 4h13l5 5v19H7z M19 4v7h6 M11 16h10 M11 21h7',
  notes: 'M9 6h18v22H9z M5 23V3h17 M13 12h10 M13 17h10 M13 22h6',
  requests: 'M5 6h22v20H5z M5 8l11 9L27 8 M16 20v6 M13 23h6',
  members: 'M12 16a5 5 0 1 0 0-10 5 5 0 0 0 0 10 M3 27v-3a9 9 0 0 1 18 0v3 M22 7a5 5 0 0 1 0 10 M25 21a6 6 0 0 1 4 6',
  subjects: 'M16 28S3 20 3 11a7 7 0 0 1 13-4 7 7 0 0 1 13 4c0 9-13 17-13 17 M11 16h10 M16 11v10',
  publications: 'M4 6c5-2 9-1 12 2 3-3 7-4 12-2v20c-5-2-9-1-12 2-3-3-7-4-12-2z M16 8v20 M8 12h4 M20 12h4 M8 17h4 M20 17h4',
  history: 'M5 10a12 12 0 1 1-1 10 M4 4v8h8 M16 9v8l5 3',
  settings: 'M5 9h22 M5 23h22 M11 5v8 M22 19v8',
  building: 'M6 28V6h20v22 M3 28h26 M11 11h2 M19 11h2 M11 16h2 M19 16h2 M13 28v-6h6v6',
};

/** Shared two-tone, dimensional workspace icon. Decorative; controls provide labels. */
export function WorkspaceIcon({ name }: { name: string }) {
  const id = useId();
  return <span className={`cb-art-icon cb-art-${name}`} aria-hidden="true">
    <svg viewBox="0 0 32 32" fill="none">
      <defs><linearGradient id={id} x2="1" y2="1"><stop stopColor="#fff"/><stop offset="1" stopColor="#acd8cc"/></linearGradient></defs>
      <path d={paths[name] || paths.notes} fill={`url(#${id})`} stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  </span>;
}
