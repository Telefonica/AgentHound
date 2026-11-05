"use client";

import type { ReactNode } from "react";
import { Box, Boxed, Inline, Stack, Text8, skinVars } from "@telefonica/mistica";
import ContentLayout from "@/components/layout/ContentLayout";

// The KPI cards sit across the top edge of the general container: this many
// pixels of each card stick out above it. The mockup has 45; 48 is the nearest
// step of Mistica's spacing scale, which is what Box padding accepts.
const KPI_OVERLAP = 48;

interface DashboardPageProps {
  title: string;
  /** Button on the right of the title. */
  action?: ReactNode;
  /** Row of KPI cards that crosses the container's top edge. Leave out while there is no data. */
  kpis?: ReactNode;
  children: ReactNode;
}

/**
 * Frame shared by Overview and Results: the title (48 above, 40 below, like the
 * wizard), then one general container that holds the KPI row and the page content.
 */
function DashboardPage({ title, action, kpis, children }: DashboardPageProps) {
  const hasKpis = Boolean(kpis);
  return (
    // The title sits 48 from the top like on the wizard, so the page starts at 0.
    <ContentLayout paddingTop={0}>
      <Box paddingX={32} paddingBottom={32}>
        {/* From 1920px up the page stops at 1440px, the same cap as the wizard's
            container. It lives on a plain wrapper because Mistica's own (unlayered)
            styles win over a utility class set on its components. */}
        <div className="w-full min-[1920px]:max-w-[1440px]">
          <Box paddingTop={48} paddingBottom={40}>
            <Inline space="between" alignItems="center">
              <Text8 as="h1" color={skinVars.colors.neutralHigh}>
                {title}
              </Text8>
              {action}
            </Inline>
          </Box>

          {/* Two layers share one grid cell: the container (a Boxed, which clips
              whatever pokes out of it) and, over it, the content. The content is
              taller than the container by KPI_OVERLAP, so the KPI cards cross its
              top edge, and they stay 40 under the title like anything that follows
              the header. Mistica has no layering primitive, hence the plain divs. */}
          <div style={{ display: "grid" }}>
            <div
              aria-hidden="true"
              style={{ gridArea: "1 / 1", display: "grid", paddingTop: hasKpis ? KPI_OVERLAP : 0 }}
            >
              <Boxed width="100%">{null}</Boxed>
            </div>
            <div style={{ gridArea: "1 / 1", position: "relative" }}>
              <Box paddingX={32} paddingTop={hasKpis ? 0 : 40} paddingBottom={40}>
                <Stack space={40}>
                  {kpis}
                  {children}
                </Stack>
              </Box>
            </div>
          </div>
        </div>
      </Box>
    </ContentLayout>
  );
}

export default DashboardPage;
