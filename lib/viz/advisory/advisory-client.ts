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
    {
      resolve: (value: never) => void
      reject: (error: Error) => void
      /** Re-runs the job on this thread if the worker dies. */
      inline: () => Promise<unknown>
    }
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
      this.pending.set(id, {
        resolve: resolve as (value: never) => void,
        reject,
        inline,
      })
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
      // A worker that fails to load (or crashes) never answers: drop it for
      // good and finish its in-flight jobs on this thread instead.
      const fail = () => {
        if (this.worker !== worker) return
        worker.terminate()
        this.worker = null
        this.unavailable = true
        const pending = [...this.pending.values()]
        this.pending.clear()
        for (const job of pending) {
          job.inline().then(job.resolve as (value: unknown) => void, job.reject)
        }
      }
      worker.addEventListener('error', fail)
      worker.addEventListener('messageerror', fail)
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
