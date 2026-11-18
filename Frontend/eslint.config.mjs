import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import i18next from "eslint-plugin-i18next";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["**/*.tsx"],
    plugins: { i18next },
    rules: {
      "i18next/no-literal-string": [
        "error",
        {
          mode: "jsx-text-only",
          "jsx-components": {
            exclude: ["Trans", "option", "Checkbox"],
          },
          "jsx-attributes": {
            exclude: [
              "className",
              "styleName",
              "style",
              "type",
              "key",
              "id",
              "width",
              "height",
              "name",
              "role",
              "aria-hidden",
              "aria-label",
              "color",
              "size",
              "href",
              "to",
              "value",
              "htmlFor",
              "viewBox",
              "fill",
              "stroke",
              "strokeWidth",
              "strokeLinecap",
              "strokeDasharray",
              "strokeDashoffset",
              "transform",
              "cx",
              "cy",
              "r",
              "d",
              "title",
              "placeholder",
              "label",
              "message",
            ],
          },
          words: {
            exclude: [
              "[0-9!-/:-@[-`{-~]+",
              "[A-Z_-]+",
              "[\\u2000-\\u2BFF]+",
              "OK:?",
            ],
          },
          callees: {
            exclude: [
              "i18n(ext)?",
              "t",
              "require",
              "addEventListener",
              "removeEventListener",
              "postMessage",
              "getElementById",
              "dispatch",
              "commit",
              "includes",
              "indexOf",
              "endsWith",
              "startsWith",
              "logger\\.error",
              "logger\\.warn",
              "logger\\.info",
              "logger\\.debug",
              "console\\.log",
              "console\\.error",
              "console\\.warn",
            ],
          },
        },
      ],
    },
  },
  globalIgnores([
    ".next/**",
    ".next-visual/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "tests/visual/**/*-snapshots/**",
  ]),
]);

export default eslintConfig;
