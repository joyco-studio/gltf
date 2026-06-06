import {
  Group,
  Material,
  Mesh,
  REVISION,
  Texture,
  type LoadingManager,
  type Object3D,
} from 'three'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'

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

  private createLoader(manager?: LoadingManager) {
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
    const loader = this.createLoader(fileSet.manager)

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

  async loadUrl(url: string) {
    const loadId = ++this.loadId
    const loader = this.createLoader()
    const gltf = await loader.loadAsync(url)
    if (loadId !== this.loadId) {
      disposeObject(gltf.scene)
      return null
    }
    return this.swap(gltf, url.split('/').pop() ?? url)
  }

  private swap(gltf: GLTF, fileName: string) {
    if (this.current) {
      this.container.remove(this.current.root)
      disposeObject(this.current.root)
    }

    this.container.add(gltf.scene)
    this.current = { gltf, root: gltf.scene, fileName }
    this.viewer.controls.frame(gltf.scene)
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
export type { LoadedModel }
