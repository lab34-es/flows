import React, { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { LifeBuoy, PanelLeftOpen, Search, X } from 'lucide-react';

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { iconFor } from '@/components/help/icons';
import { searchGroups, type HelpGroup } from '@/components/help/helpNavigation';
import { cn } from '@/lib/utils';

/** The contents list itself: every article under the heading of its category. */
function Contents({ groups, onNavigate }: { groups: HelpGroup[]; onNavigate?: () => void }) {
  if (groups.length === 0) {
    return (
      <p className="text-muted-foreground px-2 py-6 text-sm">
        No article matches that search.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <div key={group.id}>
          <div className="text-muted-foreground px-2 pb-1 text-xs font-semibold tracking-wide uppercase">
            {group.label}
          </div>
          <ul className="space-y-0.5">
            {group.topics.map((topic) => {
              const Icon = iconFor(topic.icon);
              return (
                <li key={topic.id}>
                  <NavLink
                    to={`/help/${topic.id}`}
                    onClick={onNavigate}
                    className={({ isActive }) => cn(
                      'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition',
                      isActive
                        ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                        : 'text-sidebar-foreground hover:bg-sidebar-accent/60'
                    )}
                  >
                    <Icon className="size-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{topic.title}</span>
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

/**
 * The Help screen: a sidebar of its own on the left listing every article the
 * tool ships with — generated from `components/help/topics/*.md` and grouped
 * by category — and the selected article on the right. Every article is a
 * route of its own, so it can be linked to and the back button behaves.
 */
export function HelpPage() {
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState(false);
  const location = useLocation();

  const groups = useMemo(() => searchGroups(query), [query]);

  // On small screens the contents are a drop-down: opening an article closes it.
  useEffect(() => { setMenu(false); }, [location.pathname]);

  const search = (
    <div className="relative">
      <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search the help…"
        aria-label="Search help"
        className="pr-9 pl-9"
      />
      {query && (
        <button
          type="button"
          onClick={() => setQuery('')}
          aria-label="Clear search"
          className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2 rounded p-1"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );

  return (
    <div className="flex w-full flex-1 items-stretch">
      {/* ------------------------------ Contents ---------------------------- */}
      {/* 3rem is the app header above this screen: the column fills what is left. */}
      <nav
        aria-label="Help contents"
        className="bg-sidebar sticky top-0 hidden h-[calc(100svh-3rem)] w-64 shrink-0 self-start overflow-y-auto border-r p-3 sm:block"
      >
        <div className="bg-sidebar sticky top-0 z-10 space-y-2 pb-3">
          <div className="text-muted-foreground flex items-center gap-1.5 px-2 pt-1 text-xs font-semibold tracking-wide uppercase">
            <LifeBuoy className="size-3.5" /> Help
          </div>
          {search}
        </div>
        <Contents groups={groups} />
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Small screens get the same list behind a disclosure */}
        <Collapsible open={menu} onOpenChange={setMenu} className="sm:hidden">
          <div className="bg-background/95 supports-[backdrop-filter]:bg-background/80 sticky top-0 z-20 border-b backdrop-blur">
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="hover:bg-accent flex w-full items-center gap-2 px-4 py-2 text-sm font-medium transition"
              >
                <PanelLeftOpen className="size-4" /> Help contents
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="max-h-[60svh] space-y-3 overflow-y-auto border-t p-3">
                {search}
                <Contents groups={groups} onNavigate={() => setMenu(false)} />
              </div>
            </CollapsibleContent>
          </div>
        </Collapsible>

        <div className="mx-auto w-full max-w-3xl p-6">
          <Outlet />
        </div>
      </div>
    </div>
  );
}

export default HelpPage;
