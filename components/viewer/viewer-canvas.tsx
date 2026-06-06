'use client'

import * as React from 'react'

import { cn } from '@/lib/utils'

import { useViewer } from './viewer-provider'

function ViewerCanvas({ className }: { className?: string }) {
  const { attach } = useViewer()
  const canvasRef = React.useRef<HTMLCanvasElement>(null)

  React.useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    return attach(canvas)
  }, [attach])

  return (
    <canvas
      ref={canvasRef}
      className={cn('block h-full w-full touch-none', className)}
    />
  )
}

export { ViewerCanvas }
