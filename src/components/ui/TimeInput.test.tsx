import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { TimeInput, type TimeInputProps } from './TimeInput';

const LABEL = 'שעת התחלה';

function Harness(props: Partial<TimeInputProps> & { initial?: number | null }) {
  const { initial = 480, onChange, ...rest } = props;
  const [value, setValue] = useState<number | null>(initial);
  return (
    <>
      <TimeInput
        label={LABEL}
        hint="לדוגמה 0800"
        min={0}
        max={1410}
        value={value}
        onChange={(m) => {
          setValue(m);
          onChange?.(m);
        }}
        {...rest}
      />
      <output data-testid="value">{value === null ? 'null' : value}</output>
    </>
  );
}

function input() {
  return screen.getByRole('textbox', { name: LABEL });
}

function type(text: string) {
  fireEvent.change(input(), { target: { value: text } });
}

describe('TimeInput', () => {
  it('shows the value as HH:MM with a numeric LTR input and a hint', () => {
    render(<Harness />);
    const el = input();
    expect(el).toHaveValue('08:00');
    expect(el).toHaveAttribute('inputmode', 'numeric');
    expect(el).toHaveAttribute('dir', 'ltr');
    expect(el).toHaveAccessibleDescription('לדוגמה 0800');
    expect(el).not.toHaveAttribute('aria-invalid');
  });

  it('reports minutes while typing HHMM and normalises to HH:MM on blur', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    type('0930');
    expect(onChange).toHaveBeenLastCalledWith(570);
    expect(input()).toHaveValue('0930');
    fireEvent.blur(input());
    expect(input()).toHaveValue('09:30');
    expect(screen.queryByText(/עוגל/)).not.toBeInTheDocument();
  });

  it('rounds to the half hour and says so politely', () => {
    render(<Harness />);
    type('0145');
    expect(screen.getByTestId('value')).toHaveTextContent('120');
    fireEvent.blur(input());
    expect(input()).toHaveValue('02:00');
    const note = screen.getByText(/עוגל ל-02:00/);
    expect(note).toHaveAttribute('aria-live', 'polite');
    expect(input()).toHaveAccessibleDescription(/עוגל ל-02:00/);

    // Typing again clears the note.
    type('0300');
    expect(screen.queryByText(/עוגל/)).not.toBeInTheDocument();
  });

  it('shows a parse error only after the field is left, and reports null', () => {
    render(<Harness />);
    type('0860');
    expect(screen.getByTestId('value')).toHaveTextContent('null');
    expect(input()).not.toHaveAttribute('aria-invalid');
    fireEvent.blur(input());
    expect(input()).toHaveAttribute('aria-invalid', 'true');
    expect(input()).toHaveAccessibleDescription(/הדקות צריכות להיות בין 00 ל-59/);
    // Invalid text is kept as typed so it can be fixed.
    expect(input()).toHaveValue('0860');
  });

  it('shows a parse error immediately when showErrors is set', () => {
    render(<Harness showErrors />);
    type('abc');
    expect(screen.getByText('צריך להקליד ספרות בלבד, למשל 0800 או 08:00')).toBeInTheDocument();
  });

  it('names the range limit in the default message', () => {
    render(<Harness showErrors />);
    type('2400');
    expect(screen.getByText('השעה המאוחרת ביותר היא 23:30')).toBeInTheDocument();
  });

  it('uses custom messages', () => {
    render(
      <Harness showErrors min={30} max={1440} messages={{ below_min: 'משך מינימלי חצי שעה' }} />,
    );
    type('0000');
    expect(screen.getByText('משך מינימלי חצי שעה')).toBeInTheDocument();
  });

  it('shows an outside error only while the text itself is valid', () => {
    render(<Harness error="סוף הטיול צריך להיות אחרי ההתחלה" showErrors />);
    expect(input()).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('סוף הטיול צריך להיות אחרי ההתחלה')).toBeInTheDocument();
    type('');
    expect(screen.queryByText('סוף הטיול צריך להיות אחרי ההתחלה')).not.toBeInTheDocument();
    expect(screen.getByText('צריך להקליד שעה, למשל 0800')).toBeInTheDocument();
  });

  it('follows a new value set by the parent', () => {
    const { rerender } = render(
      <TimeInput label={LABEL} min={0} max={1410} value={480} onChange={() => {}} />,
    );
    rerender(<TimeInput label={LABEL} min={0} max={1410} value={600} onChange={() => {}} />);
    expect(input()).toHaveValue('10:00');
  });
});
