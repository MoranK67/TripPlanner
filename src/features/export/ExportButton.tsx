import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HeaderAction } from '@/components/ui';
import type { Activity, Trip } from '@/domain';
import { ExportDialog } from './ExportDialog';

export interface ExportButtonProps {
  trip: Pick<Trip, 'name' | 'window'>;
  activities: readonly Activity[];
}

/**
 * "ייצוא" header button (prototype trip bar) that opens the export dialog (FR-7.1–7.5); an item of
 * the "⋯" menu on phones (PHONE-1), after "עריכה".
 */
export function ExportButton({ trip, activities }: ExportButtonProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <HeaderAction
        label={t('export.open')}
        opensDialog
        order={20}
        onSelect={() => setOpen(true)}
      />
      <ExportDialog
        open={open}
        onClose={() => setOpen(false)}
        trip={trip}
        activities={activities}
      />
    </>
  );
}
