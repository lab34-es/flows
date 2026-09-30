import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { CloudUpload, Palette, Sparkles, Ticket } from 'lucide-react';

import { cn } from '@/lib/utils';

const SECTIONS = [
  {
    to: '/settings/ai',
    label: 'AI',
    description: 'Provider, model and keys',
    icon: Sparkles,
  },
  {
    to: '/settings/xray',
    label: 'Xray',
    description: 'Jira integration',
    icon: Ticket,
  },
  {
    to: '/settings/sharepoint',
    label: 'SharePoint',
    description: 'Where reports are uploaded',
    icon: CloudUpload,
  },
  {
    to: '/settings/ui',
    label: 'UI',
    description: 'Theme and appearance',
    icon: Palette,
  },
];

/**
 * The Settings screen: a sidebar of its own on the left, the selected section
 * on the right. Every section is a route, so it can be linked to and the back
 * button behaves.
 */
export function SettingsPage() {
  return (
    <div className="flex w-full flex-1 items-stretch">
      {/* ----------------------------- Sections ---------------------------- */}
      {/* 3rem is the app header above this screen: the column fills what is left. */}
      <nav
        aria-label="Settings sections"
        className="bg-sidebar sticky top-0 hidden h-[calc(100svh-3rem)] w-56 shrink-0 self-start overflow-y-auto border-r p-3 sm:block"
      >
        <div className="text-muted-foreground px-2 pt-1 pb-2 text-xs font-semibold tracking-wide uppercase">
          Settings
        </div>
        <ul className="space-y-1">
          {SECTIONS.map((section) => {
            const Icon = section.icon;
            return (
              <li key={section.to}>
                <NavLink
                  to={section.to}
                  className={({ isActive }) => cn(
                    'flex items-start gap-2 rounded-md px-2 py-2 text-sm transition',
                    isActive
                      ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                      : 'text-sidebar-foreground hover:bg-sidebar-accent/60'
                  )}
                >
                  <Icon className="mt-0.5 size-4 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{section.label}</span>
                    <span className="text-muted-foreground block truncate text-xs">
                      {section.description}
                    </span>
                  </span>
                </NavLink>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Small screens get the same list as a scrollable row of tabs */}
      <div className="flex min-w-0 flex-1 flex-col">
        <nav
          aria-label="Settings sections"
          className="bg-background/95 supports-[backdrop-filter]:bg-background/80 sticky top-0 z-20 flex gap-1 overflow-x-auto border-b p-2 backdrop-blur sm:hidden"
        >
          {SECTIONS.map((section) => {
            const Icon = section.icon;
            return (
              <NavLink
                key={section.to}
                to={section.to}
                className={({ isActive }) => cn(
                  'flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition',
                  isActive
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                )}
              >
                <Icon className="size-3.5" /> {section.label}
              </NavLink>
            );
          })}
        </nav>

        <div className="mx-auto w-full max-w-3xl p-6">
          <Outlet />
        </div>
      </div>
    </div>
  );
}

export default SettingsPage;
