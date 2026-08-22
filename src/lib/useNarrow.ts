import { useEffect, useState } from 'react'

/**
 * Tracks a media query. The workspaces keep their side panels docked on a wide
 * screen and move them into drawers on a narrow one, which needs to be known in
 * JavaScript — CSS alone cannot decide whether tapping a panel should open a
 * drawer.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  )

  useEffect(() => {
    const list = window.matchMedia(query)
    const update = (): void => setMatches(list.matches)
    update()
    list.addEventListener('change', update)
    return () => list.removeEventListener('change', update)
  }, [query])

  return matches
}

/** Below the breakpoint where the inspector is docked beside the page. */
export function useNarrow(): boolean {
  return useMediaQuery('(max-width: 1279px)')
}

/** Below the breakpoint where the chapter list is docked. */
export function useVeryNarrow(): boolean {
  return useMediaQuery('(max-width: 639px)')
}
