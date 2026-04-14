import { ImageResponse } from "next/og";

export const alt = "PicksLeagues — NFL Pick'Em with friends";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        justifyContent: "center",
        background: "#0A0A0A",
        color: "#FAFAFA",
        fontFamily: "system-ui, sans-serif",
        padding: "80px 96px",
        gap: 32,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 140,
          height: 140,
          background: "#EA5323",
          color: "#FFFFFF",
          fontSize: 110,
          fontWeight: 800,
          letterSpacing: -4,
          borderRadius: 32,
        }}
      >
        P
      </div>
      <div
        style={{
          fontSize: 96,
          fontWeight: 800,
          letterSpacing: -3,
          lineHeight: 1,
          display: "flex",
        }}
      >
        PicksLeagues
      </div>
      <div
        style={{
          fontSize: 40,
          fontWeight: 500,
          color: "#A1A1AA",
          letterSpacing: -1,
          display: "flex",
        }}
      >
        NFL Pick&apos;Em with friends. Every week.
      </div>
    </div>,
    size,
  );
}
