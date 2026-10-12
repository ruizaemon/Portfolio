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

/** How far along the track the thumb sits, to colour the part behind it. */
const fill = computed(() => {
  const { min, max } = range.value;
  const ratio = max > min ? (sliderValue.value - min) / (max - min) : 0;
  return `${Math.max(0, Math.min(1, ratio)) * 100}%`;
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
      :style="{ '--fill': fill }"
    />
    <p v-if="hint" class="field-hint">{{ hint }}</p>
  </div>
</template>

<style scoped>
.field {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.field + .field {
  margin-top: 0.625rem;
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

/* Custom slider: a thin track filled up to the thumb, and a small round thumb.
   --fill is set by the component; --track and --thumb-ring come from the theme */
input[type='range'] {
  --track: color-mix(in srgb, var(--color-text) 14%, transparent);
  --filled: linear-gradient(var(--color-primary), var(--color-primary)) 0 0 / var(--fill, 0%) 100% no-repeat;
  appearance: none;
  width: 100%;
  height: 1.25rem;
  margin: 0;
  background: transparent;
  cursor: pointer;
}

input[type='range']:focus {
  outline: none;
}

input[type='range']::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: 2px;
  background: var(--filled), var(--track);
}

input[type='range']::-webkit-slider-thumb {
  appearance: none;
  width: 14px;
  height: 14px;
  margin-top: -5px;
  border-radius: 50%;
  background: var(--color-primary);
  border: 2px solid var(--color-background);
  box-shadow: 0 0 0 1px var(--color-primary);
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}

input[type='range']::-moz-range-track {
  height: 4px;
  border-radius: 2px;
  background: var(--track);
}

input[type='range']::-moz-range-progress {
  height: 4px;
  border-radius: 2px;
  background: var(--color-primary);
}

input[type='range']::-moz-range-thumb {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--color-primary);
  border: 2px solid var(--color-background);
  box-shadow: 0 0 0 1px var(--color-primary);
}

input[type='range']:hover::-webkit-slider-thumb,
input[type='range']:active::-webkit-slider-thumb {
  transform: scale(1.15);
}

input[type='range']:focus-visible::-webkit-slider-thumb {
  box-shadow: 0 0 0 1px var(--color-primary), 0 0 0 5px color-mix(in srgb, var(--color-primary) 30%, transparent);
}

input[type='range']:focus-visible::-moz-range-thumb {
  box-shadow: 0 0 0 1px var(--color-primary), 0 0 0 5px color-mix(in srgb, var(--color-primary) 30%, transparent);
}

.disabled {
  opacity: 0.45;
}

.disabled input[type='range'] {
  cursor: default;
}

.field-hint {
  margin: 0.125rem 0 0;
  font-size: 0.75rem;
  color: var(--color-text-muted);
  line-height: 1.5;
}

@media (prefers-reduced-motion: reduce) {
  input[type='range']::-webkit-slider-thumb {
    transition: none;
  }
}
</style>
