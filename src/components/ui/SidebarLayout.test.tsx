import { render, screen, within } from '@testing-library/react';
import { SidebarLayout } from './SidebarLayout';

describe('SidebarLayout', () => {
  it('renders a labelled side panel and the main content', () => {
    render(
      <SidebarLayout sidebarLabel="מאגר אטרקציות" sidebar={<p>מאגר</p>}>
        <p>לוח</p>
      </SidebarLayout>,
    );
    const aside = screen.getByRole('complementary', { name: 'מאגר אטרקציות' });
    expect(within(aside).getByText('מאגר')).toBeInTheDocument();
    expect(screen.getByText('לוח')).toBeInTheDocument();
  });

  it('puts the side panel first (start side in RTL) with the prototype breakpoints', () => {
    const { container } = render(
      <SidebarLayout sidebarLabel="מאגר" sidebar={<p>א</p>}>
        <p>ב</p>
      </SidebarLayout>,
    );
    const grid = container.firstElementChild as HTMLElement;
    expect(grid.firstElementChild?.tagName).toBe('ASIDE');
    expect(grid.className).toContain('desktop:grid-cols-[270px_minmax(0,1fr)]');
    expect(grid.className).toContain('tablet:grid-cols-[240px_minmax(0,1fr)]');
  });
});
