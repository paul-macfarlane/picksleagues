import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { ThemeColorSync } from "./components/theme-color-sync";
import { routeTree } from "./routeTree.gen";
import "./index.css";
// Side-effect import: the install-prompt listener must be armed before Chromium
// fires `beforeinstallprompt`, which happens long before any route mounts.
import "./lib/install-prompt";

const queryClient = new QueryClient();
const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* storageKey must match the inline anti-FOUC script in index.html <head>. */}
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      storageKey="picksleagues-theme"
      disableTransitionOnChange
    >
      <ThemeColorSync />
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
