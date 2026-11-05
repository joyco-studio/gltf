/// <reference lib="webworker" />
import {
  runCoverageJob,
  runDownloadJob,
  type CoverageJobResult,
  type DownloadJobInput,
  type DownloadJobResult,
} from './advisory-jobs'
import type { CoverageInput } from './uv-coverage'

type AdvisoryRequest =
  | { id: number; type: 'coverage'; input: CoverageInput }
  | { id: number; type: 'download'; input: DownloadJobInput }

type AdvisoryResponse =
  | { id: number; ok: true; result: CoverageJobResult | DownloadJobResult }
  | { id: number; ok: false; error: string }

const scope = self as unknown as DedicatedWorkerGlobalScope

scope.addEventListener('message', async (event: MessageEvent<AdvisoryRequest>) => {
  const request = event.data
  try {
    const result =
      request.type === 'coverage'
        ? await runCoverageJob(request.input)
        : await runDownloadJob(request.input)
    const transfer = 'mask' in result ? [result.mask.buffer] : []
    scope.postMessage({ id: request.id, ok: true, result } satisfies AdvisoryResponse, transfer)
  } catch (error) {
    scope.postMessage({
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    } satisfies AdvisoryResponse)
  }
})

export type { AdvisoryRequest, AdvisoryResponse }
