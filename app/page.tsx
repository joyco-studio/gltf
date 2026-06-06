import type { Metadata } from "next";

import { ViewerApp } from "@/components/viewer/viewer-app";

export const metadata: Metadata = {
  title: "glTF Visualizer",
  description:
    "Inspect glTF files: browse meshes, materials and textures with a three.js viewport.",
};

export default function Home() {
  return <ViewerApp />;
}
