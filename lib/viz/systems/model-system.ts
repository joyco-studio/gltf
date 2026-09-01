import {
  Box3,
  Camera,
  Euler,
  Group,
  Material,
  Mesh,
  Quaternion,
  REVISION,
  Texture,
  Vector3,
  type LoadingManager,
  type Object3D,
} from 'three/webgpu'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'

import type { InspectTarget } from '../controls/control-system'
import { createGltfFileSet } from '../file-set'
import type { System } from '../system'
import type { Viewer } from '../viewer'

const DRACO_DECODER_PATH =
  'https://www.gstatic.com/draco/versioned/decoders/1.5.7/'
const KTX2_TRANSCODER_PATH = `https://cdn.jsdelivr.net/npm/three@0.${REVISION}.0/examples/jsm/libs/basis/`

interface LoadedModel {
  gltf: GLTF
  root: Object3D
  fileName: string
}

/**
 * Optional placement for a loaded model. `scale` resizes the asset (handy for
 * models authored at extreme scales); `position` is a world-space offset that
 * is independent of `scale` — a node's translation lives in parent space, so
 * scaling the root never multiplies its own offset.
 */
interface ModelTransform {
  position?: readonly [number, number, number]
  scale?: number
}

type Vector3Tuple = readonly [number, number, number]

interface ElementTransform {
  position: Vector3Tuple
  /** XYZ Euler angles in radians. */
  rotation: Vector3Tuple
  scale: Vector3Tuple
}

interface ElementTransformInfo {
  local: ElementTransform | null
  world: ElementTransform
  bounds: { center: Vector3Tuple; size: Vector3Tuple } | null
  /** Custom metadata attached to the representative runtime object. */
  userData: Record<string, unknown>
  /** Number of runtime mesh primitives represented by this selection. */
  renderables: number
}

interface ElementWorldTransform {
  position: Vector3
  quaternion: Quaternion
}

function tuple(vector: Vector3): Vector3Tuple {
  return [vector.x, vector.y, vector.z]
}

function transformFromObject(object: Object3D, world: boolean): ElementTransform {
  const position = new Vector3()
  const quaternion = new Quaternion()
  const scale = new Vector3()

  if (world) object.matrixWorld.decompose(position, quaternion, scale)
  else {
    position.copy(object.position)
    quaternion.copy(object.quaternion)
    scale.copy(object.scale)
  }

  const rotation = new Euler().setFromQuaternion(quaternion, 'XYZ')
  return {
    position: tuple(position),
    rotation: [rotation.x, rotation.y, rotation.z],
    scale: tuple(scale),
  }
}

function disposeMaterial(material: Material) {
  for (const value of Object.values(material)) {
    if (value instanceof Texture) value.dispose()
  }
  material.dispose()
}

function disposeObject(root: Object3D) {
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return
    object.geometry.dispose()
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material]
    materials.forEach(disposeMaterial)
  })
}

/**
 * Owns the currently loaded glTF: loading (with draco/ktx2/meshopt support),
 * swapping into the scene, and disposing GPU resources of the previous model.
 */
class ModelSystem implements System {
  current: LoadedModel | null = null

  private viewer!: Viewer
  private container = new Group()
  private dracoLoader: DRACOLoader | null = null
  private ktx2Loader: KTX2Loader | null = null
  private loadId = 0

  init(viewer: Viewer) {
    this.viewer = viewer
    this.container.name = 'model-container'
    viewer.scene.add(this.container)
  }

  private async createLoader(manager?: LoadingManager) {
    // KTX2 support detection inspects the backend — renderer must be ready
    await this.viewer.render.whenReady

    if (!this.dracoLoader) {
      this.dracoLoader = new DRACOLoader().setDecoderPath(DRACO_DECODER_PATH)
    }
    if (!this.ktx2Loader) {
      this.ktx2Loader = new KTX2Loader()
        .setTranscoderPath(KTX2_TRANSCODER_PATH)
        .detectSupport(this.viewer.render.renderer)
    }

    const loader = new GLTFLoader(manager)
    loader.setDRACOLoader(this.dracoLoader)
    loader.setKTX2Loader(this.ktx2Loader)
    loader.setMeshoptDecoder(MeshoptDecoder)
    return loader
  }

  /** Load a glTF from user-provided files (drag & drop / file picker). */
  async loadFiles(files: File[]) {
    const fileSet = createGltfFileSet(files)
    if (!fileSet) {
      throw new Error('No .glb or .gltf file found in the dropped files.')
    }

    const loadId = ++this.loadId
    const loader = await this.createLoader(fileSet.manager)

    try {
      const gltf = await loader.loadAsync(fileSet.rootUrl)
      // A newer load won the race — discard this one.
      if (loadId !== this.loadId) {
        disposeObject(gltf.scene)
        return null
      }
      return this.swap(gltf, fileSet.rootFile.name)
    } finally {
      fileSet.revoke()
    }
  }

  async loadUrl(url: string, transform?: ModelTransform) {
    const loadId = ++this.loadId
    const loader = await this.createLoader()
    const gltf = await loader.loadAsync(url)
    if (loadId !== this.loadId) {
      disposeObject(gltf.scene)
      return null
    }
    return this.swap(gltf, url.split('/').pop() ?? url, transform)
  }

  private get associations() {
    return this.current?.gltf.parser.associations
  }

  private collectMeshes(predicate: (mesh: Mesh) => boolean): Mesh[] {
    if (!this.current) return []
    const meshes: Mesh[] = []
    this.current.root.traverse((object) => {
      if (object instanceof Mesh && predicate(object)) meshes.push(object)
    })
    return meshes
  }

  private materialsOf(mesh: Mesh): Material[] {
    return Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  }

  /** glTF document index of a runtime material, if it came from the file. */
  getMaterialId(material: Material): number | undefined {
    return this.associations?.get(material)?.materials
  }

  /** Whether a runtime material samples the glTF texture with this index. */
  materialUsesTexture(material: Material, textureId: number): boolean {
    for (const value of Object.values(material)) {
      if (
        value instanceof Texture &&
        this.associations?.get(value)?.textures === textureId
      ) {
        return true
      }
    }
    return false
  }

  /**
   * Every renderable belonging to a glTF mesh (by document mesh index, via
   * the parser's object associations).
   */
  getMeshObjects(meshId: number): Mesh[] {
    return this.collectMeshes(
      (mesh) => this.associations?.get(mesh)?.meshes === meshId
    )
  }

  /** Every renderable nested under one exact glTF scene node. */
  getMeshesForNode(nodeId: number): Mesh[] {
    if (!this.current) return []

    const meshes = new Set<Mesh>()
    this.current.root.traverse((object) => {
      if (this.associations?.get(object)?.nodes !== nodeId) return
      object.traverse((child) => {
        if (child instanceof Mesh) meshes.add(child)
      })
    })
    return [...meshes]
  }

  /** Every renderable with at least one primitive using a glTF material. */
  getMeshesUsingMaterial(materialId: number): Mesh[] {
    return this.collectMeshes((mesh) =>
      this.materialsOf(mesh).some(
        (material) => this.getMaterialId(material) === materialId
      )
    )
  }

  /** Every renderable whose material(s) sample a glTF texture. */
  getMeshesUsingTexture(textureId: number): Mesh[] {
    return this.collectMeshes((mesh) =>
      this.materialsOf(mesh).some((material) =>
        this.materialUsesTexture(material, textureId)
      )
    )
  }

  /** Every renderable in the current model. */
  getAllMeshes(): Mesh[] {
    return this.collectMeshes(() => true)
  }

  /**
   * Exact glTF node owning a raycast hit. Multi-primitive meshes associate
   * their node index with the parent group, so walk upward from the primitive.
   */
  getNodeTargetForObject(
    object: Object3D
  ): (InspectTarget & { kind: 'node' }) | null {
    let current: Object3D | null = object
    while (current) {
      const id = this.associations?.get(current)?.nodes
      if (id !== undefined) {
        const json = this.current?.gltf.parser.json as
          | {
              meshes?: { name?: string }[]
              nodes?: { mesh?: number; name?: string }[]
            }
          | undefined
        const node = json?.nodes?.[id]
        const meshName =
          node?.mesh !== undefined ? json?.meshes?.[node.mesh]?.name : undefined
        return {
          kind: 'node',
          id,
          name: node?.name?.trim() || meshName || `node_${id}`,
        }
      }
      current = current.parent
    }
    return null
  }

  /** Exact runtime object created for a glTF node definition. */
  private getNodeObject(nodeId: number): Object3D | null {
    if (!this.current) return null

    let match: Object3D | null = null
    this.current.root.traverse((object) => {
      if (!match && this.associations?.get(object)?.nodes === nodeId) {
        match = object
      }
    })
    return match
  }

  /** Runtime camera attached to an exact glTF node, if it defines one. */
  getCameraForNode(nodeId: number): Camera | null {
    const json = this.current?.gltf.parser.json as
      | { nodes?: { camera?: number }[] }
      | undefined
    if (json?.nodes?.[nodeId]?.camera === undefined) return null

    const node = this.getNodeObject(nodeId)
    if (!node) return null
    if (node instanceof Camera) return node

    let camera: Camera | null = null
    node.traverse((object) => {
      if (!camera && object instanceof Camera) camera = object
    })
    return camera
  }

  /** Runtime object whose origin and orientation represent this element. */
  private getElementObject(target: {
    kind: 'node' | 'mesh'
    id: number
  }): Object3D | null {
    return target.kind === 'node'
      ? this.getNodeObject(target.id)
      : (this.getMeshObjects(target.id)[0] ?? null)
  }

  /** Exact world-space origin and orientation of a node or representative mesh. */
  getElementWorldTransform(target: {
    kind: 'node' | 'mesh'
    id: number
  }): ElementWorldTransform | null {
    const object = this.getElementObject(target)
    if (!object) return null

    this.current?.root.updateWorldMatrix(true, true)
    return {
      position: object.getWorldPosition(new Vector3()),
      quaternion: object.getWorldQuaternion(new Quaternion()),
    }
  }

  /**
   * Read-only transform data for the element details UI. A glTF node has one
   * exact local transform; a mesh is a reusable resource, so its world
   * transform is represented by the first runtime primitive while bounds span
   * every instance.
   */
  getElementTransformInfo(target: {
    kind: 'node' | 'mesh'
    id: number
  }): ElementTransformInfo | null {
    if (!this.current) return null

    const renderables =
      target.kind === 'node'
        ? this.getMeshesForNode(target.id)
        : this.getMeshObjects(target.id)
    const object = this.getElementObject(target)
    if (!object) return null

    this.current.root.updateWorldMatrix(true, true)
    const box = this.getWorldBoxOfMeshes(renderables)

    return {
      local: target.kind === 'node' ? transformFromObject(object, false) : null,
      world: transformFromObject(object, true),
      bounds: box
        ? {
            center: tuple(box.getCenter(new Vector3())),
            size: tuple(box.getSize(new Vector3())),
          }
        : null,
      userData: object.userData,
      renderables: renderables.length,
    }
  }

  /** Renderables an inspect target resolves to. */
  getMeshesForTarget(target: InspectTarget): Mesh[] {
    switch (target.kind) {
      case 'node':
        return this.getMeshesForNode(target.id)
      case 'mesh':
        return this.getMeshObjects(target.id)
      case 'material':
        return this.getMeshesUsingMaterial(target.id)
      case 'texture':
        return this.getMeshesUsingTexture(target.id)
    }
  }

  /** Combined world-space bounding box of a set of renderables. */
  getWorldBoxOfMeshes(meshes: Mesh[]): Box3 | null {
    if (meshes.length === 0) return null

    this.current?.root.updateWorldMatrix(true, true)
    const box = new Box3()
    for (const mesh of meshes) box.expandByObject(mesh)
    return box.isEmpty() ? null : box
  }

  /**
   * Representative world orientation of a set of renderables — the first
   * mesh's. For a single glTF mesh every primitive shares the node, so this
   * is exact; for a material/texture span it's a reasonable stand-in.
   */
  getWorldOrientationOfMeshes(meshes: Mesh[]): Quaternion | null {
    const mesh = meshes[0]
    if (!mesh) return null
    this.current?.root.updateWorldMatrix(true, true)
    return mesh.getWorldQuaternion(new Quaternion())
  }

  private swap(gltf: GLTF, fileName: string, transform?: ModelTransform) {
    if (this.current) {
      this.container.remove(this.current.root)
      disposeObject(this.current.root)
    }

    // Resize then offset, applied before framing so the camera fits the model
    // where it ends up. position is parent-space, so it stays in world units
    // regardless of scale (T·R·S — scale never touches the node's own offset).
    if (transform?.scale !== undefined) gltf.scene.scale.setScalar(transform.scale)
    if (transform?.position) gltf.scene.position.fromArray(transform.position)
    this.container.add(gltf.scene)
    this.current = { gltf, root: gltf.scene, fileName }
    this.viewer.controls.frame(gltf.scene)
    this.viewer.animations.bind(gltf.animations ?? [], gltf.scene)
    return this.current
  }

  dispose() {
    if (this.current) {
      disposeObject(this.current.root)
      this.current = null
    }
    this.dracoLoader?.dispose()
    this.ktx2Loader?.dispose()
  }
}

export { ModelSystem }
export type {
  ElementTransform,
  ElementTransformInfo,
  LoadedModel,
  ModelTransform,
  Vector3Tuple,
}
