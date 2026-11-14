import { expect, test } from '@playwright/test';

test('answer outline tracks headings, jumps, collapses and hides short messages', async ({ page, request }) => {
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
  const short = await (await request.post('/api/documents/import', { data: { name: '短回答.md', markdown: '## 标题\n\n短正文。', resources: [] } })).json();
  await page.evaluate(id => localStorage.setItem('lastSession', id), short.id);
  await page.reload();
  await expect(page.locator('.workspace .message-content h2')).toBeVisible();
  await expect(outline).toHaveCount(0);
});
