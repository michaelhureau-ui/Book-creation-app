interface IconProps {
  className?: string
}

function svg(path: React.ReactNode, extra?: { fill?: boolean }) {
  return function Icon({ className = 'h-4 w-4' }: IconProps) {
    return (
      <svg
        className={className}
        viewBox="0 0 24 24"
        fill={extra?.fill ? 'currentColor' : 'none'}
        stroke={extra?.fill ? 'none' : 'currentColor'}
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {path}
      </svg>
    )
  }
}

export const Icons = {
  Book: svg(<><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z" /><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5A2.5 2.5 0 0 1 4 20.5z" /></>),
  Plus: svg(<><path d="M12 5v14M5 12h14" /></>),
  Trash: svg(<><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1L18 7" /></>),
  Copy: svg(<><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a1 1 0 0 1 1-1h9" /></>),
  Back: svg(<><path d="M19 12H5M11 18l-6-6 6-6" /></>),
  Download: svg(<><path d="M12 4v11M7 11l5 5 5-5M5 20h14" /></>),
  Upload: svg(<><path d="M12 16V5M7 10l5-5 5 5M5 20h14" /></>),
  Eye: svg(<><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z" /><circle cx="12" cy="12" r="2.6" /></>),
  Pencil: svg(<><path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z" /><path d="M14.5 6.5 17.5 9.5" /></>),
  Up: svg(<><path d="m6 14 6-6 6 6" /></>),
  Down: svg(<><path d="m6 10 6 6 6-6" /></>),
  Close: svg(<><path d="M6 6l12 12M18 6 6 18" /></>),
  Search: svg(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>),
  Bold: svg(<><path d="M7 5h6.5a3.5 3.5 0 0 1 0 7H7z" /><path d="M7 12h7.5a3.5 3.5 0 0 1 0 7H7z" /></>),
  Italic: svg(<><path d="M14 5h-4M14 19h-4M15 5l-4 14" /></>),
  Underline: svg(<><path d="M7 4v7a5 5 0 0 0 10 0V4M6 20h12" /></>),
  Strike: svg(<><path d="M5 12h14" /><path d="M8 8a3.5 3.5 0 0 1 3.5-3h1A3.5 3.5 0 0 1 16 8M8 16a3.5 3.5 0 0 0 3.5 3h1A3.5 3.5 0 0 0 16 16" /></>),
  Quote: svg(<><path d="M9 7H6a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h1c0 2-1 3-2 3M20 7h-3a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h1c0 2-1 3-2 3" /></>),
  ListBullet: svg(<><path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" /></>),
  ListOrdered: svg(<><path d="M10 6h10M10 12h10M10 18h10M4 6h1.5M4.5 6v3M4 15h2v3H4zM4 15a1 1 0 0 1 2 0c0 .8-2 1.4-2 3h2" /></>),
  Rule: svg(<><path d="M4 12h16" /><path d="M7 7h10M7 17h10" /></>),
  Undo: svg(<><path d="M9 14 4 9l5-5" /><path d="M4 9h9a7 7 0 0 1 0 14h-3" /></>),
  Redo: svg(<><path d="m15 14 5-5-5-5" /><path d="M20 9h-9a7 7 0 0 0 0 14h3" /></>),
  Save: svg(<><path d="M5 5h11l3 3v11H5z" /><path d="M8 5v5h7V5M8 19v-5h8v5" /></>),
  Check: svg(<><path d="m5 13 4 4L19 7" /></>),
  Alert: svg(<><path d="M12 8v5M12 16.5h.01" /><circle cx="12" cy="12" r="9" /></>),
  Sparkle: svg(<><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" /></>),
}
