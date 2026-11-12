// Test-only helpers for the trips feature. Never hot-reloaded, so mixing a local component with
// helper exports is fine here.
/* eslint-disable react-refresh/only-export-components */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router-dom';
import { HeaderSlotProvider, ToastProvider } from '@/components/ui';
import type { Trip, TripSummary } from '@/domain';

export function makeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 'trip-1',
    name: 'רומא',
    window: { startDate: '2026-05-01', startMinute: 600, endDate: '2026-05-03', endMinute: 1080 },
    colorCursor: 2,
    ...overrides,
  };
}

export function makeSummary(overrides: Partial<TripSummary> = {}): TripSummary {
  return {
    id: 'trip-1',
    name: 'רומא',
    window: { startDate: '2026-05-01', startMinute: 600, endDate: '2026-05-03', endMinute: 1080 },
    dayCount: 3,
    ...overrides,
  };
}

/** Stand-in for the app header so <HeaderActions> content renders. */
function HeaderHost({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  return (
    <>
      <div ref={setSlot} data-testid="header" />
      <HeaderSlotProvider target={slot}>{children}</HeaderSlotProvider>
    </>
  );
}

/** Renders `element` at `path` (route pattern `pattern`) with query client, toasts and header. */
export function renderRoute(
  element: ReactNode,
  {
    path = '/',
    pattern = path,
    extraRoutes = [],
  }: { path?: string; pattern?: string; extraRoutes?: RouteObject[] } = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const router = createMemoryRouter(
    [
      { path: pattern, element: <HeaderHost>{element}</HeaderHost> },
      ...extraRoutes,
      { path: '*', element: <p>דף אחר</p> },
    ],
    { initialEntries: [path] },
  );
  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { router, queryClient };
}
