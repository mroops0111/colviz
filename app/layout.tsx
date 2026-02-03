import type { Metadata } from "next";
import "./globals.css";
import "@copilotkit/react-ui/styles.css";
import { CopilotKit } from "@copilotkit/react-core";
import { CopilotSidebar } from "@copilotkit/react-ui";
import { getColvizSystemPrompt } from "@/prompts/system-message";
import { COLVIZ_SIDEBAR_WELCOME } from "@/prompts/welcome-message";

export const metadata: Metadata = {
  title: "ColViz - Collaboration Visualization",
  description: "Visualize collaboration data with arc diagrams - behaviors: awareness, coordination, sharing, improving",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <CopilotKit
          runtimeUrl="/api/copilotkit"
          showDevConsole={process.env.NEXT_PUBLIC_COPILOTKIT_DEBUG === "true"}
        >
          <CopilotSidebar
            defaultOpen={false}
            hitEscapeToClose={false}
            instructions={getColvizSystemPrompt()}
            labels={{ initial: COLVIZ_SIDEBAR_WELCOME }}
          />
          {children}
        </CopilotKit>
      </body>
    </html>
  );
}
