<script setup lang="ts">
import { useId } from 'vue';

/** A labelled on/off switch, in the same row style as the sliders. */
defineProps<{ label: string; hint?: string; disabled?: boolean }>();
const model = defineModel<boolean>({ required: true });
const id = useId();
</script>

<template>
  <div class="field" :class="{ disabled }">
    <div class="row">
      <label class="label" :for="id">{{ label }}</label>
      <input :id="id" v-model="model" type="checkbox" role="switch" class="switch" :disabled="disabled" />
    </div>
    <p v-if="hint" class="hint">{{ hint }}</p>
  </div>
</template>

<style scoped>
.field {
  margin-top: 0.625rem;
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  min-height: 1.25rem;
}

.label {
  font-size: 0.8125rem;
}

.disabled {
  opacity: 0.45;
}

.hint {
  margin: 0.125rem 0 0;
  font-size: 0.75rem;
  color: var(--color-text-muted);
  line-height: 1.5;
}

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

.switch:disabled {
  cursor: default;
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
  .switch,
  .switch::after {
    transition: none;
  }
}
</style>
