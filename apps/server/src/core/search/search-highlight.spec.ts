import { highlightSubstrings } from './search-highlight';

describe('highlightSubstrings', () => {
  it('highlights Chinese inside a mixed alphanumeric word', () => {
    expect(highlightSubstrings('123中文测试123', ['中文'])).toEqual({
      highlight: '123<b>中文</b>测试123',
      matchedText: ['中文'],
    });
  });

  it('escapes document HTML and keeps navigation terms as plain text', () => {
    expect(highlightSubstrings('<img src=x> 中文<&', ['中文<&'])).toEqual({
      highlight: '&lt;img src=x&gt; <b>中文&lt;&amp;</b>',
      matchedText: ['中文<&'],
    });
  });

  it('treats regular expression syntax literally', () => {
    expect(highlightSubstrings('配置[a+b].* 配置a', ['配置[a+b].*'])).toEqual({
      highlight: '<b>配置[a+b].*</b> 配置a',
      matchedText: ['配置[a+b].*'],
    });
  });

  it('normalizes whitespace and highlights mixed queries case insensitively', () => {
    expect(
      highlightSubstrings('中文\nENGLISH 中文', ['中文', 'english']),
    ).toEqual({
      highlight: '<b>中文</b> <b>ENGLISH</b> <b>中文</b>',
      matchedText: ['中文', 'ENGLISH'],
    });
  });
});
