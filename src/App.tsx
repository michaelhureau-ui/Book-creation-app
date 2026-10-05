import { useEffect } from 'react'
import { Library } from '@/components/Library'
import { Workspace } from '@/components/Workspace'
import { useStore } from '@/lib/store'

export default function App() {
  const load = useStore((s) => s.load)
  const openBookId = useStore((s) => s.openBookId)

  useEffect(() => { void load() }, [load])

  return (
    <div className="app-root h-full overflow-hidden">
      {openBookId ? <Workspace /> : <div className="h-full overflow-y-auto scrollbar-slim"><Library /></div>}
    </div>
  )
}
