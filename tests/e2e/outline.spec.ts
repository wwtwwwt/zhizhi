import { expect, test } from '@playwright/test';
import type { Message, Session } from '../../shared/types';

test('outline fades between answers and disappears for an answer without headings', async ({ page, request }) => {
  await request.put('/api/settings', { data: { showOutline: true } });
  const paragraph = '用于验证多条消息之间的目录切换。'.repeat(200);
  const sessions: Session[] = [];
  for (const markdown of [`## 前一回答\n\n${paragraph}`, `## 后一回答\n\n${paragraph}`, paragraph]) {
    sessions.push(await (await request.post('/api/documents/import', { data: { name: '目录过渡.md', markdown, resources: [] } })).json());
  }
  const messages: Message[] = [];
  for (const session of sessions) {
    const stream = await (await request.get(`/api/streams/${session.root_stream_id}`)).json();
    messages.push({ ...stream.messages[0], role: 'assistant', ordinal: messages.length });
  }
  await page.route(`**/api/streams/${sessions[0].root_stream_id}`, async route => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...await response.json(), messages } });
  });
  await page.goto('/');
  await page.evaluate(id => localStorage.setItem('lastSession', id), sessions[0].id);
  await page.reload();
  const outline = page.getByRole('navigation', { name: '当前回答目录' });
  await expect(outline).toContainText('前一回答');
  const jump = async (index: number) => page.locator('.workspace .conversation-scroll').evaluate((element, index) => {
    const message = element.querySelectorAll<HTMLElement>('[data-message]')[index];
    element.scrollTo({ top: element.scrollTop + message.getBoundingClientRect().top - element.getBoundingClientRect().top - 8, behavior: 'instant' });
  }, index);
  await jump(1);
  await expect(outline).toContainText('后一回答');
  await expect.poll(() => outline.evaluate(element => getComputedStyle(element).opacity)).toBe('1');
  await jump(2);
  await expect(page.locator('.workspace .message-outline')).toHaveCount(0);
  await jump(0);
  await expect(outline).toContainText('前一回答');
});

test('answer outline tracks headings, jumps, collapses and hides short messages', async ({ page, request }) => {
  await request.put('/api/settings', { data: { showOutline: true, theme: 'light' } });
  const paragraph = '这是一段用于验证目录定位的长正文，滚动到标题时应保持目录可见。'.repeat(70);
  const markdown = `## 第一部分\n\n${paragraph}\n\n### 细节说明\n\n${paragraph}\n\n## 第二部分\n\n${paragraph}\n\n\`\`\`md\n## 代码中的标题\n\`\`\``;
  const response = await request.post('/api/documents/import', { data: { name: '目录验证.md', markdown, resources: [] } });
  const imported = await response.json();
  await page.route('**/api/streams/*', async route => {
    const response = await route.fetch();
    const stream = await response.json();
    stream.messages.forEach((message: { role: string }) => { message.role = 'assistant'; });
    await route.fulfill({ response, json: stream });
  });
  await page.goto('/');
  await page.evaluate(id => localStorage.setItem('lastSession', id), imported.id);
  await page.reload();
  const outline = page.getByRole('navigation', { name: '当前回答目录' });
  await expect(outline).toBeVisible();
  await expect(outline.locator('.message-outline-items button')).toHaveCount(3);
  const surface = await outline.evaluate(element => ({ background: getComputedStyle(element).backgroundImage, page: getComputedStyle(element.closest('.workspace')!).backgroundColor }));
  expect(surface.background).toContain(surface.page);
  const heading = page.locator('.workspace .message-content h2').first();
  await heading.hover();
  await expect(heading).toHaveAttribute('data-marker-fits', 'true');
  await expect.poll(() => heading.evaluate(element => getComputedStyle(element, '::after').opacity)).toBe('1');
  expect(await heading.evaluate(element => getComputedStyle(element, '::after').content)).toBe('"##"');
  await expect(heading).toHaveText('第一部分');
  await heading.evaluate(element => { element.style.width = '80px'; });
  await expect(heading).toHaveAttribute('data-marker-fits', 'false');
  await heading.evaluate(element => { element.style.removeProperty('width'); });
  await outline.getByRole('button', { name: '第二部分', exact: true }).click();
  await expect(outline.getByRole('button', { name: '第二部分', exact: true })).toHaveAttribute('aria-current', 'location');
  const distance = await page.locator('.workspace .message-content h2').last().evaluate(element => element.getBoundingClientRect().top - element.closest('.conversation-scroll')!.getBoundingClientRect().top);
  expect(Math.abs(distance - 12)).toBeLessThan(3);
  await outline.getByRole('button', { name: '收起目录', exact: true }).click();
  await expect(outline.getByRole('button', { name: '展开目录', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await expect(outline.getByRole('button', { name: '第二部分', exact: true })).toHaveCount(0);
  await expect.poll(() => outline.locator('.message-outline-collapse').evaluate(element => element.getBoundingClientRect().height)).toBe(0);
  await outline.getByRole('button', { name: '展开目录', exact: true }).click();
  await expect(outline.locator('.message-outline-items button')).toHaveCount(3);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('tab', { name: '通用', exact: true }).click();
  await page.getByRole('checkbox', { name: '显示回答目录', exact: true }).uncheck();
  await expect.poll(async () => (await (await request.get('/api/settings')).json()).showOutline).toBe(false);
  await page.getByRole('button', { name: '回到对话', exact: true }).click();
  await expect(outline).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.workspace .message-content h2').first()).toBeVisible();
  await expect(outline).toHaveCount(0);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('tab', { name: '通用', exact: true }).click();
  await page.getByRole('checkbox', { name: '显示回答目录', exact: true }).check();
  await page.getByRole('button', { name: '回到对话', exact: true }).click();
  await expect(outline).toBeVisible();
  const short = await (await request.post('/api/documents/import', { data: { name: '短回答.md', markdown: '## 标题\n\n短正文。', resources: [] } })).json();
  await page.evaluate(id => localStorage.setItem('lastSession', id), short.id);
  await page.reload();
  await expect(page.locator('.workspace .message-content h2')).toBeVisible();
  await expect(outline).toHaveCount(0);
});
