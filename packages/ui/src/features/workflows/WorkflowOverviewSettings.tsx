// Copyright (c) 2026 Peter Radziszewski. Independently developed for this fork. All rights reserved.
/**
 * The settings of the All workflows page: the GitHub project its issue numbers follow, the colour
 * rules that pick a card's strip, and which plan rings of a local usage feed show. The page owns
 * none of that state — it arrives through props and changes flow back through the change
 * callbacks, so the dialog stays free of app contexts and storage.
 */

import {
  WORKFLOW_REPORT_DEFAULT_RUNS,
  WORKFLOW_REPORT_RUN_LIMITS,
  type WorkflowReportRunLimit,
} from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import {
  Button,
  buttonVariants,
  Check,
  Checkbox,
  Dialog,
  DropdownMenu,
  IconButton,
  Input,
  Plus,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Trash2,
  X,
} from "@openbot/ui";
import { type Accessor, For, Show } from "solid-js";
import { useText } from "../../text";
import { OVERVIEW_TONES, type OverviewTone } from "./WorkflowOverview";

/** One colour rule: a wildcard pattern and the tone a matching card shows. */
export interface OverviewColorRule {
  pattern: string;
  tone: OverviewTone;
  /** A free colour, "#rrggbb", that replaces the tone's colour on the cards this rule matches. */
  color?: string | undefined;
}

/** One plan ring of a usage feed, as the settings list it. */
export interface OverviewUsageRow {
  id: string;
  name: string;
  /** What the ring shows, as "5-hour 86% left, Weekly 99% left". */
  summary: string;
}

/** The tone a rule gives, as a key of the tone labels. */
const TONE_LABEL = {
  plan: "fork.workflow.overview.tone.plan",
  build: "fork.workflow.overview.tone.build",
  judge: "fork.workflow.overview.tone.judge",
  conflict: "fork.workflow.overview.tone.conflict",
  violet: "fork.workflow.overview.tone.violet",
} as const satisfies Record<OverviewTone, AppTextKey>;

export function WorkflowOverviewSettings(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The GitHub project the issue numbers follow, "owner/name", or null to follow the helper. */
  project: string | null;
  onProjectChange: (project: string | null) => void;
  /** The project the helper reports, when it answered. */
  reportedProject?: string | null;
  colorRules: readonly OverviewColorRule[];
  onColorRulesChange: (rules: readonly OverviewColorRule[]) => void;
  usageRows: readonly OverviewUsageRow[];
  /** Row ids the user turned off. */
  hiddenUsageRows: readonly string[];
  onHiddenUsageRowsChange: (ids: readonly string[]) => void;
  /** How many finished runs Reporting reads. Without a change callback the dialog does not offer it. */
  reportRuns?: WorkflowReportRunLimit | undefined;
  onReportRunsChange?: ((limit: WorkflowReportRunLimit) => void) | undefined;
}) {
  const { t } = useText();
  const close = () => props.onOpenChange(false);
  const reportRuns = (): WorkflowReportRunLimit => props.reportRuns ?? WORKFLOW_REPORT_DEFAULT_RUNS;

  const writeRule = (index: number, pattern: string) => {
    const rules = [...props.colorRules];
    rules[index] = { ...(rules[index] ?? { pattern: "*", tone: "plan" }), pattern };
    props.onColorRulesChange(rules);
  };
  const setTone = (index: number, tone: OverviewTone) => {
    const rules = [...props.colorRules];
    rules[index] = { ...(rules[index] ?? { pattern: "*", tone: "plan" }), tone };
    props.onColorRulesChange(rules);
  };
  const setColor = (index: number, color: string | undefined) => {
    const rules = [...props.colorRules];
    rules[index] = { ...(rules[index] ?? { pattern: "*", tone: "plan" }), color };
    props.onColorRulesChange(rules);
  };
  const removeRule = (index: number) => {
    const rules = [...props.colorRules];
    rules.splice(index, 1);
    props.onColorRulesChange(rules);
  };
  const addRule = () => {
    const rules = [...props.colorRules, { pattern: "*", tone: props.colorRules.at(-1)?.tone ?? "plan" }];
    props.onColorRulesChange(rules);
  };
  const toggleRow = (id: string, shown: boolean) => {
    const rest = props.hiddenUsageRows.filter((entry) => entry !== id);
    props.onHiddenUsageRowsChange(shown ? rest : [...rest, id]);
  };

  const reported = () =>
    props.reportedProject ? (
      <p class="wfo-settings-hint">
        {t("fork.workflow.overview.settings.projectReported", { project: props.reportedProject })}
      </p>
    ) : null;

  return (
    <Dialog.Root open={props.open} onOpenChange={(open) => (open ? props.onOpenChange(true) : close())}>
      <Dialog.Portal>
        <Dialog.Overlay class="custom-provider-backdrop wfo-settings-backdrop">
          <Dialog.Content as="section" class="custom-provider-dialog wfo-settings-dialog" onCloseAutoFocus={close}>
            <header class="wfo-settings-header">
              <Dialog.Title as="h2" class="wfo-settings-title">
                {t("fork.workflow.overview.settings.title")}
              </Dialog.Title>
              <IconButton label={t("common.close")} variant="ghost" onClick={close}>
                <X aria-hidden="true" />
              </IconButton>
            </header>
            <div class="wfo-settings-body">
              <section class="wfo-settings-section" aria-label={t("fork.workflow.overview.settings.project")}>
                <label class="wfo-settings-label" for="wfo-settings-project">
                  {t("fork.workflow.overview.settings.project")}
                </label>
                <Input
                  id="wfo-settings-project"
                  class="wfo-settings-project"
                  type="text"
                  placeholder={t("fork.workflow.overview.settings.projectPlaceholder")}
                  autocomplete="off"
                  spellcheck={false}
                  value={props.project ?? ""}
                  onValueChange={(value) => props.onProjectChange(value.trim() === "" ? null : value.trim())}
                />
                <p class="wfo-settings-hint">{t("fork.workflow.overview.settings.projectHint")}</p>
                {reported()}
              </section>
              <section class="wfo-settings-section" aria-label={t("fork.workflow.overview.settings.colors")}>
                <span class="wfo-settings-label">{t("fork.workflow.overview.settings.colors")}</span>
                <p class="wfo-settings-hint">{t("fork.workflow.overview.settings.colorsHint")}</p>
                {/* keyed={false}: a rule is replaced by a new object on every keystroke, and a keyed For would rebuild the
                    row (and its input) each time, dropping the focus after one letter. Unkeyed keeps the row by position. */}
                <For each={props.colorRules} keyed={false}>
                  {(ruleAt: Accessor<OverviewColorRule>, index: number) => {
                    const rule = {
                      get pattern() {
                        return ruleAt().pattern;
                      },
                      get tone() {
                        return ruleAt().tone;
                      },
                      get color() {
                        return ruleAt().color;
                      },
                    };
                    return (
                      <div class="wfo-settings-rule">
                        <Input
                          class="wfo-settings-pattern"
                          type="text"
                          placeholder={t("fork.workflow.overview.settings.patternPlaceholder")}
                          autocomplete="off"
                          spellcheck={false}
                          value={rule.pattern}
                          onValueChange={(value) => writeRule(index, value)}
                        />
                        <Show when={rule.pattern.trim() === ""}>
                          <span class="wfo-settings-rule-error" role="alert">
                            {t("fork.workflow.overview.settings.patternEmpty")}
                          </span>
                        </Show>
                        <DropdownMenu.Root placement="bottom-start" gutter={4}>
                          <DropdownMenu.Trigger
                            class={buttonVariants({ variant: "ghost", size: "icon-sm", class: "wfo-settings-swatch" })}
                            aria-label={t("fork.workflow.overview.settings.toneOf", {
                              tone: t(TONE_LABEL[rule.tone]),
                            })}
                            title={t(TONE_LABEL[rule.tone])}
                          >
                            <span
                              class="wfo-settings-swatch-dot"
                              data-tone={rule.tone}
                              style={rule.color ? { background: rule.color } : undefined}
                              aria-hidden="true"
                            />
                          </DropdownMenu.Trigger>
                          <DropdownMenu.Portal>
                            <DropdownMenu.Content class="wfo-settings-tone-menu">
                              <DropdownMenu.RadioGroup
                                value={rule.tone}
                                onChange={(value) => {
                                  const tone = OVERVIEW_TONES.find((candidate) => candidate === value);
                                  if (tone && tone !== rule.tone) setTone(index, tone);
                                }}
                              >
                                <For each={OVERVIEW_TONES}>
                                  {(tone) => (
                                    <DropdownMenu.RadioItem value={tone} closeOnSelect class="wfo-settings-tone-option">
                                      <span class="wfo-settings-swatch-dot" data-tone={tone} aria-hidden="true" />
                                      <span>{t(TONE_LABEL[tone])}</span>
                                      <Show when={rule.tone === tone}>
                                        <Check aria-hidden="true" class="ui-menu-trailing" />
                                      </Show>
                                    </DropdownMenu.RadioItem>
                                  )}
                                </For>
                              </DropdownMenu.RadioGroup>
                            </DropdownMenu.Content>
                          </DropdownMenu.Portal>
                        </DropdownMenu.Root>
                        {/* A free colour (the system colour picker): replaces the preset's colour on the matching cards. */}
                        <Input
                          class="wfo-settings-colour-input"
                          type="color"
                          aria-label={t("fork.workflow.overview.settings.customColour", { number: index + 1 })}
                          title={t("fork.workflow.overview.settings.customColour", { number: index + 1 })}
                          value={rule.color ?? "#808080"}
                          onValueChange={(value) => setColor(index, value)}
                        />
                        <Show when={rule.color}>
                          <IconButton
                            label={t("fork.workflow.overview.settings.clearColour", { number: index + 1 })}
                            variant="ghost"
                            onClick={() => setColor(index, undefined)}
                          >
                            <X aria-hidden="true" />
                          </IconButton>
                        </Show>
                        <IconButton
                          label={t("fork.workflow.overview.settings.removeRule", { number: index + 1 })}
                          variant="ghost"
                          onClick={() => removeRule(index)}
                        >
                          <Trash2 aria-hidden="true" />
                        </IconButton>
                      </div>
                    );
                  }}
                </For>
                <Button variant="outline" size="sm" class="wfo-settings-add" onClick={addRule}>
                  <Plus aria-hidden="true" />
                  {t("fork.workflow.overview.settings.addRule")}
                </Button>
              </section>
              <Show when={props.onReportRunsChange}>
                {(onReportRunsChange) => (
                  <section class="wfo-settings-section" aria-label={t("fork.workflow.overview.settings.reportRuns")}>
                    <span class="wfo-settings-label">{t("fork.workflow.overview.settings.reportRuns")}</span>
                    <p class="wfo-settings-hint">{t("fork.workflow.overview.settings.reportRunsHint")}</p>
                    <Select<WorkflowReportRunLimit>
                      class="wfo-settings-report-runs"
                      options={[...WORKFLOW_REPORT_RUN_LIMITS]}
                      value={reportRuns()}
                      onChange={(next) => {
                        if (next && next !== reportRuns()) onReportRunsChange()(next);
                      }}
                      itemComponent={(item) => (
                        <SelectItem item={item.item}>
                          {t("fork.workflow.overview.settings.reportRunsOption", { count: item.item.rawValue })}
                        </SelectItem>
                      )}
                    >
                      <SelectTrigger aria-label={t("fork.workflow.overview.settings.reportRuns")}>
                        <SelectValue<WorkflowReportRunLimit>>
                          {(state) =>
                            t("fork.workflow.overview.settings.reportRunsOption", {
                              count: state.selectedOption() ?? reportRuns(),
                            })
                          }
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent />
                    </Select>
                  </section>
                )}
              </Show>
              <section class="wfo-settings-section" aria-label={t("fork.workflow.overview.settings.usage")}>
                <span class="wfo-settings-label">{t("fork.workflow.overview.settings.usage")}</span>
                <p class="wfo-settings-hint">{t("fork.workflow.overview.settings.usageHint")}</p>
                <Show
                  when={props.usageRows.length > 0}
                  fallback={<p class="wfo-settings-hint">{t("fork.workflow.overview.settings.usageNone")}</p>}
                >
                  <For each={props.usageRows}>
                    {(row) => (
                      <label class="wfo-settings-row" for={`wfo-settings-usage-${row.id}`}>
                        <Checkbox
                          id={`wfo-settings-usage-${row.id}`}
                          checked={!props.hiddenUsageRows.includes(row.id)}
                          onChange={(event) => toggleRow(row.id, event.currentTarget.checked)}
                        />
                        <span class="wfo-settings-row-name">{row.name}</span>
                        <span class="wfo-settings-row-summary">{row.summary}</span>
                      </label>
                    )}
                  </For>
                </Show>
              </section>
            </div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
