const GLB_MAGIC = 0x46546c67
const GLB_VERSION = 2
const JSON_CHUNK_TYPE = 0x4e4f534a
const HEADER_LENGTH = 12
const CHUNK_HEADER_LENGTH = 8

type ParseGlbResult =
  | { ok: true; json: unknown }
  | { ok: false; error: string }

type ParseGlbHeaderResult =
  | { ok: true; byteLength: number; jsonLength: number }
  | { ok: false; error: string }

function invalid(error: string): ParseGlbResult {
  return { ok: false, error }
}

function invalidHeader(error: string): ParseGlbHeaderResult {
  return { ok: false, error }
}

/** Reads the GLB 2.0 header and first chunk header without needing the BIN data. */
function parseGlbHeader(buffer: ArrayBuffer): ParseGlbHeaderResult {
  if (buffer.byteLength < HEADER_LENGTH + CHUNK_HEADER_LENGTH) {
    return invalidHeader(
      'The GLB is too short to contain a header and JSON chunk.'
    )
  }

  const view = new DataView(buffer)
  if (view.getUint32(0, true) !== GLB_MAGIC) {
    return invalidHeader(
      'The payload does not have a valid glTF binary header.'
    )
  }

  if (view.getUint32(4, true) !== GLB_VERSION) {
    return invalidHeader('Only GLB container version 2 is supported.')
  }

  const byteLength = view.getUint32(8, true)

  const jsonLength = view.getUint32(HEADER_LENGTH, true)
  const jsonType = view.getUint32(HEADER_LENGTH + 4, true)
  if (jsonType !== JSON_CHUNK_TYPE) {
    return invalidHeader(
      'The first GLB chunk is not structured JSON content.'
    )
  }

  if (jsonLength % 4 !== 0) {
    return invalidHeader(
      'The GLB JSON chunk is not aligned to a 4-byte boundary.'
    )
  }

  const jsonStart = HEADER_LENGTH + CHUNK_HEADER_LENGTH
  if (jsonStart + jsonLength > byteLength) {
    return invalidHeader(
      'The GLB JSON chunk extends beyond the payload length.'
    )
  }

  return { ok: true, byteLength, jsonLength }
}

/** Parses the raw structured JSON bytes from a GLB 2.0 container. */
function parseGlbJsonChunk(buffer: ArrayBuffer): ParseGlbResult {
  const jsonText = new TextDecoder().decode(buffer)

  try {
    return { ok: true, json: JSON.parse(jsonText.trimEnd()) }
  } catch {
    return invalid('The GLB JSON chunk does not contain valid JSON.')
  }
}

/** Extracts and parses the structured JSON chunk from a complete GLB. */
function parseGlbJson(buffer: ArrayBuffer): ParseGlbResult {
  const header = parseGlbHeader(buffer)
  if (!header.ok) return header

  if (header.byteLength !== buffer.byteLength) {
    return invalid('The GLB header length does not match the payload length.')
  }

  const jsonStart = HEADER_LENGTH + CHUNK_HEADER_LENGTH
  return parseGlbJsonChunk(buffer.slice(jsonStart, jsonStart + header.jsonLength))
}

export { parseGlbHeader, parseGlbJson, parseGlbJsonChunk }
export type { ParseGlbHeaderResult, ParseGlbResult }
