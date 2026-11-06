// Brand gradient colors are hardcoded (not theme tokens): fixed Figma export, intentionally not theme-aware.
const GLOW_GRADIENT =
  "conic-gradient(from 90deg, rgba(81, 56, 245, 1) 0deg, rgba(81, 56, 245, 1) 0.154565deg, rgba(0, 102, 255, 1) 90.2011deg, rgba(89, 194, 201, 1) 179.472deg, rgba(100, 183, 205, 1) 231.322deg, rgba(81, 56, 245, 1) 360deg)"

export default function BackgroundGlowBlobs() {
  return (
    <div
      aria-hidden
      data-glow-blobs
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        pointerEvents: "none",
        zIndex: 0,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 655,
          top: 288,
          width: 641,
          height: 187,
          borderRadius: "50%",
          background: GLOW_GRADIENT,
          filter: "blur(150px)",
          transform: "rotate(-26.26deg) skewX(13.63deg) scaleY(0.97)",
          opacity: 0.35,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 285,
          bottom: -22,
          width: 401,
          height: 303,
          borderRadius: "50%",
          background: GLOW_GRADIENT,
          filter: "blur(150px)",
          transform: "rotate(-33.61deg) skewX(13.44deg) scaleY(0.97)",
          opacity: 0.4,
        }}
      />
    </div>
  )
}
