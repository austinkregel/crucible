import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import PhaseIndicator from '../PhaseIndicator.vue';

describe('PhaseIndicator', () => {
  it('renders all four phases', () => {
    const wrapper = mount(PhaseIndicator, {
      props: { currentPhase: 'planning' },
    });
    const text = wrapper.text();
    expect(text).toContain('Planning');
    expect(text).toContain('Validation');
    expect(text).toContain('Execution');
    expect(text).toContain('Review');
  });

  it('highlights the active phase', () => {
    const wrapper = mount(PhaseIndicator, {
      props: { currentPhase: 'validation' },
    });
    const active = wrapper.find('[data-phase="validation"]');
    expect(active.exists()).toBe(true);
    expect(active.classes()).toContain('phase-active');
  });

  it('marks completed phases differently from pending ones', () => {
    const wrapper = mount(PhaseIndicator, {
      props: { currentPhase: 'execution' },
    });
    const planning = wrapper.find('[data-phase="planning"]');
    const review = wrapper.find('[data-phase="postValidation"]');
    expect(planning.classes()).toContain('phase-done');
    expect(review.classes()).not.toContain('phase-done');
  });

  it('shows pulsing indicator on active phase', () => {
    const wrapper = mount(PhaseIndicator, {
      props: { currentPhase: 'planning' },
    });
    const pulse = wrapper.find('[data-phase="planning"] .animate-pulse');
    expect(pulse.exists()).toBe(true);
  });
});
