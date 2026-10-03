<script setup lang="ts">
import { computed, useId } from 'vue';
import { useSimI18n } from './context';

const props = withDefaults(
  defineProps<{
    label: string;
    min?: number;
    max?: number;
    step?: number;
    /** Discrete values to step through instead of a continuous range. */
    options?: number[];
    /** Logarithmic slider between min and max. */
    log?: boolean;
    format?: (value: number) => string;
    disabled?: boolean;
    hint?: string;
  }>(),
  { min: 0, max: 100, step: 1 },
);

const model = defineModel<number>({ required: true });
const { num } = useSimI18n();
const id = useId();

const range = computed(() => {
  if (props.options) return { min: 0, max: props.options.length - 1, step: 1 };
  if (props.log) return { min: Math.log10(props.min), max: Math.log10(props.max), step: 0.01 };
  return { min: props.min, max: props.max, step: props.step };
});

const sliderValue = computed({
  get() {
    const v = model.value;
    if (props.options) {
      // Nearest option, so values set elsewhere (presets) still land on a notch
      let best = 0;
      props.options.forEach((o, i) => {
        if (Math.abs(o - v) < Math.abs(props.options![best] - v)) best = i;
      });
      return best;
    }
    return props.log ? Math.log10(Math.max(v, props.min)) : v;
  },
  set(raw: number) {
    if (props.options) model.value = props.options[raw];
    else if (props.log) model.value = Math.max(props.min, Math.round(10 ** raw));
    else model.value = raw;
  },
});

const display = computed(() => (props.format ? props.format(model.value) : num(model.value)));
</script>

<template>
  <div class="field" :class="{ disabled }">
    <label class="field-label" :for="id">
      <span>{{ label }}</span>
      <output class="field-value" :for="id">{{ display }}</output>
    </label>
    <input
      :id="id"
      v-model.number="sliderValue"
      type="range"
      :min="range.min"
      :max="range.max"
      :step="range.step"
      :disabled="disabled"
      :aria-valuetext="display"
    />
    <p v-if="hint" class="field-hint">{{ hint }}</p>
  </div>
</template>

<style scoped>
.field {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.field + .field {
  margin-top: 0.875rem;
}

.field-label {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 0.5rem;
  font-size: 0.8125rem;
}

.field-value {
  color: var(--color-primary);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

input[type='range'] {
  width: 100%;
  margin: 0;
  accent-color: var(--color-primary);
}

.disabled {
  opacity: 0.5;
}

.field-hint {
  margin: 0;
  font-size: 0.75rem;
  color: var(--color-text-muted);
  line-height: 1.5;
}
</style>
