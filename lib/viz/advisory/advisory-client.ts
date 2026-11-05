import {
  runCoverageJob,
  runDownloadJob,
  type CoverageJobResult,
  type DownloadJobInput,
  type DownloadJobResult,
} from './advisory-jobs'
import type { AdvisoryRequest, AdvisoryResponse } from './advisory.worker'
import type { CoverageInput } from './uv-coverage'

type Distribute<T> = T extends unknown ? Omit<T, 'id'> : never

/**
 * Promise RPC over the advisory worker. Falls back to running jobs inline
 * where workers are unavailable (tests, very old browsers).
 */
class AdvisoryClient {
  private worker: Worker | null = null
  private unavailable = false
  private nextId = 0
  private pending = new Map<
    number,
    { resolve: (value: never) => void; reject: (error: Error) => void }
  >()

  coverage(input: CoverageInput): Promise<CoverageJobResult> {
    return this.request({ type: 'coverage', input }, () => runCoverageJob(input))
  }

  download(input: DownloadJobInput): Promise<DownloadJobResult> {
    return this.request({ type: 'download', input }, () => runDownloadJob(input))
  }

  dispose() {
    this.worker?.terminate()
    this.worker = null
    this.unavailable = true
    this.rejectAll(new Error('Advisory worker disposed'))
  }

  private request<T>(
    message: Distribute<AdvisoryRequest>,
    inline: () => Promise<T>
  ): Promise<T> {
    const worker = this.getWorker()
    if (!worker) return inline()
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: never) => void, reject })
      worker.postMessage({ ...message, id })
    })
  }

  private getWorker() {
    if (this.worker || this.unavailable) return this.worker
    if (typeof Worker === 'undefined') {
      this.unavailable = true
      return null
    }
    try {
      const worker = new Worker(
        new URL('./advisory.worker.ts', import.meta.url),
        { type: 'module' }
      )
      worker.addEventListener('message', (event: MessageEvent<AdvisoryResponse>) => {
        const response = event.data
        const pending = this.pending.get(response.id)
        if (!pending) return
        this.pending.delete(response.id)
        if (response.ok) pending.resolve(response.result as never)
        else pending.reject(new Error(response.error))
      })
      worker.addEventListener('error', () => {
        this.rejectAll(new Error('Advisory worker crashed'))
      })
      this.worker = worker
    } catch {
      this.unavailable = true
    }
    return this.worker
  }

  private rejectAll(error: Error) {
    for (const { reject } of this.pending.values()) reject(error)
    this.pending.clear()
  }
}

export { AdvisoryClient }
