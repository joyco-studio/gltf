import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicNodeMaterial,
  Quaternion,
  SkinnedMesh,
  SphereGeometry,
  Vector3,
  type Object3D,
} from 'three/webgpu'
import { normalView, vec3 } from 'three/tsl'
import type { GLTFParser } from 'three/addons/loaders/GLTFLoader.js'

import type { InspectTarget } from '../controls/control-system'
import { Disposer } from '../disposer'
import { EventEmitter } from '../event-emitter'
import type { System } from '../system'
import type { Viewer } from '../viewer'

interface SkeletonSnapshot {
  /** Whether the loaded model has any skin joints to draw. */
  available: boolean
  visible: boolean
}

interface Segment {
  parent: number
  child: number
}

const EMPTY_SNAPSHOT: SkeletonSnapshot = { available: false, visible: false }

const BONE_COLOR = new Color('#d4d4d8')
const JOINT_COLOR = new Color('#a1a1aa')
const SELECTED_COLOR = new Color('#5b7cff')
/** Octahedron waist half-width relative to bone length (Blender's proportions). */
const BONE_WIDTH = 0.1
/** Where along the bone the waist sits. */
const BONE_WAIST = 0.12
/** Joint sphere radius relative to the shortest bone touching it. */
const JOINT_RADIUS = 0.08
/** Fallback joint radius relative to the skeleton's extent (lone joints). */
const LONE_JOINT_RADIUS = 0.01
// X-ray overlay: drawn over the model, joints over bones
const BONE_RENDER_ORDER = 997
const JOINT_RENDER_ORDER = 998

const UP = new Vector3(0, 1, 0)
const IDENTITY = new Quaternion()

/** Unit Blender-style bone: head at the origin, tail at +Y, flat-shaded. */
function createBoneGeometry() {
  const head = [0, 0, 0]
  const tail = [0, 1, 0]
  const ring = [
    [1, BONE_WAIST, 0],
    [0, BONE_WAIST, -1],
    [-1, BONE_WAIST, 0],
    [0, BONE_WAIST, 1],
  ]
  const positions: number[] = []
  for (let i = 0; i < 4; i += 1) {
    const a = ring[i]
    const b = ring[(i + 1) % 4]
    positions.push(...head, ...b, ...a, ...tail, ...a, ...b)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.computeVertexNormals()
  return geometry
}

/**
 * Unlit, facet-shaded overlay material. Convex shapes with back-face culling
 * read correctly without depth testing, so the rig stays visible through the
 * skin it deforms. Per-instance colors tint the shading.
 */
function createOverlayMaterial() {
  const material = new MeshBasicNodeMaterial({
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  })
  material.colorNode = vec3(normalView.z.abs().mul(0.45).add(0.55))
  return material
}

/**
 * Draws the skin joints of the loaded model as Blender-style octahedral bones
 * (parent joint → child joint) with spheres on every joint, re-posed every
 * frame so animated rigs stay in sync. The inspected joint and the bones it
 * drives are tinted; inspecting a joint reveals the overlay, since joints have
 * no geometry of their own.
 */
class SkeletonSystem
  extends EventEmitter<{ change: SkeletonSnapshot }>
  implements System
{
  private viewer!: Viewer
  private disposer = new Disposer()
  private modelDisposer = new Disposer()
  private boneGeometry = this.disposer.add(createBoneGeometry())
  private jointGeometry = this.disposer.add(new SphereGeometry(1, 12, 8))
  private material = this.disposer.add(createOverlayMaterial())

  private root: Object3D | null = null
  /** Skin joints plus their tip empties, indexed like the joint instances. */
  private bones: Object3D[] = []
  private segments: Segment[] = []
  private jointRadii: number[] = []
  private nodeToBone = new Map<number, number>()
  private boneMesh: InstancedMesh | null = null
  private jointMesh: InstancedMesh | null = null
  private selected = -1
  private inspecting: InspectTarget | null = null
  private snapshot: SkeletonSnapshot = EMPTY_SNAPSHOT

  private matrix = new Matrix4()
  private quaternion = new Quaternion()
  private scale = new Vector3()
  private direction = new Vector3()
  private positions: Vector3[] = []

  init(viewer: Viewer) {
    this.viewer = viewer
    this.disposer.add(
      viewer.controls.on('change', ({ inspecting }) => this.sync(inspecting))
    )
  }

  getSnapshot(): SkeletonSnapshot {
    return this.snapshot
  }

  setVisible(visible: boolean) {
    if (!this.snapshot.available || this.snapshot.visible === visible) return
    this.setMeshesVisible(visible)
    this.publish({ visible })
  }

  toggle() {
    this.setVisible(!this.snapshot.visible)
  }

  /** Adopt the skin joints of a freshly loaded model (replaces any previous). */
  bind(root: Object3D, associations: GLTFParser['associations']) {
    this.modelDisposer.dispose()
    this.modelDisposer = new Disposer()
    this.root = root
    this.selected = -1
    this.inspecting = null
    this.nodeToBone.clear()

    const joints = new Set<Object3D>()
    root.traverse((object) => {
      if (object instanceof SkinnedMesh) {
        for (const bone of object.skeleton.bones) if (bone) joints.add(bone)
      }
    })
    // Exporters (Mixamo, Blender) append empties as bone tips, and unweighted
    // bones export as plain nodes — not skin joints, but without them heads
    // and fingers lose their last bones. Follow empty chains below joints.
    const addTips = (object: Object3D) => {
      for (const child of object.children) {
        if (child.type !== 'Object3D' || joints.has(child)) continue
        joints.add(child)
        addTips(child)
      }
    }
    for (const joint of [...joints]) addTips(joint)
    this.bones = [...joints]
    this.positions = this.bones.map(() => new Vector3())
    const index = new Map(this.bones.map((bone, i) => [bone, i]))
    this.segments = []
    this.bones.forEach((bone, i) => {
      const parent = bone.parent ? index.get(bone.parent) : undefined
      if (parent !== undefined) this.segments.push({ parent, child: i })
      const nodeId = associations.get(bone)?.nodes
      if (nodeId !== undefined) this.nodeToBone.set(nodeId, i)
    })

    const available = this.bones.length > 0
    if (available) {
      this.measureJoints()
      this.boneMesh = this.createMesh(
        this.boneGeometry,
        this.segments.length,
        BONE_RENDER_ORDER,
        'skeleton-bones'
      )
      this.jointMesh = this.createMesh(
        this.jointGeometry,
        this.bones.length,
        JOINT_RENDER_ORDER,
        'skeleton-joints'
      )
      this.paint()
      this.setMeshesVisible(this.snapshot.visible)
    }
    this.publish({ available, visible: available && this.snapshot.visible })
  }

  /** Size joints from the rest pose so fingers and spines both read clearly. */
  private measureJoints() {
    this.root?.updateWorldMatrix(true, true)
    this.readPositions()

    const shortest = this.bones.map(() => Infinity)
    const lengths: number[] = []
    for (const { parent, child } of this.segments) {
      const length = this.positions[parent].distanceTo(this.positions[child])
      if (length <= 1e-6) continue
      lengths.push(length)
      shortest[parent] = Math.min(shortest[parent], length)
      shortest[child] = Math.min(shortest[child], length)
    }

    let extent = 0
    for (const position of this.positions)
      extent = Math.max(extent, position.distanceTo(this.positions[0]))
    const fallback =
      lengths.length > 0
        ? Math.min(...lengths) * JOINT_RADIUS
        : Math.max(extent * LONE_JOINT_RADIUS, 0.01)
    this.jointRadii = shortest.map((length) =>
      Number.isFinite(length) ? length * JOINT_RADIUS : fallback
    )
  }

  private createMesh(
    geometry: BufferGeometry,
    count: number,
    renderOrder: number,
    name: string
  ) {
    const mesh = new InstancedMesh(geometry, this.material, count)
    mesh.name = name
    mesh.renderOrder = renderOrder
    // instances move every frame — a cached bounding sphere would go stale
    mesh.frustumCulled = false
    this.viewer.scene.add(mesh)
    this.modelDisposer.add(() => {
      mesh.removeFromParent()
      mesh.dispose()
    })
    return mesh
  }

  private setMeshesVisible(visible: boolean) {
    if (this.boneMesh) this.boneMesh.visible = visible
    if (this.jointMesh) this.jointMesh.visible = visible
    if (visible) this.pose()
  }

  /** Track the joint inspected from the hierarchy or picked in the viewport. */
  private sync(inspecting: InspectTarget | null) {
    const newInspection = inspecting !== this.inspecting
    this.inspecting = inspecting
    const selected =
      inspecting?.kind === 'node'
        ? (this.nodeToBone.get(inspecting.id) ?? -1)
        : -1
    if (newInspection && selected !== -1) this.setVisible(true)
    if (selected === this.selected) return
    this.selected = selected
    this.paint()
  }

  /** Tint the selected joint and the bones it heads. */
  private paint() {
    if (!this.boneMesh || !this.jointMesh) return
    this.bones.forEach((_, i) => {
      this.jointMesh!.setColorAt(
        i,
        i === this.selected ? SELECTED_COLOR : JOINT_COLOR
      )
    })
    this.segments.forEach(({ parent }, i) => {
      this.boneMesh!.setColorAt(
        i,
        parent === this.selected ? SELECTED_COLOR : BONE_COLOR
      )
    })
    if (this.jointMesh.instanceColor) this.jointMesh.instanceColor.needsUpdate = true
    if (this.boneMesh.instanceColor) this.boneMesh.instanceColor.needsUpdate = true
  }

  private readPositions() {
    this.bones.forEach((bone, i) =>
      this.positions[i].setFromMatrixPosition(bone.matrixWorld)
    )
  }

  /** Re-pose every instance from the joints' current world transforms. */
  private pose() {
    if (!this.root || !this.boneMesh || !this.jointMesh) return
    // animations ran this frame, but world matrices refresh only at render
    this.root.updateWorldMatrix(true, true)
    this.readPositions()

    this.positions.forEach((position, i) => {
      this.scale.setScalar(this.jointRadii[i])
      this.matrix.compose(position, IDENTITY, this.scale)
      this.jointMesh!.setMatrixAt(i, this.matrix)
    })

    this.segments.forEach(({ parent, child }, i) => {
      const head = this.positions[parent]
      this.direction.subVectors(this.positions[child], head)
      const length = this.direction.length()
      if (length > 1e-6) {
        this.quaternion.setFromUnitVectors(UP, this.direction.divideScalar(length))
      }
      this.scale.set(length * BONE_WIDTH, length, length * BONE_WIDTH)
      this.matrix.compose(head, this.quaternion, this.scale)
      this.boneMesh!.setMatrixAt(i, this.matrix)
    })

    this.jointMesh.instanceMatrix.needsUpdate = true
    this.boneMesh.instanceMatrix.needsUpdate = true
  }

  update() {
    if (this.snapshot.visible) this.pose()
  }

  private publish(partial: Partial<SkeletonSnapshot>) {
    const next = { ...this.snapshot, ...partial }
    if (
      next.available === this.snapshot.available &&
      next.visible === this.snapshot.visible
    ) {
      return
    }
    this.snapshot = next
    this.emit('change', next)
  }

  dispose() {
    try {
      this.modelDisposer.dispose()
      this.disposer.dispose()
    } finally {
      this.root = null
      this.bones = []
      this.clear()
    }
  }
}

export { SkeletonSystem, EMPTY_SNAPSHOT as EMPTY_SKELETON_SNAPSHOT }
export type { SkeletonSnapshot }
