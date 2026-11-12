import { useTranslation } from 'react-i18next';
import { Link, Outlet } from 'react-router-dom';
import { ServerStatus } from './ServerStatus';

export function AppLayout() {
  const { t } = useTranslation();
  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-4 border-b border-line bg-panel px-5 py-3">
        <Link to="/trips" className="me-auto flex items-center gap-2.5 no-underline">
          <img src="/icon.svg" alt="" width={36} height={36} className="rounded-xl" />
          <h1 className="m-0 text-[19px] font-bold tracking-tight text-ink">{t('app.title')}</h1>
        </Link>
        <ServerStatus />
      </header>
      <main className="min-h-0 flex-1 overflow-auto p-4 sm:p-5">
        <Outlet />
      </main>
    </div>
  );
}
