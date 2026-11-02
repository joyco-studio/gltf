import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  Bone,
  BoxGeometry,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Object3D,
  Scene,
  Skeleton,
  SkinnedMesh,
  Vector3,
} from 'three/webgpu'
import type { GLTFParser } from 'three/addons/loaders/GLTFLoader.js'

import type { InspectTarget } from '../controls/control-system'
import type { Viewer } from '../viewer'
import { SkeletonSystem } from './skeleton-system'

function createRig() {
  const root = new Group()
  const hips = new Bone()
  const spine = new Bone()
  spine.position.set(0, 1, 0)
  const head = new Bone()
  head.position.set(0, 0.5, 0)
  const headTip = new Object3D()
  headTip.position.set(0, 0.2, 0)
  hips.add(spine)
  spine.add(head)
  head.add(headTip)
  const mesh = new SkinnedMesh(new BoxGeometry(), new MeshBasicMaterial())
  root.add(hips, mesh)
  mesh.bind(new Skeleton([hips, spine, head]))
  const associations = new Map<object, { nodes: number }>([
    [hips, { nodes: 1 }],
    [spine, { nodes: 2 }],
    [head, { nodes: 3 }],
  ]) as unknown as GLTFParser['associations']
  return { root, spine, associations }
}

function setup() {
  let publishInspection: (target: InspectTarget | null) => void = () =>
    assert.fail('SkeletonSystem did not subscribe to control changes')
  const scene = new Scene()
  const system = new SkeletonSystem()
  system.init({
    scene,
    controls: {
      on: (
        _event: 'change',
        listener: (snapshot: { inspecting: InspectTarget | null }) => void
      ) => {
        publishInspection = (inspecting) => listener({ inspecting })
        return () => undefined
      },
    },
  } as unknown as Viewer)
  return { scene, system, inspect: (t: InspectTarget | null) => publishInspection(t) }
}

describe('SkeletonSystem', () => {
  it('stays unavailable for models without skins', () => {
    const { scene, system } = setup()
    system.bind(new Group(), new Map() as unknown as GLTFParser['associations'])
    system.toggle()
    assert.deepEqual(system.getSnapshot(), { available: false, visible: false })
    assert.equal(scene.getObjectByName('skeleton-bones'), undefined)
  })

  it('draws a bone per parent→child joint pair, tip empties included, and follows the pose', () => {
    const { scene, system } = setup()
    const rig = createRig()
    system.bind(rig.root, rig.associations)

    const bones = scene.getObjectByName('skeleton-bones') as InstancedMesh
    const joints = scene.getObjectByName('skeleton-joints') as InstancedMesh
    assert.equal(bones.count, 3)
    assert.equal(joints.count, 4)
    assert.deepEqual(system.getSnapshot(), { available: true, visible: false })
    assert.equal(bones.visible, false)

    system.toggle()
    assert.equal(bones.visible, true)

    rig.spine.position.set(0, 2, 0)
    system.update()
    const matrix = new Matrix4()
    joints.getMatrixAt(1, matrix)
    assert.deepEqual(
      new Vector3().setFromMatrixPosition(matrix).toArray(),
      [0, 2, 0]
    )
    bones.getMatrixAt(0, matrix)
    assert.equal(new Vector3().setFromMatrixScale(matrix).y, 2)

    system.dispose()
    assert.equal(scene.getObjectByName('skeleton-bones'), undefined)
  })

  it('reveals and tints the inspected joint', () => {
    const { scene, system, inspect } = setup()
    const rig = createRig()
    system.bind(rig.root, rig.associations)
    const joints = scene.getObjectByName('skeleton-joints') as InstancedMesh

    inspect({ kind: 'node', id: 2, name: 'spine' })
    assert.equal(system.getSnapshot().visible, true)
    const tint = new Color()
    joints.getColorAt(1, tint)
    assert.equal(tint.getHexString(), new Color('#5b7cff').getHexString())

    inspect(null)
    assert.equal(system.getSnapshot().visible, true, 'leaving keeps the overlay')
    joints.getColorAt(1, tint)
    assert.notEqual(tint.getHexString(), new Color('#5b7cff').getHexString())
  })
})
