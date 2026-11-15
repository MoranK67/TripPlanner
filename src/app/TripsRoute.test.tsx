import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { configure, fireEvent, render, screen, within } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { HeaderSlotProvider, ToastProvider } from '@/components/ui';
import type { TripSummary } from '@/domain';
import { TripsRoute } from './TripsRoute';

// Under load (parallel workers, a busy machine) data and lazy chunks can take longer than
// Testing Library's 1 s default; give findBy / waitFor more room in this file.
configure({ asyncUtilTimeout: 5_000 });

const repo = vi.hoisted(() => ({ list: vi.fn() }));

vi.mock('@/data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/data')>();
  return { ...actual, tripsRepo: repo };
});

const rome: TripSummary = {
  id: 'trip-1',
  name: 'רומא',
  window: { startDate: '2026-05-01', startMinute: 600, endDate: '2026-05-03', endMinute: 1080 },
  dayCount: 3,
};

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

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter>
          <HeaderHost>
            <TripsRoute />
          </HeaderHost>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  repo.list.mockReset();
});

describe('TripsRoute (FR-8.1, FR-8.2)', () => {
  it('puts the backup buttons in the trips page header', async () => {
    repo.list.mockResolvedValue([rome]);
    setup();
    const header = screen.getByTestId('header');
    expect(await within(header).findByRole('button', { name: 'שמירת גיבוי' })).toBeEnabled();
    const buttons = within(header).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual([
      '+ טיול חדש',
      'שמירת גיבוי',
      'שחזור מגיבוי',
    ]);
    fireEvent.click(within(header).getByRole('button', { name: 'שחזור מגיבוי' }));
    expect(screen.getByRole('dialog', { name: 'שחזור טיולים מקובץ גיבוי' })).toBeInTheDocument();
  });

  it('offers restore but not export when there are no trips', async () => {
    repo.list.mockResolvedValue([]);
    setup();
    await screen.findByRole('heading', { name: 'עדיין אין טיולים' });
    const header = screen.getByTestId('header');
    expect(within(header).queryByRole('button', { name: 'שמירת גיבוי' })).not.toBeInTheDocument();
    expect(within(header).getByRole('button', { name: 'שחזור מגיבוי' })).toBeInTheDocument();
  });
});
