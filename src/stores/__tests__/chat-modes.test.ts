import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useChatStore } from '../chat';

describe('Chat store -- three mode system', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('defaults to ask mode', () => {
    const store = useChatStore();
    expect(store.mode).toBe('ask');
  });

  it('can switch to plan mode', () => {
    const store = useChatStore();
    store.setMode('plan');
    expect(store.mode).toBe('plan');
  });

  it('can switch to agent mode', () => {
    const store = useChatStore();
    store.setMode('agent');
    expect(store.mode).toBe('agent');
  });

  it('can switch back to ask mode', () => {
    const store = useChatStore();
    store.setMode('agent');
    store.setMode('ask');
    expect(store.mode).toBe('ask');
  });
});

describe('Chat store -- plan artifacts', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('starts with no plan', () => {
    const store = useChatStore();
    expect(store.activePlan).toBeNull();
    expect(store.hasPlan).toBe(false);
    expect(store.isPlanApproved).toBe(false);
  });

  it('can set a plan', () => {
    const store = useChatStore();
    store.setPlan({
      summary: 'Test plan',
      steps: [
        { id: 's1', goal: 'Do thing', files: ['a.ts'], risks: [], constraints: [], status: 'pending' },
      ],
      assumptions: ['Assumption 1'],
      approved: false,
    });
    expect(store.hasPlan).toBe(true);
    expect(store.activePlan?.summary).toBe('Test plan');
    expect(store.isPlanApproved).toBe(false);
  });

  it('can approve a plan', () => {
    const store = useChatStore();
    store.setPlan({
      summary: 'Plan',
      steps: [],
      assumptions: [],
      approved: false,
    });
    store.approvePlan();
    expect(store.isPlanApproved).toBe(true);
  });

  it('can clear a plan', () => {
    const store = useChatStore();
    store.setPlan({
      summary: 'Plan',
      steps: [],
      assumptions: [],
      approved: true,
    });
    store.clearPlan();
    expect(store.activePlan).toBeNull();
    expect(store.hasPlan).toBe(false);
  });

  it('can update a plan step status', () => {
    const store = useChatStore();
    store.setPlan({
      summary: 'Plan',
      steps: [
        { id: 's1', goal: 'Step 1', files: [], risks: [], constraints: [], status: 'pending' },
        { id: 's2', goal: 'Step 2', files: [], risks: [], constraints: [], status: 'pending' },
      ],
      assumptions: [],
      approved: false,
    });

    store.updatePlanStep('s1', 'running');
    expect(store.activePlan?.steps[0].status).toBe('running');
    expect(store.activePlan?.steps[1].status).toBe('pending');

    store.updatePlanStep('s1', 'done', 'Changes applied');
    expect(store.activePlan?.steps[0].status).toBe('done');
    expect(store.activePlan?.steps[0].result).toBe('Changes applied');
  });
});
