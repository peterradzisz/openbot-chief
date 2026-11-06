// Copyright (c) 2026 Peter Radziszewski. Independently developed for this fork. All rights reserved.
/**
 * Fork: Auto-approve on an All workflows card. The switch turns it on and
 * off; the badge shows that it is on, apart from the Paused badge. Auto-approve decides the approval
 * steps that the workflow's runs reach from then on; an approval that already waits stays.
 */

import { Badge, SwitchField } from "@openbot/ui";
import { Show } from "solid-js";
import { useText } from "../../text";

/** "Auto-approves", on a card whose workflow has Auto-approve on. */
export function AutoApproveBadge(props: { on: boolean | undefined }) {
  const { t } = useText();
  return (
    <Show when={props.on}>
      <Badge
        variant="success-outline"
        class="wfo-auto-approve-badge"
        title={t("fork.workflow.overview.autoApproveHint")}
      >
        {t("fork.workflow.overview.autoApproveOn")}
      </Badge>
    </Show>
  );
}

/** The Auto-approve switch of one card. */
export function AutoApproveToggle(props: {
  on: boolean | undefined;
  disabled: boolean;
  onChange: (enabled: boolean) => void;
}) {
  const { t } = useText();
  return (
    <SwitchField
      class="wfo-auto-approve"
      size="sm"
      checked={props.on === true}
      disabled={props.disabled}
      onChange={(enabled: boolean) => props.onChange(enabled)}
      label={<span title={t("fork.workflow.overview.autoApproveHint")}>{t("fork.workflow.overview.autoApprove")}</span>}
    />
  );
}
