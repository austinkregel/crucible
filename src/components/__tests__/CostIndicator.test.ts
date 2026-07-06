import { describe, it, expect, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import CostIndicator from '../CostIndicator.vue';
import { useCostStore } from '../../stores/cost';

describe('CostIndicator', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('is hidden when no records', () => {
    const wrapper = mount(CostIndicator);
    expect(wrapper.find('div').exists()).toBe(false);
  });

  it('is visible when records exist', () => {
    const store = useCostStore();
    store.addRecord({
      requestId: 'r1',
      model: 'test',
      inputTokens: 1500,
      outputTokens: 500,
      cost: 0.005,
    });

    const wrapper = mount(CostIndicator);
    expect(wrapper.find('div').exists()).toBe(true);
  });

  it('formats tokens with k suffix for >= 1000', () => {
    const store = useCostStore();
    store.addRecord({
      requestId: 'r1',
      model: 'test',
      inputTokens: 1500,
      outputTokens: 2000,
      cost: 0.005,
    });

    const wrapper = mount(CostIndicator);
    expect(wrapper.text()).toContain('1.5k');
    expect(wrapper.text()).toContain('2.0k');
  });

  it('formats tokens without k suffix for < 1000', () => {
    const store = useCostStore();
    store.addRecord({
      requestId: 'r1',
      model: 'test',
      inputTokens: 500,
      outputTokens: 200,
      cost: 0.001,
    });

    const wrapper = mount(CostIndicator);
    expect(wrapper.text()).toContain('500');
    expect(wrapper.text()).toContain('200');
  });

  it('formats small cost with 4 decimals', () => {
    const store = useCostStore();
    store.addRecord({
      requestId: 'r1',
      model: 'test',
      inputTokens: 100,
      outputTokens: 50,
      cost: 0.0025,
    });

    const wrapper = mount(CostIndicator);
    expect(wrapper.text()).toContain('$0.0025');
  });

  it('formats larger cost with 2 decimals', () => {
    const store = useCostStore();
    store.addRecord({
      requestId: 'r1',
      model: 'test',
      inputTokens: 10000,
      outputTokens: 5000,
      cost: 1.25,
    });

    const wrapper = mount(CostIndicator);
    expect(wrapper.text()).toContain('$1.25');
  });
});
