import { Outlet, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";

import { FoundationScreen } from "./foundation-screen.tsx";

const rootRoute = createRootRoute({
  component: Outlet,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: FoundationScreen,
});

const routeTree = rootRoute.addChildren([indexRoute]);

export const router = createRouter({ routeTree });

// TanStack's documented type-registration pattern lets routing APIs infer this app's route types.
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
