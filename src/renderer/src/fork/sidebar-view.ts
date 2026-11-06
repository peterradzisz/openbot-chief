// Copyright (c) 2026 Peter Radziszewski. Independently developed for this fork. All rights reserved.
import type { SidebarView } from "@openbot/ui/features/sidebar/sidebar-types";

/** The part of the layout that says which list the sidebar shows. */
interface SidebarViewLayout {
  sidebarView: () => SidebarView;
  setSidebarView: (view: SidebarView) => void;
}

/**
 * Picking an agent (or starting a thread with one) while the sidebar shows routines switches it back
 * to the agents list, so the chosen agent is visible (fork). Called from WorkspaceSidebar.tsx through
 * `// FORK:` hooks.
 */
export function leaveRoutinesView(layout: SidebarViewLayout): void {
  if (layout.sidebarView() === "routines") layout.setSidebarView("agents");
}

/** `select`, run after `leaveRoutinesView`. */
export function selectingAgentLeavesRoutines(
  layout: SidebarViewLayout,
  select: (agentId: string) => boolean,
): (agentId: string) => boolean {
  return (agentId) => {
    leaveRoutinesView(layout);
    return select(agentId);
  };
}
