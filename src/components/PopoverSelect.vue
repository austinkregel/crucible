<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue';

export interface PopoverOption {
  id: string;
  label: string;
  icon?: string;
}

const props = withDefaults(defineProps<{
  options: PopoverOption[];
  modelValue: string;
  pillClass?: string;
  placeholder?: string;
}>(), {
  pillClass: '',
  placeholder: 'Select...',
});

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

const isOpen = ref(false);
const wrapperRef = ref<HTMLDivElement | null>(null);
const menuRef = ref<HTMLDivElement | null>(null);

const selectedLabel = computed(() => {
  const opt = props.options.find((o) => o.id === props.modelValue);
  return opt?.label ?? props.placeholder;
});

const selectedIcon = computed(() => {
  const opt = props.options.find((o) => o.id === props.modelValue);
  return opt?.icon;
});

function toggle() {
  isOpen.value = !isOpen.value;
}

function select(id: string) {
  emit('update:modelValue', id);
  isOpen.value = false;
}

function onClickOutside(e: PointerEvent) {
  if (wrapperRef.value && !wrapperRef.value.contains(e.target as Node)) {
    isOpen.value = false;
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    isOpen.value = false;
  }
}

watch(isOpen, (open) => {
  if (open) {
    document.addEventListener('pointerdown', onClickOutside, true);
    document.addEventListener('keydown', onKeydown, true);
  } else {
    document.removeEventListener('pointerdown', onClickOutside, true);
    document.removeEventListener('keydown', onKeydown, true);
  }
});

onUnmounted(() => {
  document.removeEventListener('pointerdown', onClickOutside, true);
  document.removeEventListener('keydown', onKeydown, true);
});
</script>

<template>
  <div ref="wrapperRef" class="relative">
    <!-- Trigger pill -->
    <button
      type="button"
      :class="[
        'inline-flex items-center gap-1 cursor-pointer select-none transition-colors text-[11px]',
        pillClass || 'bg-vscode-badge-bg/70 text-vscode-badge-fg rounded-full px-2.5 py-1 font-medium'
      ]"
      @click="toggle"
    >
      <span v-if="selectedIcon" class="text-[10px] opacity-70">{{ selectedIcon }}</span>
      <span class="truncate">{{ selectedLabel }}</span>
      <svg class="w-2.5 h-2.5 opacity-50 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
        <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
      </svg>
    </button>

    <!-- Dropdown menu (opens upward) -->
    <Transition
      enter-active-class="transition duration-100 ease-out"
      enter-from-class="opacity-0 translate-y-1"
      enter-to-class="opacity-100 translate-y-0"
      leave-active-class="transition duration-75 ease-in"
      leave-from-class="opacity-100 translate-y-0"
      leave-to-class="opacity-0 translate-y-1"
    >
      <div
        v-if="isOpen"
        ref="menuRef"
        class="absolute bottom-full left-0 mb-1.5 z-50 min-w-[160px] max-h-[240px] overflow-y-auto rounded-lg border border-vscode-border bg-vscode-bg shadow-lg py-1"
      >
        <button
          v-for="opt in options"
          :key="opt.id"
          type="button"
          class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors hover:bg-vscode-input-bg"
          :class="[
            opt.id === modelValue ? 'text-vscode-fg' : 'text-vscode-muted'
          ]"
          @click="select(opt.id)"
        >
          <!-- Icon -->
          <span v-if="opt.icon" class="w-4 text-center text-[11px] shrink-0 opacity-70">{{ opt.icon }}</span>
          <span v-else class="w-4 shrink-0" />

          <!-- Label -->
          <span class="flex-1 truncate">{{ opt.label }}</span>

          <!-- Checkmark -->
          <svg
            v-if="opt.id === modelValue"
            class="w-3.5 h-3.5 shrink-0 text-vscode-link"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="2.5"
          >
            <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
        </button>

        <div v-if="options.length === 0" class="px-3 py-2 text-[11px] text-vscode-muted italic">
          No options available
        </div>
      </div>
    </Transition>
  </div>
</template>
