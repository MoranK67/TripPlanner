import { useEffect } from 'react';
import { useRouteError } from 'react-router-dom';
import { ErrorScreen } from './ErrorScreen';

export function RouteErrorPage() {
  const error = useRouteError();
  useEffect(() => {
    console.error('[router] route error', error);
  }, [error]);
  return <ErrorScreen />;
}
