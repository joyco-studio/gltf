/**
 * Built-in image-based lighting choices. `room` is generated procedurally
 * (no network); the rest are CC0 Poly Haven HDRIs at 1k, which is plenty
 * for prefiltered lighting and keeps each download around 1.5 MB.
 */
const POLY_HAVEN_HDRI = (slug: string) =>
  `https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/${slug}_1k.hdr`

const ENVIRONMENT_PRESETS = [
  { id: 'room', label: 'Room', url: null },
  {
    id: 'studio',
    label: 'Studio',
    url: POLY_HAVEN_HDRI('studio_small_09'),
  },
  {
    id: 'photo-studio',
    label: 'Photo studio',
    url: POLY_HAVEN_HDRI('brown_photostudio_02'),
  },
  {
    id: 'warehouse',
    label: 'Warehouse',
    url: POLY_HAVEN_HDRI('empty_warehouse_01'),
  },
  {
    id: 'outdoor',
    label: 'Outdoor',
    url: POLY_HAVEN_HDRI('kloofendal_48d_partly_cloudy_puresky'),
  },
  { id: 'forest', label: 'Forest', url: POLY_HAVEN_HDRI('forest_slope') },
  { id: 'sunset', label: 'Sunset', url: POLY_HAVEN_HDRI('venice_sunset') },
  { id: 'night', label: 'Night', url: POLY_HAVEN_HDRI('dikhololo_night') },
] as const satisfies readonly {
  id: string
  label: string
  url: string | null
}[]

type EnvironmentPreset = (typeof ENVIRONMENT_PRESETS)[number]
type EnvironmentPresetId = EnvironmentPreset['id']

const DEFAULT_ENVIRONMENT_PRESET: EnvironmentPresetId = 'room'

function isEnvironmentPresetId(value: unknown): value is EnvironmentPresetId {
  return ENVIRONMENT_PRESETS.some(({ id }) => id === value)
}

/** Equirectangular formats an uploaded environment may use. */
const ENVIRONMENT_FILE_EXTENSIONS = ['.hdr', '.exr'] as const

function isEnvironmentFile(file: File) {
  const name = file.name.toLowerCase()
  return ENVIRONMENT_FILE_EXTENSIONS.some((extension) =>
    name.endsWith(extension)
  )
}

export {
  DEFAULT_ENVIRONMENT_PRESET,
  ENVIRONMENT_FILE_EXTENSIONS,
  ENVIRONMENT_PRESETS,
  isEnvironmentFile,
  isEnvironmentPresetId,
}
export type { EnvironmentPreset, EnvironmentPresetId }
