import { ImageResponse } from "next/og";

export const alt = "VIDEOCOMET · Persönliche Videos, die Kunden gewinnen";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "flex-start",
          padding: "80px",
          background:
            "linear-gradient(135deg, #f7f5fd 0%, #ece6ff 55%, #d9ccff 100%)",
          fontFamily: "sans-serif",
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: "-200px",
            right: "-150px",
            width: "600px",
            height: "600px",
            borderRadius: "50%",
            background:
              "radial-gradient(circle, rgba(124,92,232,0.35) 0%, rgba(124,92,232,0) 70%)",
          }}
        />
        <div
          style={{
            fontSize: 34,
            fontWeight: 700,
            letterSpacing: "0.22em",
            color: "#5b3fd4",
            marginBottom: 28,
          }}
        >
          VIDEOCOMET
        </div>
        <div
          style={{
            fontSize: 72,
            fontWeight: 800,
            lineHeight: 1.08,
            color: "#1c1633",
            letterSpacing: "-0.03em",
            maxWidth: "900px",
          }}
        >
          Persönliche Videos, die Kunden gewinnen.
        </div>
        <div
          style={{
            fontSize: 30,
            color: "#4c4568",
            marginTop: 32,
            maxWidth: "820px",
            lineHeight: 1.4,
          }}
        >
          Hunderte persönliche Videos an potenzielle Kunden. Mit Landingpage,
          Brief mit QR-Code und Live-Tracking.
        </div>
      </div>
    ),
    size,
  );
}
