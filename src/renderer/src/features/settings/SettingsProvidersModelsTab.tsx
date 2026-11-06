// Copyright (c) 2026 Peter Radziszewski. Independently developed for this fork. All rights reserved.
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
  SettingsSection,
} from "@openbot/ui";
import { readModelFavorites, toggleModelFavorite } from "@openbot/ui/components/model-favorites";
import { useText } from "@openbot/ui/text";
import { createMemo, createSignal, For, Show } from "solid-js";
import { ProviderTimeOff } from "../../fork/ProviderTimeOff"; // FORK: provider time-off
import { useAgentsOptional } from "../agents/agents-context";

/** One model row in the provider groups. */
interface ProviderModelEntry {
  key: string;
  name: string;
  provider: string;
}

/**
 * The Providers & models tab (owner 2026-11-03): every model the providers offer, grouped by
 * provider, searchable by name, each with the same pin the model picker uses. Pinned models open
 * every picker's Favorites section, so this is the one place to curate what 60-plus model lists
 * show. A search narrows both the pinned list and the provider groups.
 */
export function SettingsProvidersModelsTab() {
  const { t } = useText();
  const agents = useAgentsOptional();
  const [favorites, setFavorites] = createSignal(readModelFavorites());
  const [search, setSearch] = createSignal("");
  const [collapsedProviders, setCollapsedProviders] = createSignal<Record<string, boolean>>({});

  const toggleProviderCollapse = (provider: string): void => {
    setCollapsedProviders((prev) => ({ ...prev, [provider]: !prev[provider] }));
  };

  const allModels = createMemo(() => {
    const options = agents?.modelOptions?.() ?? [];
    return options.map((option) => ({
      key: `${option.provider}:${option.id}`,
      name: option.id,
      provider: option.provider,
    }));
  });

  const query = () => search().trim().toLowerCase();

  const pinned = createMemo(() => {
    const known = new Set(allModels().map((model) => model.key));
    return [...favorites()].filter((key) => known.has(key) && key.toLowerCase().includes(query()));
  });

  const groups = createMemo(() => {
    const byProvider = new Map<string, ProviderModelEntry[]>();
    for (const model of allModels()) {
      if (query() && !`${model.provider} ${model.name}`.toLowerCase().includes(query())) continue;
      const list = byProvider.get(model.provider) ?? [];
      list.push(model);
      byProvider.set(model.provider, list);
    }
    return [...byProvider.entries()].map(([provider, models]) => ({
      provider,
      models,
      pinnedCount: models.filter((model) => favorites().has(model.key)).length,
    }));
  });

  const toggle = (key: string): void => {
    setFavorites(toggleModelFavorite(key));
  };

  return (
    <SettingsSection
      title={t("settings.providersModels.title")}
      description={t("settings.providersModels.description")}
    >
      <Input
        type="search"
        class="settings-modal-select"
        placeholder={t("settings.providersModels.search")}
        aria-label={t("settings.providersModels.search")}
        value={search()}
        onValueChange={setSearch}
      />

      <Show when={pinned().length > 0}>
        <ItemGroup class="settings-modal-card">
          <Item class="settings-modal-row">
            <ItemContent>
              <ItemTitle
                class="seat-header-row provider-tile-header"
                onClick={() => toggleProviderCollapse("__pinned__")}
              >
                <IconButton
                  label={collapsedProviders().__pinned__ ? "Expand pinned models" : "Collapse pinned models"}
                  variant="ghost"
                  size="icon-sm"
                  class="seat-collapse-button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleProviderCollapse("__pinned__");
                  }}
                >
                  <Show when={Boolean(collapsedProviders().__pinned__)} fallback={<ChevronDown aria-hidden="true" />}>
                    <ChevronRight aria-hidden="true" />
                  </Show>
                </IconButton>
                <span class="provider-tile-title">{t("settings.providersModels.pinned")}</span>
                <span class="seat-agents-count">{pinned().length}</span>
              </ItemTitle>
              <Show when={!collapsedProviders().__pinned__}>
                <ItemDescription>
                  <For each={pinned()}>
                    {(key) => (
                      <span class="seat-preset">
                        <Button variant="outline" size="sm" onClick={() => toggle(key)}>
                          ★ {key.split(":").pop()}
                        </Button>
                        <IconButton
                          label={t("provider.model.unpin")}
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => toggle(key)}
                        >
                          ✕
                        </IconButton>
                      </span>
                    )}
                  </For>
                </ItemDescription>
              </Show>
            </ItemContent>
          </Item>
        </ItemGroup>
      </Show>

      <For each={groups()}>
        {(group) => {
          const isCollapsed = () => Boolean(collapsedProviders()[group.provider]) && !query();
          return (
            <ItemGroup class="settings-modal-card">
              <Item class="settings-modal-row">
                <ItemContent>
                  <ItemTitle
                    class="seat-header-row provider-tile-header"
                    onClick={() => toggleProviderCollapse(group.provider)}
                  >
                    <IconButton
                      label={isCollapsed() ? `Expand ${group.provider}` : `Collapse ${group.provider}`}
                      variant="ghost"
                      size="icon-sm"
                      class="seat-collapse-button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleProviderCollapse(group.provider);
                      }}
                    >
                      <Show when={isCollapsed()} fallback={<ChevronDown aria-hidden="true" />}>
                        <ChevronRight aria-hidden="true" />
                      </Show>
                    </IconButton>
                    <span class="provider-tile-title">{group.provider}</span>
                    <Show when={group.pinnedCount > 0}>
                      <span style={{ color: "var(--openbot-accent)", "font-size": "var(--openbot-text-sm)" }}>
                        ★ {group.pinnedCount}
                      </span>
                    </Show>
                    <span class="seat-agents-count">{group.models.length}</span>
                  </ItemTitle>
                  <Show when={!isCollapsed()}>
                    <ItemDescription>
                      <For each={group.models}>
                        {(model) => (
                          <Button
                            variant="ghost"
                            size="sm"
                            class="seat-budget"
                            style={{
                              "padding-top": "var(--openbot-space-1)",
                              color: favorites().has(model.key) ? "var(--openbot-text-primary)" : undefined,
                            }}
                            onClick={() => toggle(model.key)}
                            aria-label={
                              favorites().has(model.key)
                                ? `${t("provider.model.unpin")} ${model.name}`
                                : `${t("provider.model.pin")} ${model.name}`
                            }
                          >
                            <Show when={favorites().has(model.key)}>
                              <span style={{ color: "var(--openbot-accent)" }}>★</span>
                            </Show>
                            <Show when={!favorites().has(model.key)}>
                              <span style={{ color: "var(--openbot-text-muted)" }}>☆</span>
                            </Show>
                            {model.name}
                          </Button>
                        )}
                      </For>
                    </ItemDescription>
                    <ProviderTimeOff provider={group.provider} /> {/* FORK: provider time-off */}
                  </Show>
                </ItemContent>
              </Item>
            </ItemGroup>
          );
        }}
      </For>

      <Show when={groups().length === 0 && query()}>
        <ItemGroup class="settings-modal-card">
          <Item class="settings-modal-row">
            <ItemContent>
              <ItemDescription>{t("settings.providersModels.noResults")}</ItemDescription>
            </ItemContent>
          </Item>
        </ItemGroup>
      </Show>
    </SettingsSection>
  );
}
