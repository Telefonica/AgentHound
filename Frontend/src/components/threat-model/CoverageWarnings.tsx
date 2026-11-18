"use client";

import { useLocale, useTranslations } from "next-intl";
import {
  BoxedAccordion,
  BoxedAccordionItem,
  IconAlertRegular,
  Inline,
  Stack,
  Tag,
  Text1,
  Text2,
  skinVars,
} from "@telefonica/mistica";
import type { CoverageWarning } from "@/lib/api/types";
import { describeDeclare, describeIgnored, groupCoverageWarnings } from "@/lib/results/coverageWarnings";
import type { ReactNode } from "react";

function RuleTags({ rules }: { rules: string[] }) {
  return (
    <Inline space={4} wrap verticalSpace={4}>
      {rules.map((rule) => <Tag key={rule} type="inactive" small>{rule}</Tag>)}
    </Inline>
  );
}

function Section({ title, desc, children }: { title: string; desc?: string; children: ReactNode }) {
  return (
    <Stack space={8}>
      <Stack space={2}>
        <Text2 medium>{title}</Text2>
        {desc && <Text1 regular color={skinVars.colors.textSecondary}>{desc}</Text1>}
      </Stack>
      {children}
    </Stack>
  );
}

/** What a framework file's format leaves unchecked, collapsed by default.
 * Renders nothing for the generic format, which returns no warnings.
 * `framework` is the analysis' source framework: Dify declarations go in the
 * node's `data` block. */
function CoverageWarnings({ warnings, framework }: { warnings: CoverageWarning[]; framework: string }) {
  const t = useTranslations("results.coverage");
  const locale = useLocale();
  if (warnings.length === 0) return null;
  const { notExpressible, needsDeclaration, ignored, ruleCount } = groupCoverageWarnings(warnings);

  return (
    <BoxedAccordion dataAttributes={{ testid: "coverage-warnings" }}>
      <BoxedAccordionItem
        title={t("title")}
        subtitle={ruleCount > 0 ? t("subtitle", { count: ruleCount }) : undefined}
        asset={<IconAlertRegular size={20} color={skinVars.colors.warning} />}
        content={
          <Stack space={24}>
            {ruleCount > 0 && <Text1 regular color={skinVars.colors.textSecondary}>{t("intro")}</Text1>}
            {notExpressible.length > 0 && (
              <Section title={t("notExpressibleTitle")} desc={t("notExpressibleDesc")}>
                <RuleTags rules={notExpressible} />
              </Section>
            )}
            {needsDeclaration.length > 0 && (
              <Section title={t("needsDeclarationTitle")} desc={t(framework === "dify" ? "needsDeclarationDescDify" : "needsDeclarationDesc")}>
                <Stack space={12}>
                  {needsDeclaration.map((w) => (
                    <Stack key={w.rules.join()} space={4}>
                      <RuleTags rules={w.rules} />
                      <Text1 regular>{t("declare", { what: describeDeclare(w.declare ?? [], t, locale) })}</Text1>
                    </Stack>
                  ))}
                </Stack>
              </Section>
            )}
            {ignored.length > 0 && (
              <Section title={t("ignoredTitle")}>
                <Stack space={4}>
                  {ignored.map((w, i) => <Text1 key={i} regular>{describeIgnored(w, t)}</Text1>)}
                </Stack>
              </Section>
            )}
          </Stack>
        }
      />
    </BoxedAccordion>
  );
}

export default CoverageWarnings;
