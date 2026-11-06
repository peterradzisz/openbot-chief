// Copyright (c) 2026 Peter Radziszewski. Independently developed for this fork. All rights reserved.
/**
 * Fork: Auto-approve. The host's note on an approval step that it decided by itself. Upstream's
 * `WorkflowApprovalNode.tsx` mounts it with one line while the user has not answered. See docs/FORK.md.
 */

import { CircleCheck } from "@openbot/ui";
import { Show } from "solid-js";
import { useBoard } from "../workflow-board";

export function WorkflowDecisionNote(props: { id: string; answered: boolean }) {
  const board = useBoard();
  return (
    <Show when={props.answered ? undefined : board.decisionNote?.(props.id)}>
      {(note) => (
        <p class="wfn-alert" data-tone="success">
          <CircleCheck aria-hidden="true" />
          <span class="wfn-alert-text">{note()}</span>
        </p>
      )}
    </Show>
  );
}
