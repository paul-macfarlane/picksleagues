import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#EA5323",
        color: "#FFFFFF",
        fontSize: 132,
        fontWeight: 800,
        fontFamily: "system-ui, sans-serif",
        letterSpacing: -4,
      }}
    >
      P
    </div>,
    size,
  );
}
