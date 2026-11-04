/** An agent step: a task that one agent does, with the agent and its model. */

import { ProviderLogo } from "@openbot/brand";
import type { AgentModelId } from "@openbot/contracts/ipc";
import {
  Bot,
  Button,
  buttonVariants,
  ChartNoAxesColumnIncreasing,
  ChevronDown,
  DropdownMenu,
  Play,
  Sparkles,
  Textarea,
  TriangleAlert,
} from "@openbot/ui";
import { createMemo, Show, untrack } from "solid-js";
import type { AgentProfile } from "../../data";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";
import { PickerMenu, type PickerOption } from "./WorkflowPicker";
import { useBoard } from "./workflow-board";
import type { WorkflowCatalogs } from "./workflow-model";
import { ModelPill, modelOption } from "./workflow-model-pills";
import {
  asBoolean,
  asProvider,
  asString,
  Field,
  NodeShell,
  NodeToolbar,
  ResultField,
  useField,
  useLocked,
  useStepRun,
  useTextField,
  type WfProvider,
  wfProviderLogo,
} from "./workflow-node-parts";
import { type ModelSeat, readModelSeats, resolveSeatChoice } from "./workflow-seats";

/* --------------------------------------------------------------- Agent */

/** Each agent with its title and the model that it runs on. */
function agentOptions(catalogs: WorkflowCatalogs): PickerOption<string>[] {
  return catalogs.agents.map((agent) => ({
    value: agent.id,
    label: agent.name,
    tile: () => <AgentAvatar agent={agent} motion="idle" />,
    chips: [
      { text: agent.title },
      {
        icon: () => <ProviderLogo provider={wfProviderLogo(agent.provider)} class="wfn-model-logo" />,
        text: modelOption(catalogs.models, agent.model)?.name ?? agent.model,
      },
    ],
  }));
}

/**
 * The agent of a step. A step with no agent asks for one. An agent that the user deleted shows a
 * warning and opens the same list.
 */
function AgentPill(props: {
  agent: AgentProfile | undefined;
  /** True when the step names an agent that is not in the catalog. */
  removed: boolean;
  disabled?: boolean;
  onChange: (agent: AgentProfile) => void;
}) {
  const board = useBoard();
  const { t } = useText();
  const label = () => {
    if (props.agent) return t("workflow.agent.pill", { name: props.agent.name });
    return props.removed ? t("workflow.agent.removedLabel") : t("workflow.agent.choose");
  };
  return (
    <DropdownMenu.Root placement="bottom-start" gutter={6}>
      <DropdownMenu.Trigger
        class={`${buttonVariants({ variant: "ghost", size: "xs" })} wfn-pill wfn-agent-pill`}
        data-missing={props.removed ? "" : undefined}
        aria-label={label()}
        disabled={props.disabled}
      >
        <Show
          when={props.agent}
          fallback={
            <Show when={props.removed} fallback={<span>{t("workflow.agent.choose")}</span>}>
              <TriangleAlert aria-hidden="true" />
              <span>{t("workflow.agent.removed")}</span>
              <span class="wfn-pill-action">{t("workflow.agent.choose")}</span>
            </Show>
          }
        >
          {(agent) => (
            <>
              <AgentAvatar agent={agent()} class="wfn-avatar" motion="idle" />
              <span>{agent().name}</span>
            </>
          )}
        </Show>
        <ChevronDown aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <PickerMenu
          label={t("workflow.agent.list")}
          search={t("workflow.agent.search")}
          groups={[{ options: agentOptions(board.catalogs()) }]}
          value={props.agent?.id}
          onSelect={(id) => {
            const agent = board.catalogs().agents.find((candidate) => candidate.id === id);
            if (agent) props.onChange(agent);
          }}
        />
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/* ----------------------------------------------------------- Seat Agent */

function SeatPill(props: {
  seat: ModelSeat;
  seats: readonly ModelSeat[];
  disabled?: boolean;
  onChange: (seatId: string) => void;
}) {
  return (
    <DropdownMenu.Root placement="bottom-start" gutter={6}>
      <DropdownMenu.Trigger
        class={`${buttonVariants({ variant: "ghost", size: "xs" })} wfn-pill wfn-seat-pill`}
        disabled={props.disabled}
        aria-label={`${props.seat.name}`}
      >
        <Bot class="wfn-avatar" aria-hidden="true" />
        <span>{props.seat.name}</span>
        <ChevronDown aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <PickerMenu
          label={`${"Seats"}`}
          groups={[
            {
              options: props.seats.map((seat) => ({
                value: seat.id,
                label: seat.name,
                chips: [
                  { text: seat.kind === "failover" ? "Failover" : "Escalation" },
                  { text: `${seat.rungs.length > 0 ? seat.rungs.length : "Pool"} rungs` },
                ],
              })),
            },
          ]}
          value={props.seat.id}
          onSelect={(id) => props.onChange(id)}
        />
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function RungPill(props: {
  seat: ModelSeat;
  rung: string;
  boundNames: readonly string[];
  resolvedAgent: { name?: string } | undefined;
  disabled?: boolean;
  onChange: (rung: string) => void;
}) {
  const isAuto = () => props.rung === "auto";
  const rungNum = () => parseInt(props.rung, 10);
  const label = () => {
    if (isAuto()) return "Auto (Pool)";
    const idx = rungNum() - 1;
    const boundName = props.boundNames[idx];
    if (boundName) return `${props.rung} · ${boundName}`;
    if (props.seat.rungs[idx]) return `${props.rung} · ${props.seat.rungs[idx].model}`;
    return `Rung ${props.rung}`;
  };

  const options = () => {
    const list: PickerOption<string>[] = [
      {
        value: "auto",
        label: `Auto (${props.seat.kind === "failover" ? "Failover Pool" : "Escalation Chain"})`,
        chips: [{ text: props.resolvedAgent?.name ?? "Pool" }],
      },
    ];
    const maxCount = Math.max(props.seat.rungs.length, props.boundNames.length, 3);
    for (let i = 0; i < maxCount; i++) {
      const num = `${i + 1}`;
      const boundName = props.boundNames[i];
      const rungModel = props.seat.rungs[i]?.model;
      const tag =
        i === 0 ? "1st · Primary" : i === 1 ? "2nd · Settle / Backup" : i === 2 ? "3rd · Final" : `${i + 1}th`;
      const display = boundName ?? (rungModel ? `${rungModel}` : `Rung ${num}`);
      list.push({
        value: num,
        label: `${tag}: ${display}`,
        chips: rungModel ? [{ text: rungModel }] : boundName ? [{ text: "Bound agent" }] : [],
      });
    }
    return list;
  };

  return (
    <DropdownMenu.Root placement="bottom-start" gutter={6}>
      <DropdownMenu.Trigger
        class={`${buttonVariants({ variant: "ghost", size: "xs" })} wfn-pill wfn-rung-pill`}
        disabled={props.disabled}
        aria-label={`${label()}`}
      >
        <span>{label()}</span>
        <ChevronDown aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <PickerMenu
          label={`${"Rungs"}`}
          groups={[{ options: options() }]}
          value={props.rung}
          onSelect={(r) => props.onChange(r)}
        />
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function CapPill(props: {
  outCapTokens: number;
  budgetDefault: number;
  hasBudgetCap: boolean;
  disabled?: boolean;
  onChange: (tokens: number) => void;
}) {
  const activeCap = () => (props.outCapTokens > 0 ? props.outCapTokens : props.hasBudgetCap ? props.budgetDefault : 0);
  const label = () => {
    const cap = activeCap();
    if (cap <= 0) return "No cap";
    const short = cap >= 1000 && cap % 1000 === 0 ? `${cap / 1000}k` : `${cap}`;
    return `${short} cap`;
  };

  return (
    <DropdownMenu.Root placement="bottom-end" gutter={6}>
      <DropdownMenu.Trigger
        class={`${buttonVariants({ variant: "ghost", size: "xs" })} wfn-pill wfn-cap-pill`}
        disabled={props.disabled}
        aria-label={`${label()}`}
      >
        <Sparkles class="wfn-model-logo" aria-hidden="true" />
        <span>{label()}</span>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <PickerMenu
          label={`${"Output Cap"}`}
          groups={[
            {
              options: [
                {
                  value: "0",
                  label: "No output cap (Full length)",
                  chips: [{ text: "Unlimited" }],
                },
                {
                  value: "16000",
                  label: "16k tokens (Default condensed)",
                  chips: [{ text: "16,000" }],
                },
                {
                  value: "32000",
                  label: "32k tokens",
                  chips: [{ text: "32,000" }],
                },
                {
                  value: "64000",
                  label: "64k tokens (Large generation)",
                  chips: [{ text: "64,000" }],
                },
              ],
            },
          ]}
          value={String(activeCap())}
          onSelect={(val) => props.onChange(parseInt(val, 10))}
        />
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function SeatEffortPill(props: {
  value: string;
  defaultEffort: string;
  disabled?: boolean;
  onChange: (effort: string) => void;
}) {
  const displayLabel = () => {
    if (props.value === "seat" || !props.value || props.value === "default") {
      return `Seat default (${props.defaultEffort})`;
    }
    return `Effort: ${props.value}`;
  };

  return (
    <DropdownMenu.Root placement="bottom-end" gutter={6}>
      <DropdownMenu.Trigger
        class={`${buttonVariants({ variant: "ghost", size: "xs" })} wfn-pill`}
        aria-label={`${displayLabel()}`}
        disabled={props.disabled}
      >
        <ChartNoAxesColumnIncreasing aria-hidden="true" />
        <span>{displayLabel()}</span>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <PickerMenu
          label={`${"Thinking"}`}
          groups={[
            {
              options: [
                {
                  value: "seat",
                  label: `Seat Default (${props.defaultEffort})`,
                  chips: [{ text: "Model baseline" }],
                },
                { value: "none", label: "None (No thinking)" },
                { value: "low", label: "Low" },
                { value: "medium", label: "Medium" },
                { value: "high", label: "High" },
              ],
            },
          ]}
          value={props.value}
          onSelect={(val) => props.onChange(val)}
        />
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function ComplexityPill(props: { active: boolean; disabled?: boolean; onChange: (active: boolean) => void }) {
  return (
    <Button
      variant="ghost"
      size="xs"
      class="wfn-pill"
      disabled={props.disabled}
      onClick={() => props.onChange(!props.active)}
    >
      <span
        style={{
          "font-size": "var(--openbot-text-xs)",
          "font-weight": props.active ? "var(--openbot-weight-semibold)" : "var(--openbot-weight-normal)",
        }}
      >
        {`${props.active ? "2A+2B (on)" : "Complexity: off"}`}
      </span>
    </Button>
  );
}

/**
 * A Seat Agent step: dispatches to a configured seat (e.g. Builder, Intake, Judge, Last resort)
 * with automatic pool routing or specific rung selection, effort adjustment, and output cap.
 */
export function SeatAgentNode(props: { id: string; task?: string }) {
  const board = useBoard();
  const { t } = useText();
  const seatsState = readModelSeats();

  const [seatId, setSeatId] = useField(() => props.id, "seatId", "builder", asString);
  const [seatRung, setSeatRung] = useField(() => props.id, "seatRung", "auto", asString);
  const [seatEffort, setSeatEffort] = useField<string>(() => props.id, "seatEffort", "seat", asString);
  const [effort, setEffort] = useField<string>(() => props.id, "effort", "default", asString);
  const [outCapTokens, setOutCapTokens] = useField<number>(
    () => props.id,
    "outCapTokens",
    0,
    (v) => (typeof v === "number" ? v : 0),
  );
  const [autoComplexity, setAutoComplexity] = useField<boolean>(() => props.id, "autoComplexity", true, asBoolean);
  const [task, setTask] = useTextField(
    () => props.id,
    "task",
    untrack(() => props.task ?? ""),
  );
  const [locked, setLocked] = useLocked(() => props.id);
  const run = useStepRun(untrack(() => props.id));

  const resolved = createMemo(() => {
    return resolveSeatChoice({
      seatId: seatId(),
      seatRung: seatRung(),
      catalogs: board.catalogs(),
      state: seatsState,
    });
  });

  const currentEffortPref = () => seatEffort() || effort() || "seat";

  const syncFields = (overrides?: Record<string, string | number | boolean>) => {
    const choice = resolved();
    const pref = overrides?.seatEffort !== undefined ? String(overrides.seatEffort) : currentEffortPref();
    const effVal = pref === "seat" || pref === "default" ? choice.defaultEffort : pref;
    const cap = overrides?.outCapTokens !== undefined ? Number(overrides.outCapTokens) : outCapTokens();
    const effectiveCap = cap > 0 ? cap : choice.outCapTokens;

    board.setFields(props.id, {
      seatMode: true,
      seatId: choice.seatId,
      seatRung: seatRung(),
      seatEffort: pref,
      effort: effVal,
      outCapTokens: effectiveCap,
      autoComplexity: overrides?.autoComplexity !== undefined ? Boolean(overrides.autoComplexity) : autoComplexity(),
      ...(choice.agentId ? { agentId: choice.agentId } : {}),
      ...(choice.model ? { model: choice.model } : {}),
      ...(choice.provider ? { provider: choice.provider } : {}),
      ...(overrides ?? {}),
    });
  };

  const handleRun = () => {
    syncFields();
    run.start();
  };

  const nodeTitle = () => `Seat · ${resolved().seatName}`;

  const explainSummary = () => {
    const choice = resolved();
    const eff =
      currentEffortPref() === "seat" || currentEffortPref() === "default" ? choice.defaultEffort : currentEffortPref();
    const rungLabel = seatRung() === "auto" ? "Auto" : `Rung ${seatRung()}`;
    const agentName = choice.agent?.name ?? choice.seatName;
    const model = choice.model || "default";
    return `${rungLabel}: ${agentName} (${model}) · Effort: ${eff}${autoComplexity() ? " · 2A+2B" : ""}`;
  };

  const explainDetail = () => {
    const choice = resolved();
    const eff =
      currentEffortPref() === "seat" || currentEffortPref() === "default" ? choice.defaultEffort : currentEffortPref();
    return `Seat: ${choice.seatName} (${choice.seatKind})\nActive Agent: ${choice.agent?.name ?? "Pool"}\nModel: ${choice.model}\nReasoning Effort: ${eff}\nComplexity Gate: ${autoComplexity() ? "Enabled (2A+2B)" : "Off"}\nOutput Cap: ${outCapTokens() > 0 ? `${outCapTokens()} tokens` : "Unlimited"}`;
  };

  return (
    <NodeShell
      action={
        <Button
          class="wfn-run"
          fullWidth
          loading={run.running()}
          loadingLabel={t("workflow.node.running")}
          disabled={!task().trim() || locked() || !resolved().agent}
          onClick={handleRun}
        >
          {t("workflow.agent.run")}
          <Play aria-hidden="true" />
        </Button>
      }
      id={props.id}
      label={nodeTitle()}
      icon={<Bot aria-hidden="true" />}
      kind="agent"
      inputs={["text", "image", "file"]}
      output="text"
      toolbar={<NodeToolbar id={props.id} name={nodeTitle()} locked={locked()} onLock={setLocked} />}
    >
      <Field class="wfn-field-task">
        <Textarea
          class="wfn-input"
          aria-label={t("workflow.agent.task")}
          placeholder={t("workflow.agent.taskPlaceholder")}
          readonly={locked()}
          value={task()}
          onValueChange={setTask}
        />
        <div class="wfn-field-foot">
          <SeatPill
            seat={resolved().seat}
            seats={seatsState.seats}
            disabled={locked()}
            onChange={(nextSeatId) => {
              setSeatId(nextSeatId);
              const choice = resolveSeatChoice({
                seatId: nextSeatId,
                seatRung: seatRung(),
                catalogs: board.catalogs(),
                state: seatsState,
              });
              const pref = currentEffortPref();
              const effVal = pref === "seat" || pref === "default" ? choice.defaultEffort : pref;
              board.setFields(props.id, {
                seatId: nextSeatId,
                effort: effVal,
                ...(choice.agentId ? { agentId: choice.agentId } : {}),
                ...(choice.model ? { model: choice.model } : {}),
                ...(choice.provider ? { provider: choice.provider } : {}),
              });
            }}
          />
          <RungPill
            seat={resolved().seat}
            rung={seatRung()}
            boundNames={resolved().boundNames}
            resolvedAgent={resolved().agent}
            disabled={locked()}
            onChange={(nextRung) => {
              setSeatRung(nextRung);
              const choice = resolveSeatChoice({
                seatId: seatId(),
                seatRung: nextRung,
                catalogs: board.catalogs(),
                state: seatsState,
              });
              const pref = currentEffortPref();
              const effVal = pref === "seat" || pref === "default" ? choice.defaultEffort : pref;
              board.setFields(props.id, {
                seatRung: nextRung,
                effort: effVal,
                ...(choice.agentId ? { agentId: choice.agentId } : {}),
                ...(choice.model ? { model: choice.model } : {}),
                ...(choice.provider ? { provider: choice.provider } : {}),
              });
            }}
          />
          <SeatEffortPill
            value={currentEffortPref()}
            defaultEffort={resolved().defaultEffort}
            disabled={locked()}
            onChange={(nextEffort) => {
              setSeatEffort(nextEffort);
              setEffort(nextEffort === "seat" || nextEffort === "default" ? resolved().defaultEffort : nextEffort);
              board.setFields(props.id, {
                seatEffort: nextEffort,
                effort: nextEffort === "seat" || nextEffort === "default" ? resolved().defaultEffort : nextEffort,
              });
            }}
          />
          <CapPill
            outCapTokens={outCapTokens()}
            budgetDefault={resolved().outCapTokens}
            hasBudgetCap={resolved().hasCap}
            disabled={locked()}
            onChange={(tokens) => {
              setOutCapTokens(tokens);
              board.setFields(props.id, { outCapTokens: tokens });
            }}
          />
          <ComplexityPill
            active={autoComplexity()}
            disabled={locked()}
            onChange={(val) => {
              setAutoComplexity(val);
              board.setFields(props.id, { autoComplexity: val });
            }}
          />
        </div>
        <div class="wfn-seat-explain" title={explainDetail()}>
          <Bot aria-hidden="true" class="wfn-avatar" />
          <span style={{ overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>
            {explainSummary()}
          </span>
        </div>
      </Field>
      <ResultField id={props.id} running={run.running()} />
    </NodeShell>
  );
}

function StandardAgentNode(props: { id: string; agentId?: string; task?: string }) {
  const board = useBoard();
  const { t } = useText();
  const [agentId] = useField(
    () => props.id,
    "agentId",
    untrack(() => props.agentId ?? board.catalogs().agents[0]?.id ?? ""),
    asString,
  );
  const agent = () => board.catalogs().agents.find((candidate) => candidate.id === agentId());
  // The catalog agent is a store, so its fields too are read once here.
  const first = untrack(() => {
    const found = agent();
    return { model: found?.model ?? "", provider: found?.provider ?? "codex" };
  });
  const [model] = useField<AgentModelId>(() => props.id, "model", first.model, asString);
  const [provider] = useField<WfProvider>(() => props.id, "provider", first.provider, asProvider);
  const [task, setTask] = useTextField(
    () => props.id,
    "task",
    untrack(() => props.task ?? ""),
  );
  const [locked, setLocked] = useLocked(() => props.id);
  const run = useStepRun(untrack(() => props.id));
  return (
    <NodeShell
      action={
        <Button
          class="wfn-run"
          fullWidth
          loading={run.running()}
          loadingLabel={t("workflow.node.running")}
          disabled={!task().trim() || locked() || !agent()}
          onClick={run.start}
        >
          {t("workflow.agent.run")}
          <Play aria-hidden="true" />
        </Button>
      }
      id={props.id}
      label={t("workflow.agent.title")}
      icon={<Bot aria-hidden="true" />}
      kind="agent"
      inputs={["text", "image", "file"]}
      output="text"
      toolbar={<NodeToolbar id={props.id} name={t("workflow.agent.name")} locked={locked()} onLock={setLocked} />}
    >
      <Field class="wfn-field-task">
        <Textarea
          class="wfn-input"
          aria-label={t("workflow.agent.task")}
          placeholder={t("workflow.agent.taskPlaceholder")}
          readonly={locked()}
          value={task()}
          onValueChange={setTask}
        />
        <div class="wfn-field-foot">
          <AgentPill
            agent={agent()}
            removed={agentId() !== "" && !agent()}
            disabled={locked()}
            onChange={(choice) =>
              board.setFields(props.id, { agentId: choice.id, model: choice.model, provider: choice.provider })
            }
          />
          <Show when={agent()}>
            <ModelPill
              provider={provider()}
              value={model()}
              disabled={locked()}
              onChange={(next, nextProvider) => board.setFields(props.id, { model: next, provider: nextProvider })}
            />
          </Show>
        </div>
      </Field>
      <ResultField id={props.id} running={run.running()} />
    </NodeShell>
  );
}

/**
 * One step that an agent does. The field holds the task, with the agent and its model at the
 * bottom, as the Higgsfield LLM Assistant holds its prompt with the model and Effort controls.
 */
export function AgentNode(props: { id: string; agentId?: string; task?: string }) {
  const [seatMode] = useField(() => props.id, "seatMode", false, asBoolean);
  const [seatId] = useField(() => props.id, "seatId", "", asString);
  const isSeat = () => seatMode() || seatId().trim().length > 0;

  return (
    <Show when={isSeat()} fallback={<StandardAgentNode id={props.id} agentId={props.agentId} task={props.task} />}>
      <SeatAgentNode id={props.id} task={props.task} />
    </Show>
  );
}
