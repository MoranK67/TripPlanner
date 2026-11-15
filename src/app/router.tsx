import { createBrowserRouter, Navigate, type RouteObject } from 'react-router-dom';
import { LoadingState } from '@/components/ui';
import { ForgotPasswordPage, LoginPage, RequireAuth, ResetPasswordPage } from '@/features/auth';
import { AppLayout } from './AppLayout';
import { NotFoundPage } from './NotFoundPage';
import { RouteErrorPage } from './RouteErrorPage';

/**
 * Shown in the outlet while a lazy route's chunk loads on the very first page load (v7 renders
 * the route tree before the router is initialized; without this it warns and renders nothing).
 * Placed on the lazy routes themselves so the app shell and the auth guard above them still render.
 */
const hydrateFallbackElement = <LoadingState />;

/**
 * Development-only routes. `import.meta.env.DEV` is replaced with `false` in production builds,
 * so this array is empty there and the lazy-imported pages are dropped from the bundle.
 */
const devRoutes: RouteObject[] = import.meta.env.DEV
  ? [
      {
        path: 'dev/ui',
        hydrateFallbackElement,
        lazy: async () => {
          const { UiGalleryPage } = await import('./dev/UiGalleryPage');
          return { Component: UiGalleryPage };
        },
      },
    ]
  : [];

export const routes: RouteObject[] = [
  {
    element: <AppLayout />,
    errorElement: <RouteErrorPage />,
    children: [
      // Public: sign-in and password reset (FR-1.1, FR-1.5). There is no sign-up route (FR-1.3).
      { path: 'login', element: <LoginPage /> },
      { path: 'forgot-password', element: <ForgotPasswordPage /> },
      { path: 'reset-password', element: <ResetPasswordPage /> },
      // Everything else needs a session.
      {
        element: <RequireAuth />,
        children: [
          { index: true, element: <Navigate to="/trips" replace /> },
          // Lazy chunks: the login page (first visit) does not download the planner code.
          {
            path: 'trips',
            hydrateFallbackElement,
            lazy: async () => {
              const { TripsRoute } = await import('./TripsRoute');
              return { Component: TripsRoute };
            },
          },
          {
            path: 'trips/:tripId',
            hydrateFallbackElement,
            lazy: async () => {
              const { TripPage } = await import('./TripPage');
              return { Component: TripPage };
            },
          },
        ],
      },
      ...devRoutes,
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

export const router = createBrowserRouter(routes);
