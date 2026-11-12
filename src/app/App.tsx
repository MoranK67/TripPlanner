import { RouterProvider } from 'react-router-dom';
import { AppErrorBoundary } from './AppErrorBoundary';
import { Providers } from './Providers';
import { router } from './router';

export function App() {
  return (
    <AppErrorBoundary>
      <Providers>
        <RouterProvider router={router} />
      </Providers>
    </AppErrorBoundary>
  );
}
