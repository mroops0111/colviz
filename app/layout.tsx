import type { Metadata } from "next";
import "./globals.css";
import "@copilotkit/react-ui/styles.css";
import { CopilotKit } from "@copilotkit/react-core";

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
          {children}
        </CopilotKit>
      </body>
    </html>
  );
}
