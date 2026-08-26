import { Suspense } from "react";

import { ViewerApp } from "@/components/viewer/viewer-app";

export default function Home() {
  return (
    <Suspense>
      <ViewerApp />
    </Suspense>
  );
}
