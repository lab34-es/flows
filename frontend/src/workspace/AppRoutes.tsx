import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import HomePage from '@/pages/HomePage';
import FlowPage from '@/pages/FlowPage';
import FolderPage from '@/pages/FolderPage';
import TestRunsPage from '@/pages/TestRunsPage';
import TestRunPage from '@/pages/TestRunPage';
import TestRunFlowPage from '@/pages/TestRunFlowPage';
import ApplicationPage from '@/pages/ApplicationPage';
import SettingsPage from '@/pages/SettingsPage';
import AiSettings from '@/components/settings/AiSettings';
import XraySettings from '@/components/settings/XraySettings';
import UiSettings from '@/components/settings/UiSettings';
import HelpSection from '@/components/settings/help/HelpSection';

/**
 * The route table of the app. Every workspace tab runs its own router over
 * these routes, so a tab navigates within itself (a test runs table opens a
 * run in place, settings switch sections) exactly as the app did when the
 * routes owned the whole content area.
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/flows/view" element={<FlowPage />} />
      <Route path="/flows/folder" element={<FolderPage />} />
      <Route path="/test-runs" element={<TestRunsPage />} />
      <Route path="/test-runs/:id" element={<TestRunPage />} />
      <Route path="/test-runs/:id/flow" element={<TestRunFlowPage />} />
      <Route path="/applications/:slug" element={<ApplicationPage />} />
      <Route path="/settings" element={<SettingsPage />}>
        <Route index element={<Navigate to="/settings/ai" replace />} />
        <Route path="ai" element={<AiSettings />} />
        <Route path="xray" element={<XraySettings />} />
        <Route path="ui" element={<UiSettings />} />
        <Route path="help" element={<HelpSection />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default AppRoutes;
