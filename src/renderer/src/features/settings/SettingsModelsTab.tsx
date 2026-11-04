import type { AppTextKey } from "@openbot/i18n";
import {
  Button,
  Checkbox,
  IconButton,
  Input,
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SettingsSection,
} from "@openbot/ui";
import { readModelFavorites } from "@openbot/ui/components/model-favorites";
import { useText } from "@openbot/ui/text";
import { createMemo, createSignal, For, Show } from "solid-js";
import { useAgentsOptional } from "../agents/agents-context";
import {
  computeSeatMoves,
  DEFAULT_OUTPUT_CAP,
  formatOutputCapPrompt,
  getModelEffort,
  MAX_SEAT_RUNGS,
  type ModelSeat,
  readSeats,
  type SeatReasoningEffort,
  type SeatsState,
  seatModelKey,
  writeSeats,
} from "./model-seats";

/** Seat kinds as literal keys, never template-built (the i18n check reads literals only). */
const KIND_LABEL: Record<string, AppTextKey> = {
  failover: "settings.models.kind.failover",
  escalation: "settings.models.kind.escalation",
};
const RUNG_LABELS: Record<string, AppTextKey[]> = {
  failover: [
    "settings.models.rung.primary",
    "settings.models.rung.backup",
    "settings.models.rung.backup",
    "settings.models.rung.backup",
    "settings.models.rung.backup",
    "settings.models.rung.backup",
    "settings.models.rung.backup",
  ],
  escalation: [
    "settings.models.rung.first",
    "settings.models.rung.settle",
    "settings.models.rung.final",
    "settings.models.rung.lastResort",
    "settings.models.rung.lastResort",
    "settings.models.rung.lastResort",
    "settings.models.rung.lastResort",
  ],
};
const rungLabel = (kind: string, index: number): AppTextKey =>
  (RUNG_LABELS[kind] ?? RUNG_LABELS.failover ?? [])[index] ?? "settings.models.rung.backup";

const kindLabel = (kind: string): AppTextKey => KIND_LABEL[kind] ?? "settings.models.kind.failover";

/**
 * The Models & seats tab (owner 2026-11-03, the seats mockup): named model chains a workflow or
 * the harness binds to instead of raw model ids, with a per-model concurrency budget and named
 * presets that flip every seat at once ("GLM month", "Gemini month"). Everything lives in the
 * seats store; the harness's apply_seats.cjs moves the live agents onto the seats.
 */
export function SettingsModelsTab() {
  const { t } = useText();
  // The settings modal may open outside the agents provider tree; an empty list keeps the seats
  // editable (rungs still save) and only the model dropdowns stay empty until a provider exists.
  const agents = useAgentsOptional();
  const modelOptions = () => agents?.modelOptions?.() ?? [];
  const [state, setState] = createSignal<SeatsState>(readSeats());
  const [presetName, setPresetName] = createSignal("");

  const save = (next: SeatsState): void => {
    setState(next);
    writeSeats(next);
  };
  const update = (change: (current: SeatsState) => SeatsState): void => save(change(state()));

  /** The rung pickers' shared options: pinned models only when any exist, every model otherwise
   * (owner 2026-11-03: pin in Providers & models, then the seat chains follow). */
  const models = createMemo(() => {
    const favorites = readModelFavorites();
    const all = modelOptions().map((option) => ({
      key: `${option.provider}:${option.id}`,
      label: `${option.provider} — ${option.id}`,
    }));
    if (favorites.size === 0) return all;
    return all.filter((entry) => favorites.has(entry.key));
  });
  const labelOf = (key: string): string => models().find((entry) => entry.key === key)?.label ?? key;

  const changeRung = (seat: ModelSeat, index: number, key: string | null): void => {
    if (!key) return;
    update((current) => ({
      ...current,
      seats: current.seats.map((entry) =>
        entry.id === seat.id
          ? {
              ...entry,
              rungs: entry.rungs.map((rung, at) =>
                at === index
                  ? { provider: key.slice(0, key.indexOf(":")), model: key.slice(key.indexOf(":") + 1) }
                  : rung,
              ),
            }
          : entry,
      ),
    }));
  };
  const addRung = (seat: ModelSeat, key: string | null): void => {
    if (!key || seat.rungs.length >= MAX_SEAT_RUNGS) return;
    const provider = key.slice(0, key.indexOf(":"));
    const model = key.slice(key.indexOf(":") + 1);
    update((current) => ({
      ...current,
      seats: current.seats.map((entry) =>
        entry.id === seat.id ? { ...entry, rungs: [...entry.rungs, { provider, model, effort: "default" }] } : entry,
      ),
    }));
  };
  const removeRung = (seat: ModelSeat, index: number): void => {
    update((current) => ({
      ...current,
      seats: current.seats.map((entry) =>
        entry.id === seat.id ? { ...entry, rungs: entry.rungs.filter((_, at) => at !== index) } : entry,
      ),
    }));
  };
  const moveRung = (seat: ModelSeat, index: number, delta: -1 | 1): void => {
    update((current) => ({
      ...current,
      seats: current.seats.map((entry) => {
        const to = index + delta;
        if (entry.id !== seat.id || to < 0 || to >= entry.rungs.length) return entry;
        const rungs = [...entry.rungs];
        const moved = rungs[index];
        if (moved === undefined) return entry;
        rungs.splice(index, 1);
        rungs.splice(to, 0, moved);
        return { ...entry, rungs };
      }),
    }));
  };
  /** Every model a seat names, plus the picker favorites: each can carry a budget. */
  const budgeted = createMemo(() => {
    const keys = new Set<string>();
    for (const seat of state().seats) for (const rung of seat.rungs) keys.add(seatModelKey(rung));
    for (const favorite of readModelFavorites()) keys.add(favorite);
    return [...keys];
  });
  const setBudget = (key: string, value: number): void => {
    update((current) => ({ ...current, budgets: { ...current.budgets, [key]: Math.max(1, value) } }));
  };
  const isBudgetEnabled = (key: string): boolean => state().enabledBudgets?.[key] !== false;
  const toggleBudgetEnabled = (key: string, enabled: boolean): void => {
    update((current) => ({
      ...current,
      enabledBudgets: { ...current.enabledBudgets, [key]: enabled },
    }));
  };
  const isOutputCapEnabled = (key: string): boolean => Boolean(state().enabledOutputCaps?.[key]);
  const getOutputCap = (key: string): number => {
    const val = state().outputCaps?.[key];
    return typeof val === "number" && val > 0 ? val : DEFAULT_OUTPUT_CAP;
  };
  const toggleOutputCap = (key: string, enabled: boolean): void => {
    update((current) => {
      const currentCap = current.outputCaps?.[key];
      const nextCap = typeof currentCap === "number" && currentCap > 0 ? currentCap : DEFAULT_OUTPUT_CAP;
      return {
        ...current,
        enabledOutputCaps: { ...current.enabledOutputCaps, [key]: enabled },
        outputCaps: { ...current.outputCaps, [key]: nextCap },
      };
    });
  };
  const setOutputCap = (key: string, rawValue: number): void => {
    const clamped = Number.isFinite(rawValue) ? Math.max(1000, Math.round(rawValue)) : DEFAULT_OUTPUT_CAP;
    update((current) => ({
      ...current,
      outputCaps: { ...current.outputCaps, [key]: clamped },
    }));
  };
  const setModelEffort = (key: string, effort: SeatReasoningEffort): void => {
    update((current) => ({
      ...current,
      modelEfforts: { ...current.modelEfforts, [key]: effort },
    }));
  };
  const setSeatDefaultEffort = (seatId: string, effort: SeatReasoningEffort): void => {
    update((current) => ({
      ...current,
      seats: current.seats.map((seat) => (seat.id === seatId ? { ...seat, defaultEffort: effort } : seat)),
    }));
  };
  const changeRungEffort = (seat: ModelSeat, index: number, effort: SeatReasoningEffort): void => {
    const nextRungs = seat.rungs.map((rung, i) => (i === index ? { ...rung, effort } : rung));
    update((current) => ({
      ...current,
      seats: current.seats.map((entry) => (entry.id === seat.id ? { ...entry, rungs: nextRungs } : entry)),
    }));
  };

  const savePreset = (): void => {
    const name = presetName().trim();
    if (!name) return;
    update((current) => ({
      ...current,
      presets: [...current.presets.filter((preset) => preset.name !== name), { name, seats: current.seats }],
    }));
    setPresetName("");
  };
  const [applying, setApplying] = createSignal(false);
  const [appliedCount, setAppliedCount] = createSignal<number | null>(null);

  const applySeatsToLiveAgents = async (stateToApply: SeatsState = state()): Promise<void> => {
    if (!agents?.updateAgent || !agents.agentList) return;
    setApplying(true);
    try {
      const liveList = agents.agentList();
      const moves = computeSeatMoves(stateToApply, liveList);
      for (const move of moves) {
        await agents.updateAgent(move.agentId, {
          provider: move.provider,
          model: move.model,
          backupModels: { automatic: true, order: move.backups },
        });
      }
      setAppliedCount(moves.length);
      setTimeout(() => setAppliedCount(null), 3500);
    } catch {
      // Ignored: failures leave existing agent configurations intact
    } finally {
      setApplying(false);
    }
  };

  const applyPreset = (name: string): void => {
    const preset = state().presets.find((entry) => entry.name === name);
    if (preset) {
      update((current) => ({ ...current, seats: preset.seats }));
      void applySeatsToLiveAgents({ ...state(), seats: preset.seats });
    }
  };

  return (
    <SettingsSection title={t("settings.models.title")} description={t("settings.models.description")}>
      <div style={{ display: "flex", "justify-content": "flex-end", "margin-bottom": "var(--openbot-spacing-sm)" }}>
        <Button
          variant={appliedCount() !== null ? "secondary" : "outline"}
          size="sm"
          loading={applying()}
          disabled={applying()}
          onClick={() => void applySeatsToLiveAgents()}
        >
          {appliedCount() !== null ? `✓ Applied to ${appliedCount()} agents` : "Apply seats to agents"}
        </Button>
      </div>
      <ItemGroup class="settings-modal-card">
        <For each={state().seats}>
          {(seat) => (
            <Item class="settings-modal-row">
              <ItemContent>
                <ItemTitle>
                  {seat.name}
                  <span class="seat-kind-badge" data-kind={seat.kind}>
                    {t(kindLabel(seat.kind))}
                  </span>
                  <Select<SeatReasoningEffort>
                    class="settings-modal-select seat-default-effort-select"
                    options={["default", "none", "low", "medium", "high"]}
                    value={seat.defaultEffort ?? "default"}
                    onChange={(val) => val && setSeatDefaultEffort(seat.id, val)}
                    itemComponent={(selectProps) => (
                      <SelectItem item={selectProps.item}>{selectProps.item.rawValue}</SelectItem>
                    )}
                  >
                    <SelectTrigger size="sm" aria-label={t("settings.models.seat.thinkingAria", { seat: seat.name })}>
                      <SelectValue<SeatReasoningEffort>>
                        {(selectState) => selectState.selectedOption() ?? "default"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent />
                  </Select>
                </ItemTitle>
                <ItemDescription>
                  <For each={seat.rungs}>
                    {(rung, index) => (
                      <span class="seat-rung">
                        <span class="seat-rung-badge" data-kind={seat.kind}>
                          {t(rungLabel(seat.kind, index()))}
                        </span>
                        <Show when={index() > 0 && seat.kind === "escalation"}>
                          <span class="seat-rung-arrow" aria-hidden="true">
                            ↗
                          </span>
                        </Show>
                        <Show when={index() > 0 && seat.kind === "failover"}>
                          <span class="seat-rung-arrow" aria-hidden="true">
                            →
                          </span>
                        </Show>
                        <Show when={index() > 0}>
                          <IconButton
                            label={t("settings.models.rung.up")}
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => moveRung(seat, index(), -1)}
                          >
                            ↑
                          </IconButton>
                        </Show>
                        <Select<string>
                          class="settings-modal-select"
                          options={models().map((entry) => entry.key)}
                          value={seatModelKey(rung)}
                          onChange={(key) => changeRung(seat, index(), key)}
                          itemComponent={(selectProps) => (
                            <SelectItem item={selectProps.item}>{labelOf(selectProps.item.rawValue)}</SelectItem>
                          )}
                        >
                          <SelectTrigger
                            size="sm"
                            aria-label={t("settings.models.rung.label", { number: index() + 1 })}
                          >
                            <SelectValue<string>>{(selectState) => labelOf(selectState.selectedOption())}</SelectValue>
                          </SelectTrigger>
                          <SelectContent />
                        </Select>
                        <Select<SeatReasoningEffort>
                          class="settings-modal-select seat-rung-effort-select"
                          options={["default", "none", "low", "medium", "high"]}
                          value={rung.effort ?? "default"}
                          onChange={(val) => val && changeRungEffort(seat, index(), val)}
                          itemComponent={(selectProps) => (
                            <SelectItem item={selectProps.item}>{selectProps.item.rawValue}</SelectItem>
                          )}
                        >
                          <SelectTrigger
                            size="sm"
                            aria-label={t("settings.models.rung.thinkingAria", { number: index() + 1 })}
                          >
                            <SelectValue<SeatReasoningEffort>>
                              {(selectState) => selectState.selectedOption() ?? "default"}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent />
                        </Select>
                        <IconButton
                          label={t("settings.models.rung.remove")}
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => removeRung(seat, index())}
                        >
                          ✕
                        </IconButton>
                      </span>
                    )}
                  </For>
                  <Show when={seat.rungs.length < MAX_SEAT_RUNGS}>
                    <Select<string>
                      class="settings-modal-select"
                      options={models().map((entry) => entry.key)}
                      value={null}
                      placeholder={t("settings.models.rung.add")}
                      onChange={(key) => addRung(seat, key)}
                      itemComponent={(selectProps) => (
                        <SelectItem item={selectProps.item}>{labelOf(selectProps.item.rawValue)}</SelectItem>
                      )}
                    >
                      <SelectTrigger size="sm" aria-label={t("settings.models.rung.add")}>
                        <SelectValue<string>>
                          {(selectState) =>
                            selectState.selectedOption()
                              ? labelOf(selectState.selectedOption())
                              : t("settings.models.rung.add")
                          }
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent />
                    </Select>
                  </Show>
                </ItemDescription>
              </ItemContent>
            </Item>
          )}
        </For>
      </ItemGroup>

      <ItemGroup class="settings-modal-card">
        <Item class="settings-modal-row">
          <ItemContent>
            <ItemTitle>{t("settings.models.budgets.title")}</ItemTitle>
            <ItemDescription>{t("settings.models.budgets.description")}</ItemDescription>
            <div class="seat-budgets-table-wrapper">
              <table class="seat-budgets-table">
                <thead>
                  <tr>
                    <th class="seat-budget-th-check">{t("settings.models.budget.active")}</th>
                    <th class="seat-budget-th-model">{t("settings.models.budget.model")}</th>
                    <th class="seat-budget-th-concurrency">{t("settings.models.budget.concurrency")}</th>
                    <th class="seat-budget-th-extra">{t("settings.models.budget.status")}</th>
                    <th class="seat-budget-th-outcap">{t("settings.models.outputCap")}</th>
                    <th class="seat-budget-th-effort">{t("settings.models.budget.thinking")}</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={budgeted()}>
                    {(key) => {
                      const active = () => isBudgetEnabled(key);
                      const capOn = () => isOutputCapEnabled(key);
                      const capTokens = () => getOutputCap(key);
                      const currentEffort = () => getModelEffort(state(), key);
                      return (
                        <tr class="seat-budget-row" data-active={active()}>
                          <td class="seat-budget-td-check">
                            <Checkbox
                              checked={active()}
                              onChange={(e) => toggleBudgetEnabled(key, e.currentTarget.checked)}
                              aria-label={t("settings.models.budget.toggle", { model: labelOf(key) })}
                            />
                          </td>
                          <td class="seat-budget-td-model">
                            <span class={`seat-budget-model-name ${!active() ? "is-disabled" : ""}`}>
                              {labelOf(key)}
                            </span>
                          </td>
                          <td class="seat-budget-td-concurrency">
                            <span class={`seat-budget-stepper ${!active() ? "is-disabled" : ""}`}>
                              <IconButton
                                label={t("settings.models.budget.lower")}
                                variant="outline"
                                size="icon-sm"
                                disabled={!active()}
                                onClick={() => setBudget(key, (state().budgets[key] ?? 3) - 1)}
                              >
                                −
                              </IconButton>
                              <span class="seat-budget-value">{state().budgets[key] ?? 3}</span>
                              <IconButton
                                label={t("settings.models.budget.raise")}
                                variant="outline"
                                size="icon-sm"
                                disabled={!active()}
                                onClick={() => setBudget(key, (state().budgets[key] ?? 3) + 1)}
                              >
                                ＋
                              </IconButton>
                            </span>
                          </td>
                          <td class="seat-budget-td-extra">
                            <span class="seat-budget-status-tag" data-active={active()}>
                              {active() ? t("settings.models.budget.active") : t("settings.models.budget.bypassed")}
                            </span>
                          </td>
                          <td class="seat-budget-td-outcap">
                            <div
                              class="seat-outcap-controls"
                              title={capOn() ? formatOutputCapPrompt(capTokens()) : t("settings.models.outputCap.off")}
                            >
                              <Checkbox
                                checked={capOn()}
                                onChange={(e) => toggleOutputCap(key, e.currentTarget.checked)}
                                aria-label={t("settings.models.outputCap.toggle")}
                              />
                              <Input
                                type="number"
                                size="sm"
                                min="1000"
                                step="1000"
                                disabled={!capOn()}
                                value={String(capTokens())}
                                onValueChange={(val) => setOutputCap(key, Number.parseInt(val, 10))}
                                aria-label={t("settings.models.outputCap.value")}
                                class={`seat-outcap-input ${!capOn() ? "is-disabled" : ""}`}
                              />
                              <span class={`seat-outcap-unit ${!capOn() ? "is-disabled" : ""}`}>
                                {t("settings.models.budget.tokMax")}
                              </span>
                            </div>
                          </td>
                          <td class="seat-budget-td-effort">
                            <Select<SeatReasoningEffort>
                              class="settings-modal-select seat-effort-select"
                              options={["default", "none", "low", "medium", "high"]}
                              value={currentEffort()}
                              onChange={(val) => val && setModelEffort(key, val)}
                              itemComponent={(selectProps) => (
                                <SelectItem item={selectProps.item}>{selectProps.item.rawValue}</SelectItem>
                              )}
                            >
                              <SelectTrigger
                                size="sm"
                                aria-label={t("settings.models.budget.thinkingAria", { model: labelOf(key) })}
                              >
                                <SelectValue<SeatReasoningEffort>>
                                  {(selectState) => selectState.selectedOption() ?? "default"}
                                </SelectValue>
                              </SelectTrigger>
                              <SelectContent />
                            </Select>
                          </td>
                        </tr>
                      );
                    }}
                  </For>
                </tbody>
              </table>
            </div>
          </ItemContent>
        </Item>
      </ItemGroup>

      <ItemGroup class="settings-modal-card">
        <Item class="settings-modal-row">
          <ItemContent>
            <ItemTitle>{t("settings.models.presets.title")}</ItemTitle>
            <ItemDescription>{t("settings.models.presets.description")}</ItemDescription>
            <For each={state().presets}>
              {(preset) => (
                <span class="seat-preset">
                  <Button variant="outline" size="icon-sm" onClick={() => applyPreset(preset.name)}>
                    {preset.name}
                  </Button>
                  <IconButton
                    label={t("settings.models.presets.delete")}
                    variant="ghost"
                    size="icon-sm"
                    onClick={() =>
                      update((current) => ({
                        ...current,
                        presets: current.presets.filter((entry) => entry.name !== preset.name),
                      }))
                    }
                  >
                    ✕
                  </IconButton>
                </span>
              )}
            </For>
            <span class="seat-preset-new">
              <Input
                value={presetName()}
                onValueChange={setPresetName}
                placeholder={t("settings.models.presets.name")}
                aria-label={t("settings.models.presets.name")}
              />
              <Button variant="outline" size="icon-sm" onClick={savePreset}>
                {t("settings.models.presets.save")}
              </Button>
            </span>
          </ItemContent>
        </Item>
      </ItemGroup>
    </SettingsSection>
  );
}
