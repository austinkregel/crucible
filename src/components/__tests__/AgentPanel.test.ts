import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import AgentPanel from '../AgentPanel.vue';
import { useAgentsStore } from '../../stores/agents';
import { makeRef, treeMsg, eventMsg, questionMsg } from '../../__mocks__/agentMessages';

const postMessage = vi.fn();
(globalThis as unknown as { acquireVsCodeApi: () => unknown }).acquireVsCodeApi = () => ({
  postMessage,
  getState: () => undefined,
  setState: () => undefined,
});

describe('AgentPanel', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    postMessage.mockClear();
  });

  it('is hidden when there is no agent activity', () => {
    const wrapper = mount(AgentPanel);
    expect(wrapper.find('[data-testid="agent-panel"]').exists()).toBe(false);
  });

  it('renders one lane per concurrent agent without clobbering their events', () => {
    const store = useAgentsStore();
    const a = makeRef({ runId: 'r1', agentId: 'a', agentType: 'explore' });
    const b = makeRef({ runId: 'r1', agentId: 'b', agentType: 'edit' });
    store.handleMessage(treeMsg(a, 'running'));
    store.handleMessage(treeMsg(b, 'running'));
    store.handleMessage(eventMsg(a, 'notice', { message: 'A working' }));
    store.handleMessage(eventMsg(b, 'notice', { message: 'B working' }));

    const wrapper = mount(AgentPanel);
    const lanes = wrapper.findAll('[data-testid="agent-lane"]');
    expect(lanes).toHaveLength(2);
    expect(wrapper.text()).toContain('A working');
    expect(wrapper.text()).toContain('B working');
  });

  it('surfaces a "N agents waiting on you" banner and one prompt per pending question', () => {
    const store = useAgentsStore();
    const a = makeRef({ runId: 'r1', agentId: 'a', agentType: 'explore' });
    const b = makeRef({ runId: 'r1', agentId: 'b', agentType: 'edit' });
    store.handleMessage(questionMsg('q1', a, { kind: 'text', prompt: 'A?' }));
    store.handleMessage(questionMsg('q2', b, { kind: 'text', prompt: 'B?' }));

    const wrapper = mount(AgentPanel);
    expect(wrapper.find('[data-testid="waiting-banner"]').text()).toContain('2 agents waiting on you');
    expect(wrapper.findAll('[data-testid="question-prompt"]')).toHaveLength(2);
  });

  it('answering a question posts answerQuestion via the store', async () => {
    const store = useAgentsStore();
    const a = makeRef({ runId: 'r1', agentId: 'a', agentType: 'explore' });
    store.handleMessage(questionMsg('q1', a, { kind: 'text', prompt: 'A?' }));

    const wrapper = mount(AgentPanel);
    await wrapper.find('[data-testid="question-text-input"]').setValue('hi');
    await wrapper.find('[data-testid="question-submit"]').trigger('click');

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'answerQuestion', answer: { text: 'hi' } }),
    );
  });

  it('cancelling a lane posts cancelAgent', async () => {
    const store = useAgentsStore();
    const a = makeRef({ runId: 'r1', agentId: 'a', agentType: 'explore' });
    store.handleMessage(treeMsg(a, 'running'));

    const wrapper = mount(AgentPanel);
    await wrapper.find('[data-testid="agent-cancel"]').trigger('click');

    expect(postMessage).toHaveBeenCalledWith({ type: 'cancelAgent', agentId: a.agentId });
  });
});
