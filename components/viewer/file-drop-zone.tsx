'use client'

import * as React from 'react'
import { FileUp } from 'lucide-react'

import { useViewer } from './viewer-provider'

const ACCEPTED_EXTENSIONS =
  '.glb,.gltf,.bin,.png,.jpg,.jpeg,.webp,.ktx2,.avif'

/**
 * Window-level drag & drop target. Renders a full-screen affordance while a
 * drag is in flight and forwards dropped files to the viewer.
 */
function FileDropZone() {
  const { openFiles } = useViewer()
  const [dragging, setDragging] = React.useState(false)
  const dragDepth = React.useRef(0)

  React.useEffect(() => {
    const handleDragEnter = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files')) return
      dragDepth.current += 1
      setDragging(true)
    }

    const handleDragLeave = () => {
      dragDepth.current = Math.max(0, dragDepth.current - 1)
      if (dragDepth.current === 0) setDragging(false)
    }

    const handleDragOver = (event: DragEvent) => {
      event.preventDefault()
    }

    const handleDrop = (event: DragEvent) => {
      event.preventDefault()
      dragDepth.current = 0
      setDragging(false)
      const files = [...(event.dataTransfer?.files ?? [])]
      if (files.length > 0) openFiles(files)
    }

    window.addEventListener('dragenter', handleDragEnter)
    window.addEventListener('dragleave', handleDragLeave)
    window.addEventListener('dragover', handleDragOver)
    window.addEventListener('drop', handleDrop)
    return () => {
      window.removeEventListener('dragenter', handleDragEnter)
      window.removeEventListener('dragleave', handleDragLeave)
      window.removeEventListener('dragover', handleDragOver)
      window.removeEventListener('drop', handleDrop)
    }
  }, [openFiles])

  if (!dragging) return null

  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-3 border-2 border-dashed border-primary px-16 py-12 text-center">
        <FileUp className="size-8 text-primary" />
        <p className="font-mono text-sm uppercase tracking-wide text-foreground">
          Drop .glb / .gltf to inspect
        </p>
      </div>
    </div>
  )
}

/** Hidden file input + imperative opener, shared by header and empty state. */
function useFilePicker() {
  const { openFiles } = useViewer()
  const inputRef = React.useRef<HTMLInputElement>(null)

  const input = (
    <input
      ref={inputRef}
      type="file"
      multiple
      accept={ACCEPTED_EXTENSIONS}
      className="hidden"
      onChange={(event) => {
        const files = [...(event.target.files ?? [])]
        if (files.length > 0) openFiles(files)
        event.target.value = ''
      }}
    />
  )

  const openPicker = React.useCallback(() => {
    inputRef.current?.click()
  }, [])

  return { input, openPicker }
}

export { FileDropZone, useFilePicker }
