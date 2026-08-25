import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const alt = "Fiszy — pierwsza aukcja nadchodzi";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpenGraphImage() {
  const [regularFont, boldFont] = await Promise.all([
    readFile(join(process.cwd(), "node_modules/geist/dist/fonts/geist-sans/Geist-Regular.ttf")),
    readFile(join(process.cwd(), "node_modules/geist/dist/fonts/geist-sans/Geist-UltraBlack.ttf")),
  ]);
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "72px",
        background: "#050507",
        color: "#f8f7fb",
        fontFamily: "Geist",
      }}
    >
      <div style={{ display: "flex", fontSize: 52, fontWeight: 900 }}>
        Fiszy<span style={{ color: "#7a36ff" }}>.</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
        <div style={{ display: "flex", maxWidth: "960px", fontSize: 76, fontWeight: 900, lineHeight: 1.02 }}>
          Coś zacznie spadać.
        </div>
        <div style={{ display: "flex", color: "#aaa5b0", fontSize: 30 }}>
          Zostaw e-mail. Dowiesz się jako pierwszy.
        </div>
      </div>
      <div style={{ display: "flex", width: "100%", height: "12px", borderRadius: "999px", background: "linear-gradient(90deg, #7a36ff, #b999ff)" }} />
    </div>,
    {
      ...size,
      fonts: [
        { name: "Geist", data: regularFont, style: "normal", weight: 400 },
        { name: "Geist", data: boldFont, style: "normal", weight: 900 },
      ],
    },
  );
}
