import { createBrowserRouter, Navigate, type RouteObject } from 'react-router-dom';
import { LoginPage } from '@/features/auth';
import { TripPlannerPage } from '@/features/schedule';
import { TripsPage } from '@/features/trips';
import { AppLayout } from './AppLayout';
import { NotFoundPage } from './NotFoundPage';
import { RouteErrorPage } from './RouteErrorPage';

/**
 * Development-only routes. `import.meta.env.DEV` is replaced with `false` in production builds,
 * so this array is empty there and the lazy-imported gallery is dropped from the bundle.
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
      { index: true, element: <Navigate to="/trips" replace /> },
      { path: 'login', element: <LoginPage /> },
      { path: 'trips', element: <TripsPage /> },
      { path: 'trips/:tripId', element: <TripPlannerPage /> },
      ...devRoutes,
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

export const router = createBrowserRouter(routes);
