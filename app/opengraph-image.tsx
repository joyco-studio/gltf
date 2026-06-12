import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Image metadata
export const alt = "GLTF — Preview .gltf & .glb files. By JOYCO.STUDIO";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

// Brand palette
const BG = "#0a0a0a";
const PANEL = "#161616";
const LINE = "#1f1f1f";
const MUTED = "#6b6b6b";
const BLUE = "#1d1dff";

/**
 * GLTF logotype reconstructed in JOYCO's geometric, 45°-chamfered display
 * style (same language as the JOYCO wordmark in `components/logo.tsx`).
 * Drawn on a 746×250 grid, stroke ≈ 54, chamfer ≈ 54 on each top-left.
 */
function GltfWordmark({ height }: { height: number }) {
  const W = 890;
  const H = 250;
  return (
    <svg
      width={(height * W) / H}
      height={height}
      viewBox={`0 0 ${W} ${H}`}
      fill="#ffffff"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* G — chamfered "C" + right vertical + left-pointing crossbar */}
      <g>
        <path d="M54 0 L200 0 L200 54 L54 54 L54 196 L200 196 L200 250 L0 250 L0 54 Z" />
        <path d="M146 123 L200 123 L200 250 L146 250 Z" />
        <path d="M120 123 L200 123 L200 177 L120 177 Z" />
      </g>
      {/* L */}
      <g transform="translate(254 0)">
        <path d="M54 0 L54 196 L168 196 L168 250 L0 250 L0 54 Z" />
      </g>
      {/* T */}
      <g transform="translate(476 0)">
        <path d="M54 0 L192 0 L192 54 L123 54 L123 250 L69 250 L69 54 L0 54 Z" />
      </g>
      {/* F */}
      <g transform="translate(722 0)">
        <path d="M54 0 L168 0 L168 54 L54 54 L54 98 L150 98 L150 152 L54 152 L54 250 L0 250 L0 54 Z" />
      </g>
    </svg>
  );
}

/**
 * JOYCO corner mark — the "J/arrow" glyph from the brand wordmark
 * (`components/logo.tsx`), shown knocked out of a white tab.
 */
function JoycoMark() {
  return (
    <div
      style={{
        display: "flex",
        background: "#ffffff",
        padding: "14px 18px",
      }}
    >
      <svg
        width={64}
        height={51}
        viewBox="0 0 143 89"
        fill={BG}
        xmlns="http://www.w3.org/2000/svg"
      >
        <path d="M33.4072 0.461909L2.37382e-06 33.8691L0 88.1758L72.626 88.1758L110.944 48.7129L110.944 88.1758L143.732 88.1758L143.732 40.7207L111.992 40.7207L93.6191 59.3682L93.6191 59.3691L23.2139 59.3691L23.2148 33.4902L109.626 33.4902L143.732 0.520508L143.732 0.461914L33.4072 0.461909Z" />
      </svg>
    </div>
  );
}

export default async function Image() {
  const [mono, monoBold] = await Promise.all([
    readFile(join(process.cwd(), "assets/RobotoMono-Regular.ttf")),
    readFile(join(process.cwd(), "assets/RobotoMono-Bold.ttf")),
  ]);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: BG,
          fontFamily: "Roboto Mono",
          position: "relative",
        }}
      >
        {/* Grid hairlines */}
        {[64, 540, 1010, 1136].map((x) => (
          <div
            key={`v${x}`}
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: x,
              width: 1,
              background: LINE,
            }}
          />
        ))}
        {[120, 300, 570].map((y) => (
          <div
            key={`h${y}`}
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: y,
              height: 1,
              background: LINE,
            }}
          />
        ))}

        {/* Top-left label */}
        <div
          style={{
            position: "absolute",
            left: 64,
            top: 58,
            display: "flex",
            flexDirection: "column",
            background: PANEL,
            padding: "14px 20px",
          }}
        >
          <div
            style={{
              fontSize: 26,
              letterSpacing: 1,
              color: MUTED,
            }}
          >
            PREVIEW .GLTF & .GLB
          </div>
          <div
            style={{
              fontSize: 26,
              letterSpacing: 1,
              color: "#ffffff",
              fontWeight: 700,
            }}
          >
            BY JOYCO.STUDIO
          </div>
        </div>

        {/* Top-right JOYCO mark */}
        <div style={{ position: "absolute", top: 48, right: 64, display: "flex" }}>
          <JoycoMark />
        </div>

        {/* Blue band with GLTF wordmark */}
        <div
          style={{
            position: "absolute",
            top: 300,
            left: 0,
            right: 0,
            height: 270,
            background: BLUE,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <GltfWordmark height={250} />
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Roboto Mono", data: mono, style: "normal", weight: 400 },
        { name: "Roboto Mono", data: monoBold, style: "normal", weight: 700 },
      ],
    }
  );
}
