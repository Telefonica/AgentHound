import { act, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { ThemeContextProvider } from "@telefonica/mistica";
import { appSkin } from "@/lib/theme";
import messages from "../../messages/es.json";

const MISTICA_THEME = { skin: appSkin, i18n: { locale: "es-ES", phoneNumberFormattingRegionCode: "ES" } } as const;

export function withProviders(ui: ReactNode): ReactElement {
  return (
    <NextIntlClientProvider locale="es" messages={messages}>
      <ThemeContextProvider theme={MISTICA_THEME}>{ui}</ThemeContextProvider>
    </NextIntlClientProvider>
  );
}

export function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  return {
    container,
    render: (ui: ReactNode) => act(() => root.render(withProviders(ui))),
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

export function press(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}
