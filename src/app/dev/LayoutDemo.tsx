import { useTranslation } from 'react-i18next';
import { Button, Card, HeaderActions, Select, SidebarLayout, useBreakpoint } from '@/components/ui';
import { Section } from './Section';

/** Gallery section for the app shell (M3.4): header slot, breakpoints, two-pane layout. */
export function LayoutDemo() {
  const { t } = useTranslation();
  const breakpoint = useBreakpoint();

  return (
    <Section title={t('devUi.layout')}>
      {/* A mock of the planner's trip bar (prototype `.trip-bar`), rendered into the header. */}
      <HeaderActions>
        <Select
          aria-label={t('devUi.tripSelect')}
          className="min-w-0 flex-1 tablet:w-auto tablet:max-w-[240px] tablet:min-w-[160px] tablet:flex-none"
        >
          <option>{t('devUi.tripName')}</option>
        </Select>
        <span className="order-last w-full text-[13px] text-ink-soft tablet:order-none tablet:w-auto tablet:px-1">
          {t('devUi.tripRange')}
        </span>
        <Button size="sm">{t('devUi.export')}</Button>
        <Button size="sm">{t('devUi.edit')}</Button>
        <Button size="sm" variant="primary">
          {t('devUi.newTrip')}
        </Button>
      </HeaderActions>

      <p className="mt-0 mb-2 text-sm text-ink-soft">{t('devUi.layoutIntro')}</p>
      <p className="mt-0 mb-4 text-sm font-medium" data-testid="breakpoint">
        {t('devUi.breakpoint', { name: t(`devUi.breakpoints.${breakpoint}`) })}
      </p>

      <div className="h-[360px] rounded-[var(--radius-card)] bg-bg p-3">
        <SidebarLayout
          sidebarLabel={t('devUi.sidebar')}
          sidebar={
            <Card className="h-full overflow-auto">
              <h4 className="mt-0 mb-2 text-base font-semibold">{t('devUi.sidebar')}</h4>
              <p className="m-0 text-sm text-ink-soft">{t('devUi.sidebarBody')}</p>
            </Card>
          }
        >
          <Card className="h-full">
            <p className="m-0 text-sm text-ink-soft">{t('devUi.mainBody')}</p>
          </Card>
        </SidebarLayout>
      </div>
    </Section>
  );
}
