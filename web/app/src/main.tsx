// First: carries settings saved under the earlier storage prefix over, before any store reads them.
import '@/lib/legacyStorage';
import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import '@/lib/motionPref';
import { queryClient } from '@/lib/queryClient';
import { routes } from '@/routes';
import '@fontsource-variable/inter/opsz.css';
import '@/styles/global.css';

const router = createBrowserRouter(routes);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
