import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import PopoverSelect from '../PopoverSelect.vue';

const options = [
  { id: 'a', label: 'Option A', icon: 'X' },
  { id: 'b', label: 'Option B' },
];

describe('PopoverSelect', () => {
  it('renders trigger button with selected label', () => {
    const wrapper = mount(PopoverSelect, {
      props: { options, modelValue: 'a' },
    });
    expect(wrapper.text()).toContain('Option A');
  });

  it('shows icon for selected option', () => {
    const wrapper = mount(PopoverSelect, {
      props: { options, modelValue: 'a' },
    });
    expect(wrapper.text()).toContain('X');
  });

  it('opens menu on trigger click', async () => {
    const wrapper = mount(PopoverSelect, {
      props: { options, modelValue: 'a' },
    });
    expect(wrapper.findAll('button').length).toBe(1);

    await wrapper.find('button').trigger('click');
    expect(wrapper.findAll('button').length).toBeGreaterThan(1);
  });

  it('closes menu on option click and emits update:modelValue', async () => {
    const wrapper = mount(PopoverSelect, {
      props: { options, modelValue: 'a' },
    });
    await wrapper.find('button').trigger('click');

    const optionButtons = wrapper.findAll('button');
    const optionB = optionButtons.find((b) => b.text().includes('Option B'));
    expect(optionB).toBeDefined();
    await optionB!.trigger('click');

    expect(wrapper.emitted('update:modelValue')).toBeTruthy();
    expect(wrapper.emitted('update:modelValue')![0]).toEqual(['b']);
  });

  it('shows placeholder when modelValue not in options', () => {
    const wrapper = mount(PopoverSelect, {
      props: { options, modelValue: 'nonexistent', placeholder: 'Pick one' },
    });
    expect(wrapper.text()).toContain('Pick one');
  });

  it('shows "No options available" when options is empty', async () => {
    const wrapper = mount(PopoverSelect, {
      props: { options: [], modelValue: '' },
    });
    await wrapper.find('button').trigger('click');
    expect(wrapper.text()).toContain('No options available');
  });

  it('closes on Escape key', async () => {
    const wrapper = mount(PopoverSelect, {
      props: { options, modelValue: 'a' },
      attachTo: document.body,
    });
    await wrapper.find('button').trigger('click');
    expect(wrapper.findAll('button').length).toBeGreaterThan(1);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await wrapper.vm.$nextTick();

    expect(wrapper.findAll('button').length).toBe(1);
    wrapper.unmount();
  });
});
