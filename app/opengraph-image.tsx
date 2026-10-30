import { ImageResponse } from "next/og";

// Social preview image (WhatsApp / LinkedIn / X par link share karne par dikhti hai).
export const alt = "Blisscco Online Ad Network";
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
          padding: 80,
          background: "#0B1020",
          color: "#F8FAFC",
        }}
      >
        <div style={{ fontSize: 28, color: "#20D9E6", marginBottom: 24 }}>Blisscco</div>
        <div style={{ fontSize: 72, fontWeight: 700, lineHeight: 1.1 }}>Contextual ads for AI chatbot platforms</div>
        <div style={{ fontSize: 32, marginTop: 28, color: "#94A3B8" }}>Relevant. Clearly labelled. Built for trust.</div>
      </div>
    ),
    size,
  );
}
