import type { AppTextKey } from "@openbot/i18n";
import {
  Button,
  ChevronDown,
  ChevronRight,
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
import { useText } from "@openbot/ui/text";
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { useAgentsOptional } from "../agents/agents-context";
import { readSeats, type SeatReasoningEffort, type SeatsState, writeSeats } from "./model-seats";

const KIND_LABEL: Record<string, AppTextKey> = {
  failover: "settings.models.kind.failover",
  escalation: "settings.models.kind.escalation",
};
const kindLabel = (kind: string): AppTextKey => KIND_LABEL[kind] ?? "settings.models.kind.failover";

/** Local input that preserves focus while typing without triggering full list reconciliation on every keystroke. */
function SeatNameInput(props: { value: string; onCommit: (name: string) => void; ariaLabel: string }) {
  const [val, setVal] = createSignal(props.value);
  createEffect(
    () => props.value,
    (next) => {
      setVal(next);
    },
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const commit = (next: string) => {
    clearTimeout(timer);
    if (next !== props.value) {
      props.onCommit(next);
    }
  };
  const handleChange = (next: string) => {
    setVal(next);
    clearTimeout(timer);
    timer = setTimeout(() => {
      commit(next);
    }, 500);
  };
  onCleanup(() => clearTimeout(timer));
  return (
    <Input
      size="sm"
      value={val()}
      onValueChange={handleChange}
      onBlur={() => commit(val())}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          commit(val());
          if (e.currentTarget instanceof HTMLElement) {
            e.currentTarget.blur();
          }
        }
      }}
      aria-label={props.ariaLabel}
      class="seat-name-input"
    />
  );
}

/**
 * The Agent seats tab (owner 2026-11-03): which agents belong to which seat, and whether that
 * seat runs a failover chain or an escalation ladder. The chains themselves (rungs, budgets,
 * presets) live in Models & seats below.
 */
export function SettingsAgentSeatsTab() {
  const { t } = useText();
  const agents = useAgentsOptional();
  const [state, setState] = createSignal<SeatsState>(readSeats());
  const [collapsedSeats, setCollapsedSeats] = createSignal<Record<string, boolean>>({});

  const toggleCollapse = (seatId: string): void => {
    setCollapsedSeats((prev) => ({ ...prev, [seatId]: !prev[seatId] }));
  };

  const save = (next: SeatsState): void => {
    setState(next);
    writeSeats(next);
  };
  const update = (change: (current: SeatsState) => SeatsState): void => save(change(state()));

  const agentNames = createMemo(() => (agents?.agentList?.() ?? []).map((agent) => agent.name));
  const boundAgents = (seatId: string): string[] => state().bindings[seatId] ?? [];

  const setKind = (seatId: string, kind: string | null): void => {
    if (kind !== "failover" && kind !== "escalation") return;
    update((current) => ({
      ...current,
      seats: current.seats.map((entry) => (entry.id === seatId ? { ...entry, kind } : entry)),
    }));
  };
  const addSeat = (): void => {
    const id = `seat-${Date.now().toString(36)}`;
    update((current) => ({
      ...current,
      seats: [...current.seats, { id, name: "New seat", kind: "failover", rungs: [] }],
    }));
  };
  const removeSeat = (seatId: string): void => {
    update((current) => {
      const bindings = { ...current.bindings };
      delete bindings[seatId];
      return { ...current, seats: current.seats.filter((entry) => entry.id !== seatId), bindings };
    });
  };
  const renameSeat = (seatId: string, name: string): void => {
    update((current) => {
      const target = current.seats.find((entry) => entry.id === seatId);
      if (target) {
        target.name = name;
      }
      return { ...current, seats: [...current.seats] };
    });
  };
  const setSeatDefaultEffort = (seatId: string, effort: SeatReasoningEffort): void => {
    update((current) => ({
      ...current,
      seats: current.seats.map((seat) => (seat.id === seatId ? { ...seat, defaultEffort: effort } : seat)),
    }));
  };
  const toggleAgentBinding = (seatId: string, agentName: string): void => {
    update((current) => {
      const bound = current.bindings[seatId] ?? [];
      const next = bound.includes(agentName) ? bound.filter((name) => name !== agentName) : [...bound, agentName];
      return { ...current, bindings: { ...current.bindings, [seatId]: next } };
    });
  };

  return (
    <SettingsSection title={t("settings.agentSeats.title")} description={t("settings.agentSeats.description")}>
      <Button variant="outline" size="sm" onClick={addSeat}>
        {t("settings.agentSeats.add")}
      </Button>

      <For each={state().seats}>
        {(seat) => {
          const isCollapsed = () => Boolean(collapsedSeats()[seat.id]);
          return (
            <ItemGroup class="settings-modal-card">
              <Item class="settings-modal-row">
                <ItemContent>
                  <ItemTitle class="seat-header-row">
                    <IconButton
                      label={isCollapsed() ? "Expand category" : "Collapse category"}
                      variant="ghost"
                      size="icon-sm"
                      class="seat-collapse-button"
                      onClick={() => toggleCollapse(seat.id)}
                    >
                      <Show when={isCollapsed()} fallback={<ChevronDown aria-hidden="true" />}>
                        <ChevronRight aria-hidden="true" />
                      </Show>
                    </IconButton>
                    <SeatNameInput
                      value={seat.name}
                      onCommit={(name) => renameSeat(seat.id, name)}
                      ariaLabel={t("settings.agentSeats.name")}
                    />
                    <Select<string>
                      class="seat-kind-select"
                      options={["failover", "escalation"]}
                      value={seat.kind}
                      onChange={(kind) => setKind(seat.id, kind)}
                      itemComponent={(selectProps) => (
                        <SelectItem item={selectProps.item}>{t(kindLabel(selectProps.item.rawValue))}</SelectItem>
                      )}
                    >
                      <SelectTrigger size="sm" aria-label={t("settings.models.seat.kind")}>
                        <SelectValue<string>>
                          {(selectState) => t(kindLabel(selectState.selectedOption() ?? "failover"))}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent />
                    </Select>
                    <Select<SeatReasoningEffort>
                      class="seat-kind-select"
                      options={["default", "none", "low", "medium", "high"]}
                      value={seat.defaultEffort ?? "default"}
                      onChange={(effort) => effort && setSeatDefaultEffort(seat.id, effort)}
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
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      class="seat-agents-count"
                      onClick={() => toggleCollapse(seat.id)}
                      aria-label={`${seat.name}`}
                    >
                      {`${boundAgents(seat.id).length}`}
                    </Button>
                    <IconButton
                      label={t("settings.agentSeats.remove")}
                      variant="ghost"
                      size="icon-sm"
                      class="seat-remove-button"
                      onClick={() => removeSeat(seat.id)}
                    >
                      ✕
                    </IconButton>
                  </ItemTitle>

                  <Show when={!isCollapsed() && agentNames().length > 0}>
                    <ItemDescription class="seat-agents-list">
                      <For each={agentNames()}>
                        {(name) => (
                          <Button
                            variant={boundAgents(seat.id).includes(name) ? "outline" : "ghost"}
                            size="sm"
                            class="seat-binding-chip"
                            onClick={() => toggleAgentBinding(seat.id, name)}
                          >
                            {boundAgents(seat.id).includes(name) ? "● " : "○ "}
                            {name}
                          </Button>
                        )}
                      </For>
                    </ItemDescription>
                  </Show>
                </ItemContent>
              </Item>
            </ItemGroup>
          );
        }}
      </For>
    </SettingsSection>
  );
}
