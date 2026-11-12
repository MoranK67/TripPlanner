import { fireEvent, render, screen } from '@testing-library/react';
import { Button } from './Button';

describe('Button', () => {
  it('defaults to type="button" and the soft variant', () => {
    render(<Button>שמירה</Button>);
    const btn = screen.getByRole('button', { name: 'שמירה' });
    expect(btn).toHaveAttribute('type', 'button');
    expect(btn.className.split(' ')).toContain('bg-accent-soft');
  });

  it.each([
    ['primary', 'bg-accent'],
    ['ghost', 'bg-transparent'],
    ['danger', 'bg-danger'],
  ] as const)('applies the %s variant', (variant, cls) => {
    render(<Button variant={variant}>x</Button>);
    expect(screen.getByRole('button').className.split(' ')).toContain(cls);
  });

  it('calls onClick when enabled', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>x</Button>);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('does not fire onClick when disabled', () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        x
      </Button>,
    );
    const btn = screen.getByRole('button');
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('is busy and disabled while loading, keeping its name', () => {
    render(<Button loading>שומר</Button>);
    const btn = screen.getByRole('button', { name: 'שומר' });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('button-spinner')).toHaveAttribute('aria-hidden', 'true');
  });

  it('icon buttons take their name from aria-label', () => {
    render(
      <Button size="icon" aria-label="הוספה">
        <span aria-hidden="true">+</span>
      </Button>,
    );
    expect(screen.getByRole('button', { name: 'הוספה' })).toBeInTheDocument();
  });

  it('forwards refs to the native button', () => {
    const ref = { current: null as HTMLButtonElement | null };
    render(<Button ref={ref}>x</Button>);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });
});
