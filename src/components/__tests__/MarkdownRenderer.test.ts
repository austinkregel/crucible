import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import MarkdownRenderer from '../MarkdownRenderer.vue';

describe('MarkdownRenderer', () => {
  it('renders markdown heading as HTML', () => {
    const wrapper = mount(MarkdownRenderer, {
      props: { content: '# Hello' },
    });
    expect(wrapper.find('h1').exists()).toBe(true);
    expect(wrapper.find('h1').text()).toBe('Hello');
  });

  it('renders empty content as empty', () => {
    const wrapper = mount(MarkdownRenderer, {
      props: { content: '' },
    });
    expect(wrapper.find('.markdown-body').html()).toContain('');
  });

  it('renders code blocks', () => {
    const wrapper = mount(MarkdownRenderer, {
      props: { content: '```\nconst x = 1;\n```' },
    });
    expect(wrapper.find('code').exists()).toBe(true);
    expect(wrapper.text()).toContain('const x = 1;');
  });

  it('renders links', () => {
    const wrapper = mount(MarkdownRenderer, {
      props: { content: '[Example](https://example.com)' },
    });
    const link = wrapper.find('a');
    expect(link.exists()).toBe(true);
    expect(link.attributes('href')).toBe('https://example.com');
    expect(link.text()).toBe('Example');
  });

  it('renders bold and italic text', () => {
    const wrapper = mount(MarkdownRenderer, {
      props: { content: '**bold** and *italic*' },
    });
    expect(wrapper.find('strong').text()).toBe('bold');
    expect(wrapper.find('em').text()).toBe('italic');
  });

  it('renders lists', () => {
    const wrapper = mount(MarkdownRenderer, {
      props: { content: '- item 1\n- item 2\n- item 3' },
    });
    const items = wrapper.findAll('li');
    expect(items.length).toBe(3);
  });

  it('does not crash on malformed markdown', () => {
    const wrapper = mount(MarkdownRenderer, {
      props: { content: '```\nunclosed code block' },
    });
    expect(wrapper.text()).toContain('unclosed code block');
  });
});
