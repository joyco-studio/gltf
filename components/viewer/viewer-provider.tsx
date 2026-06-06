'use client'

import * as React from 'react'

import {
  EMPTY_SNAPSHOT,
  Viewer,
  type ViewerSnapshot,
} from '@/lib/viz/viewer'

type InspectorTab = 'contents' | 'textures'

interface Selection {
  kind: 'mesh' | 'material' | 'texture'
  id: number
}

interface ViewerContextValue {
  viewer: Viewer | null
  snapshot: ViewerSnapshot
  /** Mount a canvas into the viz. Returns a cleanup to dispose the instance. */
  attach: (canvas: HTMLCanvasElement) => () => void
  openFiles: (files: File[]) => void
  tab: InspectorTab
  setTab: (tab: InspectorTab) => void
  selection: Selection | null
  select: (selection: Selection | null) => void
  searchOpen: boolean
  setSearchOpen: React.Dispatch<React.SetStateAction<boolean>>
}

const ViewerContext = React.createContext<ViewerContextValue | null>(null)

function useViewer() {
  const context = React.useContext(ViewerContext)
  if (!context) {
    throw new Error('useViewer must be used within a <ViewerProvider />')
  }
  return context
}

const noopSubscribe = () => () => {}
const getEmptySnapshot = () => EMPTY_SNAPSHOT

function ViewerProvider({ children }: { children: React.ReactNode }) {
  const [viewer, setViewer] = React.useState<Viewer | null>(null)
  const [tab, setTab] = React.useState<InspectorTab>('contents')
  const [selection, select] = React.useState<Selection | null>(null)
  const [searchOpen, setSearchOpen] = React.useState(false)

  const attach = React.useCallback((canvas: HTMLCanvasElement) => {
    const instance = new Viewer(canvas)
    instance.start()
    setViewer(instance)
    // dev/e2e convenience: poke the viz from the console
    ;(window as unknown as { __GLTF_VIEWER__?: Viewer }).__GLTF_VIEWER__ =
      instance
    return () => {
      instance.dispose()
      setViewer((current) => (current === instance ? null : current))
    }
  }, [])

  const snapshot = React.useSyncExternalStore(
    React.useMemo(
      () =>
        viewer
          ? (onStoreChange: () => void) => viewer.on('change', onStoreChange)
          : noopSubscribe,
      [viewer]
    ),
    viewer ? () => viewer.getSnapshot() : getEmptySnapshot,
    getEmptySnapshot
  )

  const openFiles = React.useCallback(
    (files: File[]) => {
      select(null)
      void viewer?.loadFiles(files)
    },
    [viewer]
  )

  const value = React.useMemo(
    () => ({
      viewer,
      snapshot,
      attach,
      openFiles,
      tab,
      setTab,
      selection,
      select,
      searchOpen,
      setSearchOpen,
    }),
    [viewer, snapshot, attach, openFiles, tab, selection, searchOpen]
  )

  return (
    <ViewerContext.Provider value={value}>{children}</ViewerContext.Provider>
  )
}

export { ViewerProvider, useViewer }
export type { Selection, InspectorTab }
