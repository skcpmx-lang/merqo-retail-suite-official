import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/hind-siliguri/400.css'
import '@fontsource/hind-siliguri/500.css'
import '@fontsource/hind-siliguri/600.css'
import '@fontsource/hind-siliguri/700.css'
import './ui/base.css'
import './ui/components.css'
import './app/shell.css'
import { AppRouter } from './app/router'
import { SessionProvider, connectToCore } from './state/session'
import { ToastProvider } from './state/toast'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 15_000, refetchOnWindowFocus: false },
    mutations: { retry: 0 }
  }
})

async function boot() {
  await connectToCore()
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <SessionProvider>
            <AppRouter />
          </SessionProvider>
        </ToastProvider>
      </QueryClientProvider>
    </React.StrictMode>
  )
}

void boot()
