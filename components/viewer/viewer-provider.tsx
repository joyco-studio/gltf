'use client'

import * as React from 'react'

import {
  EMPTY_SNAPSHOT,
  Viewer,
  type ModelTransform,
  type ViewerSnapshot,
} from '@/lib/viz/viewer'

import { EXAMPLE_MODEL } from './example-model'
import { formatSharePath } from './share-path'

type InspectorTab = 'contents' | 'textures' | 'animations'

interface Selection {
  kind: 'mesh' | 'material' | 'texture' | 'animation'
  id: number
}

interface ViewerContextValue {
  viewer: Viewer | null
  snapshot: ViewerSnapshot
  /** Mount a canvas into the viz. Returns a cleanup to dispose the instance. */
  attach: (canvas: HTMLCanvasElement) => () => void
  openFiles: (files: File[]) => void
  openUrl: (url: string, transform?: ModelTransform) => void
  /** Load the bundled showcase model. */
  openExample: () => void
  /** True while the active model is the bundled example (for attribution). */
  isExample: boolean
  /** Reveal + inspect an entity (same effect as picking it in ⌘K search). */
  jumpTo: (selection: Selection, name: string) => void
  tab: InspectorTab
  setTab: (tab: InspectorTab) => void
  sidebarOpen: boolean
  setSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>
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
  const [sidebarOpen, setSidebarOpen] = React.useState(true)
  const [selection, select] = React.useState<Selection | null>(null)
  const [searchOpen, setSearchOpen] = React.useState(false)
  // source URL of the active model, or null when loaded from local files —
  // lets the UI credit the bundled example while it's on screen
  const [source, setSource] = React.useState<string | null>(null)

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
      setSource(null)
      void viewer?.loadFiles(files)
    },
    [viewer]
  )

  const openUrl = React.useCallback(
    (url: string, transform?: ModelTransform) => {
      select(null)
      setSource(url)
      void viewer?.loadUrl(url, transform)
    },
    [viewer]
  )

  const openExample = React.useCallback(
    () =>
      openUrl(EXAMPLE_MODEL.url, {
        position: EXAMPLE_MODEL.position,
        scale: EXAMPLE_MODEL.scale,
      }),
    [openUrl]
  )

  const jumpTo = React.useCallback(
    (selection: Selection, name: string) => {
      // show it in the sidebar (re-opening it if collapsed)...
      setSidebarOpen(true)
      setTab(
        selection.kind === 'texture'
          ? 'textures'
          : selection.kind === 'animation'
            ? 'animations'
            : 'contents'
      )
      select(selection)
      // ...and trigger the scene effect: animations play (exclusive), every
      // other kind gets framed + highlighted for inspection (ESC exits)
      if (selection.kind === 'animation') {
        viewer?.animations.play(selection.id)
      } else {
        viewer?.inspectItem(selection.kind, selection.id, name)
      }
      // reflect the spot in the URL (?path=materials.mat_1) so it's shareable
      const params = new URLSearchParams(window.location.search)
      params.set('path', formatSharePath(selection.kind, name))
      window.history.replaceState(null, '', `?${params}`)
    },
    [viewer]
  )

  const value = React.useMemo(
    () => ({
      viewer,
      snapshot,
      attach,
      openFiles,
      openUrl,
      openExample,
      isExample: source === EXAMPLE_MODEL.url,
      jumpTo,
      tab,
      setTab,
      sidebarOpen,
      setSidebarOpen,
      selection,
      select,
      searchOpen,
      setSearchOpen,
    }),
    [
      viewer,
      snapshot,
      attach,
      openFiles,
      openUrl,
      openExample,
      source,
      jumpTo,
      tab,
      sidebarOpen,
      selection,
      searchOpen,
    ]
  )

  return (
    <ViewerContext.Provider value={value}>{children}</ViewerContext.Provider>
  )
}

export { ViewerProvider, useViewer }
export type { Selection, InspectorTab }
