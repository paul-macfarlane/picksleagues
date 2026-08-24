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
// Cross-fade between routes (MOB-3) via the browser View Transitions API;
// unsupported browsers and prefers-reduced-motion (guarded in index.css) get
// the plain cut. The directional-slide variant was considered and skipped:
// inferring "forward" vs "back" from history is the whole cost, for a cue the
// cross-fade already covers.
const router = createRouter({
  routeTree,
  defaultViewTransition: {
    // Path changes only: a search-param navigation (the week selector, list
    // filters) re-renders in place, and a whole-document snapshot there adds
    // an input-inert cross-fade to the app's most frequent taps. Browsers
    // without view-transition *types* support skip this filter and cross-fade
    // every navigation — the plain boolean behavior, not a breakage.
    types: ({ pathChanged }) => (pathChanged ? [] : false),
  },
});

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
