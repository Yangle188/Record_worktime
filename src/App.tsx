import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ErrorBoundary } from '@/app/ErrorBoundary';
import { AppLayout } from '@/components/AppLayout';
import { PunchHomePage } from '@/features/punch/PunchHomePage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { TimelinePage } from '@/features/timeline/TimelinePage';

export default function App() {
  return (
    <BrowserRouter>
      <AppLayout>
        <ErrorBoundary>
          <Routes>
            <Route path="/" element={<PunchHomePage />} />
            <Route path="/timeline" element={<TimelinePage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </ErrorBoundary>
      </AppLayout>
    </BrowserRouter>
  );
}
