import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import QuestionPrompt from '../QuestionPrompt.vue';
import type { PendingQuestion } from '../../stores/agents';
import { makeRef, questionId } from '../../__mocks__/agentMessages';

function pending(overrides: Partial<PendingQuestion['question']> = {}): PendingQuestion {
  const ref = makeRef({ runId: 'r1', agentId: 'a-explore-123', agentType: 'explore' });
  return {
    id: questionId('q1'),
    seq: 0,
    question: {
      ref,
      kind: 'choice',
      prompt: 'Which file?',
      options: ['session.ts', 'oauth.ts'],
      ...overrides,
    },
  };
}

describe('QuestionPrompt', () => {
  it('shows which agent is asking (attribution)', () => {
    const wrapper = mount(QuestionPrompt, { props: { pending: pending() } });
    const agent = wrapper.find('[data-testid="question-agent"]');
    expect(agent.text()).toBe('explore');
    // short agent id is shown for disambiguation
    expect(wrapper.text()).toContain('a-explor');
  });

  it('renders the prompt text', () => {
    const wrapper = mount(QuestionPrompt, { props: { pending: pending() } });
    expect(wrapper.find('[data-testid="question-prompt-text"]').text()).toBe('Which file?');
  });

  it('renders one button per option for choice questions', () => {
    const wrapper = mount(QuestionPrompt, { props: { pending: pending() } });
    const opts = wrapper.findAll('[data-testid="question-option"]');
    expect(opts).toHaveLength(2);
    expect(opts.map((o) => o.text())).toEqual(['session.ts', 'oauth.ts']);
  });

  it('emits answer with the chosen option for a choice question', async () => {
    const wrapper = mount(QuestionPrompt, { props: { pending: pending() } });
    await wrapper.findAll('[data-testid="question-option"]')[1].trigger('click');

    const emitted = wrapper.emitted('answer');
    expect(emitted).toHaveLength(1);
    expect(emitted![0][0]).toEqual({
      id: questionId('q1'),
      answer: { choice: 'oauth.ts' },
    });
  });

  it('emits answer with remember flag for an approval question', async () => {
    const wrapper = mount(QuestionPrompt, {
      props: {
        pending: pending({ kind: 'approval', prompt: 'Overwrite?', options: ['Allow', 'Deny'] }),
      },
    });
    await wrapper.findAll('[data-testid="question-option"]')[0].trigger('click');

    const emitted = wrapper.emitted('answer');
    expect(emitted![0][0]).toEqual({
      id: questionId('q1'),
      answer: { choice: 'Allow', remember: false },
    });
  });

  it('renders a text input for text questions and emits typed answer', async () => {
    const wrapper = mount(QuestionPrompt, {
      props: { pending: pending({ kind: 'text', prompt: 'Name?', options: undefined }) },
    });
    expect(wrapper.findAll('[data-testid="question-option"]')).toHaveLength(0);

    const input = wrapper.find('[data-testid="question-text-input"]');
    await input.setValue('MY_VAR');
    await wrapper.find('[data-testid="question-submit"]').trigger('click');

    const emitted = wrapper.emitted('answer');
    expect(emitted![0][0]).toEqual({
      id: questionId('q1'),
      answer: { text: 'MY_VAR' },
    });
  });

  it('does not emit for empty text submission', async () => {
    const wrapper = mount(QuestionPrompt, {
      props: { pending: pending({ kind: 'text', prompt: 'Name?', options: undefined }) },
    });
    await wrapper.find('[data-testid="question-submit"]').trigger('click');
    expect(wrapper.emitted('answer')).toBeUndefined();
  });
});
