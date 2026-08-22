import type { CoverLayout, CoverPalette } from '@/types'

export interface Palette {
  id: CoverPalette
  label: string
  /** Cover background. */
  bg: string
  /** Title / primary text. */
  fg: string
  /** Rules, byline, subtitle. */
  muted: string
  /** Band and accent lines. */
  accent: string
}

export const PALETTES: Palette[] = [
  { id: 'sepia',  label: 'Sepia',  bg: '#e9dcc6', fg: '#3a2c1b', muted: '#7c6a51', accent: '#8a4b2a' },
  { id: 'ink',    label: 'Ink',    bg: '#1f2124', fg: '#f4f1ea', muted: '#a9a49a', accent: '#c8a35a' },
  { id: 'forest', label: 'Forest', bg: '#1d3a30', fg: '#f0efe6', muted: '#9db5a9', accent: '#d8a657' },
  { id: 'plum',   label: 'Plum',   bg: '#3a2338', fg: '#f5ecf2', muted: '#b79bb0', accent: '#e0a3b8' },
  { id: 'cobalt', label: 'Cobalt', bg: '#17335c', fg: '#eef3fb', muted: '#9db2d4', accent: '#7fb2f0' },
  { id: 'ember',  label: 'Ember',  bg: '#5c1f18', fg: '#fbeee9', muted: '#d3a396', accent: '#f0a868' },
]

export const LAYOUTS: { id: CoverLayout; label: string }[] = [
  { id: 'classic', label: 'Classic' },
  { id: 'band', label: 'Band' },
  { id: 'minimal', label: 'Minimal' },
]

export function paletteOf(id: CoverPalette): Palette {
  return PALETTES.find((p) => p.id === id) ?? PALETTES[0]
}
