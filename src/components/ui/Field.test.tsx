import { render, screen } from '@testing-library/react';
import { Field } from './Field';
import { Input } from './Input';
import { Select } from './Select';
import { Textarea } from './Textarea';

describe('Field', () => {
  it('labels the control', () => {
    render(
      <Field label="שם הטיול">
        <Input />
      </Field>,
    );
    expect(screen.getByLabelText('שם הטיול')).toBeInstanceOf(HTMLInputElement);
  });

  it('describes the control with the hint', () => {
    render(
      <Field label="שם" hint="עד 60 תווים">
        <Input />
      </Field>,
    );
    const input = screen.getByRole('textbox', { name: 'שם' });
    expect(input).toHaveAccessibleDescription('עד 60 תווים');
    expect(input).not.toHaveAttribute('aria-invalid');
  });

  it('marks the control invalid and describes it with hint and error', () => {
    render(
      <Field label="שם" hint="עד 60 תווים" error="צריך לתת שם">
        <Input />
      </Field>,
    );
    const input = screen.getByRole('textbox', { name: 'שם' });
    expect(input).toBeInvalid();
    expect(input).toHaveAccessibleDescription('עד 60 תווים צריך לתת שם');
    expect(screen.getByText('צריך לתת שם').id).toBe(`${input.id}-error`);
  });

  it('sets required; the visual marker is not part of the accessible name', () => {
    render(
      <Field label="שם" required>
        <Input />
      </Field>,
    );
    expect(screen.getByRole('textbox', { name: 'שם' })).toBeRequired();
  });

  it('uses a provided id and merges an existing aria-describedby', () => {
    render(
      <>
        <span id="extra">עוד מידע</span>
        <Field label="שם" id="trip-name" hint="רמז">
          <Input aria-describedby="extra" />
        </Field>
      </>,
    );
    const input = screen.getByRole('textbox', { name: 'שם' });
    expect(input.id).toBe('trip-name');
    expect(input).toHaveAttribute('aria-describedby', 'trip-name-hint extra');
  });

  it('the Field id wins over an id set on the control, so the label still matches', () => {
    render(
      <Field label="שם" id="from-field">
        <Input id="from-control" />
      </Field>,
    );
    expect(screen.getByRole('textbox', { name: 'שם' }).id).toBe('from-field');
  });

  it('wires Select and Textarea the same way', () => {
    render(
      <>
        <Field label="שעה" error="שגיאה">
          <Select>
            <option>09:00</option>
          </Select>
        </Field>
        <Field label="רשימה">
          <Textarea />
        </Field>
      </>,
    );
    expect(screen.getByRole('combobox', { name: 'שעה' })).toBeInvalid();
    expect(screen.getByRole('textbox', { name: 'רשימה' }).tagName).toBe('TEXTAREA');
  });

  it('controls also work standalone outside a Field', () => {
    render(<Input aria-label="חיפוש" />);
    const input = screen.getByRole('textbox', { name: 'חיפוש' });
    expect(input).not.toHaveAttribute('aria-describedby');
    expect(input).not.toHaveAttribute('id');
  });
});
