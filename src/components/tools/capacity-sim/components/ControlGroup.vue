<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue';

/**
 * A collapsible card of related controls. While folded, the header shows a
 * one-line summary of the group's current values, so it still tells you
 * what's set. Groups for optional components (CDN, cache…) also carry the
 * on/off switch; switching one on unfolds it.
 */
const props = withDefaults(
  defineProps<{
    title: string;
    summary?: string;
    /** Start unfolded. */
    defaultOpen?: boolean;
    /** The group controls an optional component: show the on/off switch bound to `enabled`. */
    withSwitch?: boolean;
    /** Accessible name for the switch. */
    toggleLabel?: string;
  }>(),
  { defaultOpen: true },
);

// Vue casts an absent Boolean prop to false, so `withSwitch` says whether this is meaningful
const enabled = defineModel<boolean>('enabled');
const open = ref(props.defaultOpen);
const bodyId = useId();

const off = computed(() => props.withSwitch && !enabled.value);
const expanded = computed(() => open.value && !off.value);

watch(enabled, (on) => {
  if (on) open.value = true;
});
</script>

<template>
  <section class="group" :class="{ expanded, off }">
    <div class="group-head">
      <button
        type="button"
        class="group-toggle"
        :aria-expanded="expanded"
        :aria-controls="bodyId"
        :disabled="off"
        @click="open = !open"
      >
        <span class="chevron" aria-hidden="true"></span>
        <span class="group-text">
          <span class="group-title">{{ title }}</span>
          <span v-if="summary && !expanded && !off" class="group-summary">{{ summary }}</span>
        </span>
      </button>
      <input
        v-if="withSwitch"
        v-model="enabled"
        type="checkbox"
        role="switch"
        class="switch"
        :aria-label="toggleLabel"
      />
    </div>
    <div v-show="expanded" :id="bodyId" class="group-body">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.group {
  border: 1px solid var(--panel-border);
  border-radius: 10px;
  background-color: color-mix(in srgb, var(--color-text) 2.5%, transparent);
  transition: border-color 0.2s ease;
}

.group:focus-within {
  border-color: color-mix(in srgb, var(--color-primary) 45%, var(--panel-border));
}

.group-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding-right: 0.75rem;
}

.group-toggle {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  flex: 1;
  min-width: 0;
  padding: 0.625rem 0.75rem;
  font: inherit;
  text-align: left;
  color: inherit;
  background: transparent;
  border: none;
  border-radius: 10px;
  cursor: pointer;
}

.group-toggle:disabled {
  cursor: default;
}

.group-toggle:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: -2px;
}

.chevron {
  flex-shrink: 0;
  width: 0.4rem;
  height: 0.4rem;
  margin: 0.3rem 0.125rem 0 0;
  border-right: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
  color: var(--color-text-muted);
  transform: rotate(-45deg);
  transition: transform 0.2s ease;
}

.expanded .chevron {
  transform: rotate(45deg);
  margin-top: 0.2rem;
}

.off .chevron {
  opacity: 0.35;
}

.group-text {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  min-width: 0;
}

.group-title {
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text);
}

.off .group-title {
  color: var(--color-text-muted);
}

.group-summary {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.75rem;
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}

.group-body {
  padding: 0 0.75rem 0.875rem;
}

/* On/off switch */
.switch {
  appearance: none;
  position: relative;
  flex-shrink: 0;
  width: 2.25rem;
  height: 1.25rem;
  margin: 0;
  border-radius: 999px;
  background: var(--panel-border);
  cursor: pointer;
  transition: background-color 0.2s ease;
}

.switch::after {
  content: '';
  position: absolute;
  top: 0.1875rem;
  left: 0.1875rem;
  width: 0.875rem;
  height: 0.875rem;
  border-radius: 50%;
  background: var(--color-text);
  transition: transform 0.2s ease;
}

.switch:checked {
  background: var(--color-primary);
}

.switch:checked::after {
  transform: translateX(1rem);
  background: var(--color-background);
}

.switch:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  .chevron,
  .switch,
  .switch::after {
    transition: none;
  }
}
</style>
