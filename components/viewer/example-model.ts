/** The bundled showcase model offered from the empty state. */
const EXAMPLE_MODEL = {
  url: 'https://r2.joyco.studio/models/littlest-tokyo.glb',
  name: 'Littlest Tokyo',
  credit: 'https://www.artstation.com/artwork/1AGwX',
  artist: 'Glen Fox',
  // this asset is authored at a huge scale (~550 units) — shrink it to a
  // sane size...
  scale: 0.02,
  // ...then offset it in world units, unaffected by the scale above
  position: [0, 3.98, 0],
} as const

export { EXAMPLE_MODEL }
