import { createBrowserRouter, Navigate, type RouteObject } from 'react-router-dom';
import { ForgotPasswordPage, LoginPage, RequireAuth, ResetPasswordPage } from '@/features/auth';
import { AppLayout } from './AppLayout';
import { NotFoundPage } from './NotFoundPage';
import { RouteErrorPage } from './RouteErrorPage';

/**
 * Development-only routes. `import.meta.env.DEV` is replaced with `false` in production builds,
 * so this array is empty there and the lazy-imported pages are dropped from the bundle.
 */
const devRoutes: RouteObject[] = import.meta.env.DEV
  ? [
      {
        path: 'dev/ui',
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
            lazy: async () => {
              const { TripsRoute } = await import('./TripsRoute');
              return { Component: TripsRoute };
            },
          },
          {
            path: 'trips/:tripId',
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
