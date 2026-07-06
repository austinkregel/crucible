import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import ToolCallBlock from '../ToolCallBlock.vue';

describe('ToolCallBlock', () => {
  const baseProps = {
    toolName: 'read_file',
    args: { path: 'src/auth.ts' },
    status: 'completed' as const,
    result: 'export class Auth {}',
  };

  it('renders tool name', () => {
    const wrapper = mount(ToolCallBlock, { props: baseProps });
    expect(wrapper.text()).toContain('read_file');
  });

  it('shows args summary line', () => {
    const wrapper = mount(ToolCallBlock, { props: baseProps });
    expect(wrapper.text()).toContain('src/auth.ts');
  });

  it('renders correct icon for file tools', () => {
    const wrapper = mount(ToolCallBlock, { props: baseProps });
    const icon = wrapper.find('[data-testid="tool-icon"]');
    expect(icon.exists()).toBe(true);
  });

  it('renders correct icon for search tools', () => {
    const wrapper = mount(ToolCallBlock, {
      props: { ...baseProps, toolName: 'search_code', args: { pattern: 'auth' } },
    });
    const icon = wrapper.find('[data-testid="tool-icon"]');
    expect(icon.exists()).toBe(true);
  });

  it('renders correct icon for terminal tools', () => {
    const wrapper = mount(ToolCallBlock, {
      props: { ...baseProps, toolName: 'run_command', args: { command: 'npm test' } },
    });
    const icon = wrapper.find('[data-testid="tool-icon"]');
    expect(icon.exists()).toBe(true);
  });

  it('starts collapsed', () => {
    const wrapper = mount(ToolCallBlock, { props: baseProps });
    const details = wrapper.find('[data-testid="tool-result"]');
    expect(details.exists()).toBe(false);
  });

  it('expands on click', async () => {
    const wrapper = mount(ToolCallBlock, { props: baseProps });
    await wrapper.find('[data-testid="tool-header"]').trigger('click');
    const details = wrapper.find('[data-testid="tool-result"]');
    expect(details.exists()).toBe(true);
    expect(details.text()).toContain('export class Auth {}');
  });

  it('shows spinner when status is running', () => {
    const wrapper = mount(ToolCallBlock, {
      props: { ...baseProps, status: 'running', result: undefined },
    });
    const spinner = wrapper.find('[data-testid="status-running"]');
    expect(spinner.exists()).toBe(true);
  });

  it('shows checkmark when status is completed', () => {
    const wrapper = mount(ToolCallBlock, { props: baseProps });
    const check = wrapper.find('[data-testid="status-completed"]');
    expect(check.exists()).toBe(true);
  });

  it('shows error icon when status is failed', () => {
    const wrapper = mount(ToolCallBlock, {
      props: { ...baseProps, status: 'failed', error: 'File not found' },
    });
    const err = wrapper.find('[data-testid="status-failed"]');
    expect(err.exists()).toBe(true);
    expect(wrapper.text()).toContain('File not found');
  });

  it('shows duration when provided', () => {
    const wrapper = mount(ToolCallBlock, {
      props: { ...baseProps, duration_ms: 42 },
    });
    expect(wrapper.text()).toContain('42ms');
  });
});
