// Copyright (c) 2026 Peter Radziszewski. Independently developed for this fork. All rights reserved.
/**
 * Fork: provider time-off on the Providers & models tab. Each provider tile lists windows of
 * the local day in which no request passes to that provider; the host fails a workflow step over to another provider
 * or holds it until the window ends (src/main/application-services.ts, `isModelAtBudget` and `findAvailableBackup`).
 * The windows live in the seats store, so they follow the same save path as seats and budgets.
 */

import { isProviderOff, isTimeOfDay, type ProviderTimeOffWindow } from "@openbot/contracts/ipc";
import { Button, IconButton, Input } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createSignal, For, Show } from "solid-js";
import { readSeats, writeSeats } from "../features/settings/model-seats";

const NEW_WINDOW: ProviderTimeOffWindow = { from: "22:00", to: "07:00" };

export function ProviderTimeOff(props: { provider: string }) {
  const { t } = useText();
  const [windows, setWindows] = createSignal<ProviderTimeOffWindow[]>(
    readSeats().providerTimeOff?.[props.provider] ?? [],
  );

  /** Writes the valid windows. Merged into a fresh read, so another tile's windows are never overwritten. */
  const save = (next: ProviderTimeOffWindow[]): void => {
    setWindows(next);
    const state = readSeats();
    const all = { ...(state.providerTimeOff ?? {}) };
    const valid = next.filter((window) => isTimeOfDay(window.from) && isTimeOfDay(window.to));
    if (valid.length > 0) all[props.provider] = valid;
    else delete all[props.provider];
    writeSeats({ ...state, providerTimeOff: all });
  };
  const change = (index: number, field: "from" | "to", value: string): void =>
    save(windows().map((window, at) => (at === index ? { ...window, [field]: value } : window)));
  const offNow = () => isProviderOff({ [props.provider]: windows() }, props.provider, new Date());

  return (
    <div class="provider-time-off">
      <div class="provider-time-off-head">
        <span class="provider-time-off-title">{t("fork.provider.timeOff.title")}</span>
        <Show when={offNow()}>
          <span class="provider-time-off-now">{t("fork.provider.timeOff.offNow")}</span>
        </Show>
      </div>
      <p class="provider-time-off-hint">{t("fork.provider.timeOff.hint")}</p>
      <For each={windows()}>
        {(window, index) => (
          <div class="provider-time-off-row">
            <Input
              type="time"
              size="sm"
              aria-label={t("fork.provider.timeOff.from")}
              value={window.from}
              onValueChange={(value) => change(index(), "from", value)}
            />
            <span class="provider-time-off-to">{t("fork.provider.timeOff.to")}</span>
            <Input
              type="time"
              size="sm"
              aria-label={t("fork.provider.timeOff.to")}
              value={window.to}
              onValueChange={(value) => change(index(), "to", value)}
            />
            <IconButton
              label={t("fork.provider.timeOff.remove")}
              variant="ghost"
              size="icon-sm"
              onClick={() => save(windows().filter((_, at) => at !== index()))}
            >
              ✕
            </IconButton>
          </div>
        )}
      </For>
      <Button variant="outline" size="sm" onClick={() => save([...windows(), { ...NEW_WINDOW }])}>
        {t("fork.provider.timeOff.add")}
      </Button>
    </div>
  );
}
