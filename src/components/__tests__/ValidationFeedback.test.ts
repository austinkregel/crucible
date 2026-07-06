import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import ValidationFeedback from '../ValidationFeedback.vue';

function makeValidation(overrides: Partial<{
  issues: string[];
  missingCases: string[];
  conflicts: string[];
  confidenceScore: number;
  approved: boolean;
}> = {}) {
  return {
    issues: [],
    missingCases: [],
    conflicts: [],
    confidenceScore: 0.85,
    approved: true,
    ...overrides,
  };
}

describe('ValidationFeedback', () => {
  it('renders confidence score as percentage', () => {
    const wrapper = mount(ValidationFeedback, {
      props: { validation: makeValidation({ confidenceScore: 0.85 }) },
    });
    expect(wrapper.text()).toContain('85%');
  });

  it('shows "Approved" badge when approved', () => {
    const wrapper = mount(ValidationFeedback, {
      props: { validation: makeValidation({ approved: true }) },
    });
    expect(wrapper.text()).toContain('Approved');
  });

  it('shows "Needs Revision" when not approved', () => {
    const wrapper = mount(ValidationFeedback, {
      props: { validation: makeValidation({ approved: false }) },
    });
    expect(wrapper.text()).toContain('Needs Revision');
  });

  it('uses green confidence bar for score >= 0.8', () => {
    const wrapper = mount(ValidationFeedback, {
      props: { validation: makeValidation({ confidenceScore: 0.9 }) },
    });
    expect(wrapper.html()).toContain('bg-green-500');
  });

  it('uses yellow confidence bar for score 0.5-0.79', () => {
    const wrapper = mount(ValidationFeedback, {
      props: { validation: makeValidation({ confidenceScore: 0.6 }) },
    });
    expect(wrapper.html()).toContain('bg-yellow-500');
  });

  it('uses red confidence bar for score < 0.5', () => {
    const wrapper = mount(ValidationFeedback, {
      props: { validation: makeValidation({ confidenceScore: 0.3 }) },
    });
    expect(wrapper.html()).toContain('bg-red-500');
  });

  it('renders issues list', () => {
    const wrapper = mount(ValidationFeedback, {
      props: { validation: makeValidation({ issues: ['Bug A', 'Bug B'], approved: false }) },
    });
    expect(wrapper.text()).toContain('Issues');
    expect(wrapper.text()).toContain('Bug A');
    expect(wrapper.text()).toContain('Bug B');
  });

  it('renders missing cases', () => {
    const wrapper = mount(ValidationFeedback, {
      props: { validation: makeValidation({ missingCases: ['Edge case'], approved: false }) },
    });
    expect(wrapper.text()).toContain('Missing Cases');
    expect(wrapper.text()).toContain('Edge case');
  });

  it('renders conflicts', () => {
    const wrapper = mount(ValidationFeedback, {
      props: { validation: makeValidation({ conflicts: ['Conflict X'], approved: false }) },
    });
    expect(wrapper.text()).toContain('Conflicts');
    expect(wrapper.text()).toContain('Conflict X');
  });

  it('shows success message when all lists empty', () => {
    const wrapper = mount(ValidationFeedback, {
      props: { validation: makeValidation() },
    });
    expect(wrapper.text()).toContain('No issues found');
  });
});
