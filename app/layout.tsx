import type { Metadata } from "next";
import { publicSans, robotoMono } from "@/lib/fonts"
import { ThemeProvider } from "@/components/theme-provider";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

const title = "GLTF | JOYCO";
const description =
  "Inspect glTF files: browse meshes, materials and textures with a three.js viewport.";

export const metadata: Metadata = {
  metadataBase: new URL("https://gltf.joyco.studio"),
  title,
  description,
  openGraph: {
    type: "website",
    title,
    description,
    siteName: "GLTF | JOYCO",
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${publicSans.variable} ${robotoMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
        <Analytics />
      </body>
    </html>
  );
}
