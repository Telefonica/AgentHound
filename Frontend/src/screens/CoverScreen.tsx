"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { Box, ButtonPrimary, Stack, Text4, Text9, skinVars, useTheme } from "@telefonica/mistica";
import { useTranslations } from "next-intl";

// Same conic brand gradient used across the app background — a fixed Figma export, not a theme token.
const GLOW_GRADIENT =
  "conic-gradient(from 90deg, rgba(81, 56, 245, 1) 0deg, rgba(81, 56, 245, 1) 0.154565deg, rgba(0, 102, 255, 1) 90.2011deg, rgba(89, 194, 201, 1) 179.472deg, rgba(100, 183, 205, 1) 231.322deg, rgba(81, 56, 245, 1) 360deg)";

export default function CoverScreen() {
  const t = useTranslations("cover");
  const router = useRouter();
  const { isDarkMode } = useTheme();

  return (
    <div
      style={{
        position: "relative",
        height: "100vh",
        width: "100%",
        overflow: "hidden",
        borderRadius: skinVars.borderRadii.container,
        backgroundColor: skinVars.colors.background,
      }}
    >
      {/* Decorative background: centered brand glow + concentric rings */}
      <div
        aria-hidden
        style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none", zIndex: 0 }}
      >
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "52%",
            width: "min(78vw, 1180px)",
            height: "min(48vh, 520px)",
            borderRadius: "50%",
            background: GLOW_GRADIENT,
            filter: "blur(150px)",
            opacity: 0.4,
            transform: "translate(-50%, -50%) rotate(-26.3deg)",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "52%",
            width: "min(70vw, 960px)",
            aspectRatio: "1 / 1",
            transform: "translate(-50%, -50%)",
            // Fixed-brand rings graphic renders as plain white strokes; toned down in dark mode
            // so they don't overpower the near-black background.
            opacity: isDarkMode ? 0.5 : 1,
          }}
        >
          {/* Design rings from Figma. Each ring's animation lives on a wrapping <g>, not the
              <circle> itself, so browsers can hardware-accelerate the transform. */}
          <svg
            viewBox="0 0 959.72 959.72"
            width="100%"
            height="100%"
            fill="none"
            style={{ position: "absolute", inset: 0, display: "block" }}
          >
            <g className="cover-ring" style={{ animationDelay: "0s" }}>
              <circle cx="479.86" cy="479.86" r="353.411" stroke="white" strokeOpacity="0.5" strokeWidth="1.29692" />
            </g>
            <g className="cover-ring" style={{ animationDelay: "0.4s" }}>
              <circle cx="479.86" cy="479.86" r="419.553" stroke="white" strokeOpacity="0.25" strokeWidth="1.29692" />
            </g>
            <g className="cover-ring" style={{ animationDelay: "0.8s" }}>
              <circle cx="479.86" cy="479.86" r="479.212" stroke="white" strokeOpacity="0.15" strokeWidth="1.29692" />
            </g>
          </svg>
        </div>
      </div>

      <style>{`
        @keyframes cover-ring-pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.05); }
        }
        .cover-ring {
          transform-box: fill-box;
          transform-origin: center;
          animation: cover-ring-pulse 3s ease-in-out infinite;
          will-change: transform;
        }
        @media (prefers-reduced-motion: reduce) {
          .cover-ring { animation: none; }
        }
      `}</style>

      {/* Top-left brand */}
      <div
        style={{
          position: "absolute",
          left: 32,
          top: 32,
          zIndex: 2,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <Image src="/logo.svg" width={24} height={24} className="h-6 w-auto shrink-0" alt="" priority />
        <Text4 light color={skinVars.colors.textPrimary}>
          {t("brand")}
        </Text4>
      </div>

      {/* Centered hero */}
      <div
        style={{
          position: "relative",
          zIndex: 1,
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{ width: "100%", maxWidth: 862, padding: "0 24px" }}>
          <Stack space={16}>
            <Text9 as="h1" textAlign="center" color={skinVars.colors.textPrimary}>
              {t("title")}
            </Text9>
            <Text4 as="p" regular textAlign="center" color={skinVars.colors.textPrimary}>
              {t("subtitle")}
            </Text4>
            <Box paddingTop={8}>
              <div style={{ display: "flex", justifyContent: "center" }}>
                <ButtonPrimary onPress={() => router.push("/overview")}>{t("cta")}</ButtonPrimary>
              </div>
            </Box>
          </Stack>
        </div>
      </div>
    </div>
  );
}
