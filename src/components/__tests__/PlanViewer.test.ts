import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import PlanViewer from '../PlanViewer.vue';

const plan = {
  summary: 'Test plan summary',
  steps: [
    { id: 's1', goal: 'Step one', files: ['a.ts'], status: 'pending' as const, risks: ['Risk A'] },
    { id: 's2', goal: 'Step two', files: [], status: 'done' as const },
    { id: 's3', goal: 'Step three', files: [], status: 'failed' as const },
    { id: 's4', goal: 'Step four', files: [], status: 'running' as const },
  ],
  assumptions: ['Assumption 1'],
};

describe('PlanViewer', () => {
  it('renders plan summary', () => {
    const wrapper = mount(PlanViewer, { props: { plan } });
    expect(wrapper.text()).toContain('Test plan summary');
  });

  it('renders all steps', () => {
    const wrapper = mount(PlanViewer, { props: { plan } });
    expect(wrapper.text()).toContain('Step one');
    expect(wrapper.text()).toContain('Step two');
    expect(wrapper.text()).toContain('Step three');
    expect(wrapper.text()).toContain('Step four');
  });

  it('shows Run/Skip buttons only for pending steps', () => {
    const wrapper = mount(PlanViewer, { props: { plan } });
    const runButtons = wrapper.findAll('button').filter((b) => b.text() === 'Run');
    const skipButtons = wrapper.findAll('button').filter((b) => b.text() === 'Skip');
    expect(runButtons).toHaveLength(1);
    expect(skipButtons).toHaveLength(1);
  });

  it('emits approveStep on Run click', async () => {
    const wrapper = mount(PlanViewer, { props: { plan } });
    const runBtn = wrapper.findAll('button').find((b) => b.text() === 'Run');
    await runBtn!.trigger('click');
    expect(wrapper.emitted('approveStep')).toBeTruthy();
    expect(wrapper.emitted('approveStep')![0]).toEqual(['s1']);
  });

  it('emits rejectStep on Skip click', async () => {
    const wrapper = mount(PlanViewer, { props: { plan } });
    const skipBtn = wrapper.findAll('button').find((b) => b.text() === 'Skip');
    await skipBtn!.trigger('click');
    expect(wrapper.emitted('rejectStep')).toBeTruthy();
    expect(wrapper.emitted('rejectStep')![0]).toEqual(['s1']);
  });

  it('shows file badges for steps with files', () => {
    const wrapper = mount(PlanViewer, { props: { plan } });
    expect(wrapper.text()).toContain('a.ts');
  });

  it('shows risk warnings', () => {
    const wrapper = mount(PlanViewer, { props: { plan } });
    expect(wrapper.text()).toContain('Risk A');
  });

  it('shows assumptions section', () => {
    const wrapper = mount(PlanViewer, { props: { plan } });
    expect(wrapper.text()).toContain('Assumptions');
    expect(wrapper.text()).toContain('Assumption 1');
  });

  it('does not show assumptions when empty', () => {
    const noPlan = { ...plan, assumptions: [] };
    const wrapper = mount(PlanViewer, { props: { plan: noPlan } });
    expect(wrapper.text()).not.toContain('Assumptions');
  });

  it('shows correct status icons', () => {
    const wrapper = mount(PlanViewer, { props: { plan } });
    const html = wrapper.html();
    expect(html).toContain('○');
    expect(html).toContain('●');
    expect(html).toContain('✕');
    expect(html).toContain('◌');
  });
});
