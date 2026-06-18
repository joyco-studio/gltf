import * as React from "react";

import { cn } from "@/lib/utils";

/** The chunky "GLTF" wordmark used on the landing card. Fills with currentColor. */
function GltfWordmark({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <svg
      viewBox="0 0 477.649 89.7354"
      fill="none"
      role="img"
      aria-label="GLTF"
      className={cn("h-auto w-full", className)}
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        d="M33.9089 0.473291L0.003634 34.3776L0.00363548 0.473289L0.00265892 0.473289L0.00265503 89.4879L73.7146 89.4879L112.596 49.445L112.596 89.4879L145.868 89.4879L145.868 41.3307L113.651 41.3307L95.0124 60.2477L95.0124 60.2555L23.5632 60.2555L23.5632 33.9928L145.868 33.9928L145.868 33.9909L111.25 33.9909L145.868 0.52603L145.868 0.473296L33.9089 0.473291Z"
        fill="currentColor"
      />
      <path
        d="M477.612 28.4248H399.63V41.8936H399.873V63.3965L421.376 41.8936H477.649V70.3184H399.63V89.7354H365.444V0.0576172H369.148V0H477.612V28.4248Z"
        fill="currentColor"
      />
      <path
        d="M193.316 86.1329L221.144 58.7139H254.337V89.6114L160.486 89.6104H159.328V0.00785517H193.316V86.1329Z"
        fill="currentColor"
      />
      <path
        d="M352.872 34.4145H305.125V89.3149H271.636V58.4789L295.7 34.4145H222.715V0.00530191H352.872V34.4145ZM305.193 31.4242V0.00627847H274.525L305.193 31.4242Z"
        fill="currentColor"
      />
    </svg>
  );
}

/** Just the "G" glyph from the wordmark, for use as a large standalone mark. */
function GltfGlyph({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <svg
      viewBox="0 0 145.868 89.488"
      fill="none"
      role="img"
      aria-label="GLTF"
      className={cn("h-auto w-full", className)}
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        d="M33.9089 0.473291L0.003634 34.3776L0.00363548 0.473289L0.00265892 0.473289L0.00265503 89.4879L73.7146 89.4879L112.596 49.445L112.596 89.4879L145.868 89.4879L145.868 41.3307L113.651 41.3307L95.0124 60.2477L95.0124 60.2555L23.5632 60.2555L23.5632 33.9928L145.868 33.9928L145.868 33.9909L111.25 33.9909L145.868 0.52603L145.868 0.473296L33.9089 0.473291Z"
        fill="currentColor"
      />
    </svg>
  );
}

export { GltfWordmark, GltfGlyph };
