import { expect, test, type Page, type Locator } from '@playwright/test';

async function closeBranch(page: Page) {
  const count = await page.locator('.branch-dialog').count();
  await page.keyboard.press('Escape');
  await expect(page.locator('.branch-dialog')).toHaveCount(count - 1);
}

async function blockMenu(block: Locator) {
  const menu = block.getByRole('menu', { name: '块操作菜单' });
  if (!await menu.isVisible()) { await block.hover(); await block.getByRole('button', { name: '块操作', exact: true }).click(); }
  return menu;
}
async function changeVersion(block: Locator, direction: '上一个版本' | '下一个版本') {
  const menu = await blockMenu(block); await menu.getByRole('button', { name: direction }).click();
  await expect(block.locator('[data-node]')).toBeVisible();
  await block.page().keyboard.press('Escape');
}

async function selectText(page: Page, block: Locator, text: string) {
  await block.scrollIntoViewIfNeeded();
  await block.evaluate((el, text) => {
    const content = el.textContent!; const from = content.indexOf(text); if (from < 0) throw new Error('text missing');
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); const nodes: Text[] = []; while (walker.nextNode()) nodes.push(walker.currentNode as Text);
    const at = (offset: number): [Text, number] => { for (const n of nodes) { if (offset <= n.length) return [n, offset]; offset -= n.length; } throw new Error('offset missing'); };
    const range = document.createRange(); range.setStart(...at(from)); range.setEnd(...at(from + text.length)); const selection = getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }, text);
  await page.locator('.selection-trigger').click();
}
async function branch(page: Page, block: Locator, text: string, question: string) {
  const depth = await page.locator('.branch-dialog').count();
  await selectText(page, block, text);
  await page.getByPlaceholder('这里有什么想进一步了解的？').fill(question);
  await page.getByRole('button', { name: '创建分支', exact: true }).click();
  await expect(page.locator('.branch-dialog')).toHaveCount(depth + 1);
  await expect(page.locator('.top-layer .message-assistant .content-block').first()).toBeVisible();
}
test('selection → three branch layers → drafts/scroll/focus → rewrite versions → refresh', async ({ page, request }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  const settings = await (await request.get('/api/settings')).json(); await request.put('/api/settings', { data: { ...settings, fakeDelay: 0 } });
  await page.goto('/'); await page.getByRole('button', { name: '新的对话', exact: true }).click();
  await page.getByRole('textbox', { name: '输入你的问题' }).fill('解释梯度下降'); await page.getByRole('button', { name: '发送问题', exact: true }).click();
  const root = page.locator('.workspace .message-assistant .content-block').first(); await expect(root).toBeVisible();
  await page.getByRole('textbox', { name: '输入你的问题' }).fill('主干草稿');
  await selectText(page, root.locator('[data-node]'), '从一个具体问题开始。我们以梯度下降为例');
  await page.getByPlaceholder('这里有什么想进一步了解的？').fill('为什么沿负梯度？'); await page.getByRole('button', { name: '创建分支', exact: true }).click();
  await expect(page.locator('.top-layer .message-assistant .content-block').first()).toBeVisible();
  await page.locator('.top-layer textarea[aria-label="继续分支对话"]').fill('分支草稿');
  await branch(page, page.locator('.top-layer .message-assistant [data-node]').first(), '梯度', '梯度是什么？');
  await branch(page, page.locator('.top-layer .message-assistant [data-node]').first(), '偏导数', '再给一个例子');
  await expect(page.locator('.branch-dialog')).toHaveCount(3);

  await closeBranch(page); await closeBranch(page);
  await expect(page.locator('.top-layer textarea[aria-label="继续分支对话"]')).toHaveValue('分支草稿');
  await closeBranch(page);
  await expect(page.getByRole('textbox', { name: '输入你的问题' })).toHaveValue('主干草稿');
  await expect(root.locator('mark').first()).toBeFocused();
  await root.locator('mark').first().click(); await expect(page.locator('.branch-dialog')).toHaveCount(1); await closeBranch(page);
  const tools = page.locator(`[data-slot-tools="${await root.getAttribute('data-slot')}"]`);
  await (await blockMenu(root)).getByRole('menuitem', { name: '结合追问重新回答', exact: true }).click();
  await root.getByRole('button', { name: '采用新版', exact: true }).click();
  await expect(root.locator('mark')).toHaveCount(0); await expect(root.getByRole('button', { name: '历史版本', exact: true })).toBeVisible();
  await changeVersion(root, '上一个版本'); await expect(root.locator('mark').first()).toBeVisible();
  await changeVersion(root, '下一个版本');
  await branch(page, root.locator('[data-node]'), '梯度', '新版的追问'); await closeBranch(page);
  await page.reload(); await expect(root.getByRole('button', { name: '历史版本', exact: true })).toBeVisible(); await expect(root.locator('mark')).toHaveCount(1);
  await changeVersion(root, '上一个版本'); await root.locator('mark').first().click();
  await expect(page.locator('.top-layer')).toContainText('为什么沿负梯度');
  await closeBranch(page);
  await page.getByRole('button', { name: '设置', exact: true }).click(); await page.getByRole('tab', { name: '供应商', exact: true }).click();
  await page.getByRole('button', { name: '编辑模型：模拟模式', exact: true }).click();
  await page.getByRole('slider', { name: '模拟输出间隔' }).fill('10'); await page.getByRole('button',{name:'保存模型',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'配置模型',exact:true})).toHaveCount(0);
  expect((await (await request.get('/api/settings')).json()).fakeDelay).toBe(10);
  await page.getByRole('button', { name: '回到对话', exact: true }).click();
  await page.setViewportSize({ width: 1024, height: 768 }); await root.locator('mark').first().click();
  const rect = await page.locator('.top-layer').boundingBox(); expect(rect!.x).toBeGreaterThanOrEqual(0); expect(rect!.y).toBeGreaterThanOrEqual(0);
  expect(errors).toEqual([]);
});

test('closing a streaming branch keeps generation running; later reopening restores content', async ({ page, request }) => {
  const settings = await (await request.get('/api/settings')).json(); await request.put('/api/settings', { data: { ...settings, fakeDelay: 0 } });
  await page.goto('/'); await page.getByRole('button', { name: '新的对话', exact: true }).click();
  await page.getByRole('textbox', { name: '输入你的问题' }).fill('后台分支测试'); await page.getByRole('button', { name: '发送问题', exact: true }).click();
  const root = page.locator('.workspace .message-assistant .content-block').first(); await expect(root).toBeVisible();
  await request.put('/api/settings', { data: { ...settings, fakeDelay: 20 } });
  await selectText(page, root.locator('[data-node]'), '梯度下降'); await page.getByPlaceholder('这里有什么想进一步了解的？').fill('解释这个概念'); await page.getByRole('button', { name: '创建分支', exact: true }).click();
  await expect(page.locator('.top-layer .streaming-draft')).toBeVisible();
  await closeBranch(page); await root.locator('mark').first().click();
  await expect(page.locator('.top-layer .message-assistant .content-block').first()).toBeVisible();
  await expect(page.locator('.top-layer .failed-message')).toHaveCount(0);
});

test('stop preserves draft without retry, settings save, sessions rename/delete', async ({ page, request }) => {
  const settings = await (await request.get('/api/settings')).json(); await request.put('/api/settings', { data: { ...settings, fakeDelay: 80 } });
  await page.goto('/'); await page.getByRole('button', { name: '新的对话', exact: true }).click();
  await page.getByRole('textbox', { name: '输入你的问题' }).fill('停止测试'); await page.getByRole('button', { name: '发送问题', exact: true }).click();
  await page.getByRole('button', { name: '停止生成', exact: true }).click();
  await expect(page.getByText('已停止生成', { exact: true })).toBeVisible();
  await request.put('/api/settings', { data: { ...settings, fakeDelay: 0 } });
  await expect(page.getByRole('button', { name: '重试', exact: true })).toHaveCount(0);
  await expect(page.locator('.workspace .message-user')).toHaveCount(1);
  const row = page.locator('.session-row.active'); await row.hover(); await row.getByTitle('重命名', { exact: true }).click();
  await page.locator('.manage-dialog input').fill('测试完成'); await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(row).toContainText('测试完成'); await row.hover(); await row.getByTitle('删除对话', { exact: true }).click();
  await page.getByRole('button', { name: '删除', exact: true }).click(); await expect(page.getByRole('heading', { name: '想从哪里开始？' })).toBeVisible();
});

test('compact document handles edit versions and delete persistently; settings have no slogans', async ({ page, request }) => {
  const settings = await (await request.get('/api/settings')).json(); await request.put('/api/settings', { data: { ...settings, fakeDelay: 0 } });
  await page.goto('/'); await page.getByRole('button', { name: '新的对话', exact: true }).click();
  await page.getByRole('textbox', { name: '输入你的问题' }).fill('文档编辑测试'); await page.getByRole('button', { name: '发送问题', exact: true }).click();
  const first = page.locator('.workspace .message-assistant .content-block').first(); await expect(first).toBeVisible();
  const slotId = await first.getAttribute('data-slot'); const block = page.locator(`[data-slot="${slotId}"]`);
  const tools = page.locator(`[data-slot-tools="${slotId}"]`);
  await block.hover();
  await block.getByRole('button', { name: '块操作', exact: true }).click();
  await expect(block.getByRole('menu', { name: '块操作菜单' })).toBeVisible();
  await block.getByRole('menuitem', { name: '编辑内容', exact: true }).click();
  await block.getByRole('textbox', { name: '编辑块内容' }).fill('这里是**手动编辑**的内容。');
  await block.getByRole('button', { name: '保存新版本' }).click();
  await expect(block).toContainText('这里是手动编辑的内容。'); await expect(block.getByRole('button', { name: '历史版本', exact: true })).toHaveCount(1);
  await changeVersion(block, '上一个版本'); await expect(block).toContainText('梯度下降');
  await changeVersion(block, '下一个版本');
  await page.reload(); await expect(block).toContainText('这里是手动编辑的内容。');
  await block.hover(); await block.getByRole('button', { name: '块操作', exact: true }).click();
  await block.getByRole('menuitem',{name:'删除块',exact:true}).hover();
  await expect(block.getByRole('menuitem', { name: '删除当前版本', exact: true })).toBeVisible();
  await expect(block.getByRole('menuitem', { name: '删除所有版本', exact: true })).toBeVisible();
  await block.getByRole('menuitem', { name: '删除当前版本', exact: true }).click();
  await expect(block).toContainText('删除当前版本？此版本的分支也将删除');
  await expect(block.getByRole('menuitem')).toHaveCount(0);
  await block.getByRole('button', { name: '取消', exact: true }).click();
  await block.getByRole('menuitem',{name:'删除块',exact:true}).hover();
  await expect(block.getByRole('menuitem', { name: '删除当前版本', exact: true })).toBeVisible();
  await block.getByRole('menuitem', { name: '删除当前版本', exact: true }).click();
  await block.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(block).toContainText('梯度下降');
  await expect(block.getByRole('button', { name: '历史版本', exact: true })).toHaveCount(0);
  await page.reload(); await expect(block).toContainText('梯度下降');
  await block.hover(); await block.getByRole('button', { name: '块操作', exact: true }).click();
  await block.getByRole('menuitem', { name: '编辑内容', exact: true }).click();
  await block.getByRole('textbox', { name: '编辑块内容' }).fill('重新编辑的版本。');
  await block.getByRole('button', { name: '保存新版本' }).click();
  await expect(block).toContainText('重新编辑的版本。');
  await block.hover(); await block.getByRole('button', { name: '块操作', exact: true }).click();
  await block.getByRole('menuitem',{name:'删除块',exact:true}).hover();
  await block.getByRole('menuitem', { name: '删除所有版本', exact: true }).click();
  await expect(block).toContainText('删除所有版本？块内的分支也将删除');
  await block.getByRole('button', { name: '确认删除', exact: true }).click(); await expect(block).toHaveCount(0);
  await page.reload(); await expect(block).toHaveCount(0);

  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible();
  await expect(page.getByText('让对话按你的方式发生。', { exact: true })).toHaveCount(0);
  await expect(page.getByText('选择模型连接方式，其他的保持简单。', { exact: true })).toHaveCount(0);
  await expect(page.getByText('从一个问题开始，顺着好奇深入', { exact: true })).toHaveCount(0);
});

test('shared side tools, linked branch previews, branch editing and message navigation', async ({ page, request }) => {
  const settings = await (await request.get('/api/settings')).json(); await request.put('/api/settings', { data: { ...settings, fakeDelay: 0 } });
  await page.goto('/'); await page.getByRole('button', { name: '新的对话', exact: true }).click();
  await page.getByRole('textbox', { name: '输入你的问题' }).fill('右侧功能测试'); await page.getByRole('button', { name: '发送问题', exact: true }).click();
  const root = page.locator('.workspace .message-assistant .content-block').first(); await expect(root).toBeVisible();
  await branch(page, root.locator('[data-node]'), '梯度下降', '这个概念如何理解？');
  const branchBlock = page.locator('.top-layer .message-assistant .content-block').first();
  const branchSlot = await branchBlock.getAttribute('data-slot');
  await branchBlock.hover(); await branchBlock.getByRole('button', { name: '块操作', exact: true }).click();
  await branchBlock.getByRole('menuitem', { name: '编辑内容', exact: true }).click();
  await branchBlock.getByRole('textbox', { name: '编辑块内容' }).fill('分支中的**新版本**，说明梯度。');
  await branchBlock.getByRole('button', { name: '保存新版本' }).click();
  const branchTools = page.locator(`.top-layer [data-slot-tools="${branchSlot}"]`);
  await expect(branchBlock.getByRole('button', { name: '历史版本', exact: true })).toHaveCount(1);
  await expect(branchTools.locator('.version-switcher')).toHaveCount(0);
  await changeVersion(branchBlock, '上一个版本'); await expect(branchBlock).toContainText('变化趋势');
  await changeVersion(branchBlock, '下一个版本'); await expect(branchBlock).toContainText('分支中的新版本');
  const nav = page.locator('.top-layer').getByRole('navigation', { name: '消息定位' });
  await expect(nav.getByRole('button')).toHaveCount(2);
  await nav.getByRole('button').first().click(); await expect(page.locator('.top-layer .message').first()).toBeFocused();
  await branch(page, branchBlock.locator('[data-node]'), '梯度', '继续子分支'); await closeBranch(page);
  await expect(branchTools.getByRole('button', { name: '预览分支：继续子分支' })).toBeVisible();
  await expect((await blockMenu(branchBlock)).getByRole('menuitem', { name: '结合追问重新回答', exact: true })).toBeEnabled();
  await page.keyboard.press('Escape');
  await closeBranch(page);
  const rootTools = page.locator(`.workspace [data-slot-tools="${await root.getAttribute('data-slot')}"]`);
  const preview = rootTools.getByRole('button', { name: '预览分支：这个概念如何理解？', exact: true });
  await expect(preview.locator('.preview-answer')).toHaveText(/分支中的新版本/);
  await preview.hover(); await expect(root.locator('mark').first()).toHaveAttribute('data-active', 'true');
  await root.locator('mark').first().hover(); await expect(preview).toHaveClass(/active/);
  await expect(root.locator('.block-actions,.version-switcher')).toHaveCount(0);
  await preview.click(); await expect(page.locator('.top-layer')).toContainText('分支中的新版本'); await closeBranch(page);
  await page.reload(); await expect(preview.locator('.preview-answer')).toHaveText(/分支中的新版本/);
  await expect(page.locator('.workspace .message-tools')).toHaveCount(2);
  await page.getByRole('textbox', { name: '输入你的问题' }).fill('第二个问题'); await page.getByRole('button', { name: '发送问题', exact: true }).click();
  await expect(page.locator('.workspace .message-assistant').nth(1).locator('.content-block').first()).toBeVisible();
  const rootNav = page.locator('.workspace').getByRole('navigation', { name: '消息定位' });
  await expect(rootNav.getByRole('button')).toHaveCount(4); await rootNav.getByRole('button').first().click();
  await expect(page.locator('.workspace .message').first()).toBeFocused();
  await expect.poll(() => page.locator('.workspace .conversation-scroll').evaluate(el => el.scrollTop)).toBeLessThan(40);
});

test('all windows share live resize, remember size after reopen and reload, and keep all corner hit targets', async ({ page, request }) => {
  const settings = await (await request.get('/api/settings')).json(); await request.put('/api/settings', { data: { ...settings, fakeDelay: 0 } });
  await page.goto('/'); await page.getByRole('button', { name: '新的对话', exact: true }).click();
  await page.getByRole('textbox', { name: '输入你的问题' }).fill('窗口缩放测试'); await page.getByRole('button', { name: '发送问题', exact: true }).click();
  const root = page.locator('.workspace .message-assistant .content-block').first(); await expect(root).toBeVisible();
  await branch(page, root.locator('[data-node]'), '梯度下降', '展开窗口');
  const dialog = page.locator('.top-layer'); await expect(dialog).toHaveClass(/entered/);
  const initial = (await dialog.boundingBox())!;
  const handle = (await dialog.getByRole('button', { name: '调整窗口大小：右下', exact: true }).boundingBox())!;
  await page.mouse.move(handle.x + 8, handle.y + 8); await page.mouse.down(); await page.mouse.move(handle.x - 42, handle.y - 22, { steps: 5 }); await page.mouse.up();
  const smaller = (await dialog.boundingBox())!;
  expect(smaller.width).toBeCloseTo(initial.width - 100, 0); expect(smaller.height).toBeCloseTo(initial.height - 60, 0);
  expect(smaller.x + smaller.width / 2).toBeCloseTo(720, 0); expect(smaller.y + smaller.height / 2).toBeCloseTo(450, 0);
  const header = (await dialog.locator('.branch-header').boundingBox())!;
  await page.mouse.move(header.x + header.width / 2, header.y + 15); await page.mouse.down(); await page.mouse.move(header.x + header.width / 2 + 70, header.y + 60); await page.mouse.up();
  expect((await dialog.boundingBox())!.x).toBeCloseTo(smaller.x, 0);
  await branch(page, dialog.locator('.message-assistant [data-node]').first(), '梯度', '嵌套窗口');
  await expect(dialog).toHaveClass(/entered/);
  await expect.poll(()=>page.locator('.branch-dialog').evaluateAll(els=>els.map(el=>(el as HTMLElement).style.width))).toEqual([`${smaller.width}px`,`${smaller.width}px`]);
  const nestedHandle=(await dialog.getByRole('button',{name:'调整窗口大小：右下',exact:true}).boundingBox())!;
  await page.mouse.move(nestedHandle.x+8,nestedHandle.y+8);await page.mouse.down();await page.mouse.move(nestedHandle.x-12,nestedHandle.y-2,{steps:3});
  await expect.poll(()=>page.locator('.branch-dialog.resizing').count()).toBe(2);
  await expect.poll(()=>page.locator('.branch-dialog').evaluateAll(els=>els.map(el=>(el as HTMLElement).style.width))).toEqual([`${smaller.width-40}px`,`${smaller.width-40}px`]);
  await page.mouse.up();
  const shared=(await dialog.boundingBox())!;
  // Invisible top-corner markers retain their resize cursor and keyboard controls.
  for(const [corner,cursor] of [['nw','nwse-resize'],['ne','nesw-resize'],['sw','nesw-resize'],['se','nwse-resize']]){
    const handle=dialog.locator(`.resize-${corner}`);await expect(handle).toHaveCSS('cursor',cursor);
    expect(await handle.evaluate(el=>getComputedStyle(el,'::after').display)).toBe(corner.startsWith('n')?'none':'block');
  }
  await dialog.getByRole('button',{name:'调整窗口大小：左上',exact:true}).focus();await page.keyboard.press('ArrowLeft');
  await expect.poll(()=>page.locator('.branch-dialog').evaluateAll(els=>els.map(el=>(el as HTMLElement).style.width))).toEqual([`${shared.width+20}px`,`${shared.width+20}px`]);
  const remembered={width:shared.width+20,height:shared.height};
  await closeBranch(page);
  await expect.poll(async () => (await dialog.boundingBox())!.width).toBeCloseTo(remembered.width, 0);
  await closeBranch(page);await root.locator('mark').first().click();await expect(dialog).toHaveClass(/entered/);
  await expect.poll(async () => (await dialog.boundingBox())!.width).toBeCloseTo(remembered.width,0);
  await page.reload();await root.locator('mark').first().click();await expect(dialog).toHaveClass(/entered/);
  await expect.poll(async () => (await dialog.boundingBox())!.width).toBeCloseTo(remembered.width,0);
  await expect.poll(async () => (await dialog.boundingBox())!.height).toBeCloseTo(remembered.height,0);
  await page.setViewportSize({ width: 800, height: 650 });
  await expect.poll(async () => (await dialog.boundingBox())!.width).toBeLessThanOrEqual(776);
  const clamped = (await dialog.boundingBox())!;
  expect(clamped.height).toBeLessThanOrEqual(510); expect(clamped.x + clamped.width / 2).toBeCloseTo(400, 0); expect(clamped.y + clamped.height / 2).toBeCloseTo(325, 0);
  await page.setViewportSize({width:1440,height:900});
  await expect.poll(async()=>(await dialog.boundingBox())!.width).toBeCloseTo(remembered.width,0);
  await expect.poll(async()=>(await dialog.boundingBox())!.height).toBeCloseTo(remembered.height,0);
  const corner = dialog.getByRole('button', { name: '调整窗口大小：右下', exact: true });
  await corner.focus(); await page.keyboard.press('ArrowLeft');
  expect((await dialog.boundingBox())!.width).toBeCloseTo(remembered.width - 20, 0);
  await closeBranch(page);await page.getByRole('button',{name:'设置',exact:true}).click();
  await page.getByRole('button',{name:/^编辑模型：/}).first().click();
  const manager=page.getByRole('dialog',{name:'配置模型',exact:true});await expect(manager).toHaveClass(/entered/);
  expect((await manager.boundingBox())!.width).toBeCloseTo(remembered.width-20,0);
  expect((await manager.boundingBox())!.height).toBeCloseTo(remembered.height,0);
});

test('streaming renders Markdown and math before completion; formulas select atomically and copy LaTeX', async ({ page, request }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  const settings = await (await request.get('/api/settings')).json(); await request.put('/api/settings', { data: { ...settings, fakeDelay: 35 } });
  await page.goto('/'); await page.getByRole('button', { name: '新的对话', exact: true }).click();
  await page.getByRole('textbox', { name: '输入你的问题' }).fill('公式测试'); await page.getByRole('button', { name: '发送问题', exact: true }).click();
  const draft = page.locator('.workspace .streaming-markdown');
  await expect(draft.locator('strong')).toHaveText('梯度下降');
  await expect(draft.locator('.katex').first()).toBeVisible(); await expect(draft).toHaveAttribute('aria-busy', 'true');
  await expect(page.getByRole('button', { name: '停止生成', exact: true })).toBeVisible();
  const atoms = page.locator('.workspace .message-assistant .selectable [data-math]'); await expect(atoms).toHaveCount(3);
  const inline = atoms.first(); await inline.click(); await expect(page.locator('.selection-trigger')).toBeVisible();
  const copy = async (formula: Locator) => formula.evaluate(el => {
    const target = el.closest('[data-node]')!; const clipboard = new DataTransfer();
    target.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: clipboard }));
    return clipboard.getData('text/plain');
  });
  expect(await copy(inline)).toBe('$f(x)=x^2$');
  // Simulate a partial native range inside KaTeX: mouseup must expand to the whole atom.
  await inline.evaluate(el => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); const text = walker.nextNode()!;
    const range = document.createRange(); range.setStart(text, 0); range.setEnd(text, 1);
    getSelection()!.removeAllRanges(); getSelection()!.addRange(range);
    el.closest('[data-node]')!.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  expect(await copy(inline)).toBe('$f(x)=x^2$');
  await page.locator('.selection-trigger').click(); await expect(page.locator('.selection-popover blockquote')).toHaveText('f(x)=x^2');
  await page.getByPlaceholder('这里有什么想进一步了解的？').fill('解释平方函数');
  await page.getByRole('button', { name: '创建分支', exact: true }).click(); await expect(page.locator('.branch-dialog')).toHaveCount(1); await closeBranch(page);
  await expect(inline).toHaveClass(/formula-anchor/);
  const display = atoms.last(); await display.click();
  const latex = await copy(display); expect(latex).toBe('$$\n\\theta_{t+1} = \\theta_t - \\eta \\nabla L(\\theta_t)\n$$');
  await page.locator('.selection-trigger').click(); await page.getByPlaceholder('这里有什么想进一步了解的？').fill('解释更新公式');
  await page.getByRole('button', { name: '创建分支', exact: true }).click(); await expect(page.locator('.branch-dialog')).toHaveCount(1); await closeBranch(page);
  await page.reload(); await expect(atoms.last()).toHaveClass(/formula-anchor/);
  await atoms.last().click(); await expect(page.locator('.top-layer .source-quote')).toContainText('theta');
  expect(errors).toEqual([]);
});

test('history lives in handle menu; left stacking persists; outside click closes just the top layer; nav preview dismisses', async ({ page, request }) => {
  const settings = await (await request.get('/api/settings')).json(); await request.put('/api/settings', { data: { ...settings, fakeDelay: 0 } });
  await page.goto('/settings'); await page.getByRole('tab',{name:'通用',exact:true}).click(); await page.getByRole('combobox', { name: '堆叠方向', exact: true }).selectOption('left');
  await expect(page.locator('.general-settings').getByRole('status')).toHaveText('已自动保存');
  expect((await (await request.get('/api/settings')).json()).stackDirection).toBe('left');
  await page.reload(); await page.getByRole('tab',{name:'通用',exact:true}).click(); await expect(page.getByRole('combobox', { name: '堆叠方向' })).toHaveValue('left');
  await page.getByRole('button', { name: '回到对话', exact: true }).click(); await page.getByRole('button', { name: '新的对话', exact: true }).click();
  await page.getByRole('textbox', { name: '输入你的问题' }).fill('方向和导航测试'); await page.getByRole('button', { name: '发送问题', exact: true }).click();
  const root = page.locator('.workspace .message-assistant .content-block').first(); await expect(root).toBeVisible();
  const nav = page.locator('.workspace .message-navigation'); await nav.getByRole('button').first().hover();
  await expect(page.getByRole('tooltip')).toContainText('方向和导航测试'); await page.getByRole('textbox', { name: '输入你的问题' }).hover(); await expect(page.getByRole('tooltip')).toHaveCount(0);
  await branch(page, root.locator('[data-node]'), '梯度下降', '一级问题'); await expect(page.locator('.top-layer')).toHaveAttribute('data-direction', 'left');
  await branch(page, page.locator('.top-layer .message-assistant [data-node]').first(), '梯度', '二级问题');
  await page.mouse.click(5, 5); await expect(page.locator('.branch-dialog')).toHaveCount(1);
  await page.mouse.click(5, 5); await expect(page.locator('.branch-dialog')).toHaveCount(0);
  const menu = await blockMenu(root); await menu.getByRole('menuitem', { name: '结合追问重新回答', exact: true }).click();
  await root.getByRole('button', { name: '采用新版', exact: true }).click();
  await root.hover(); await root.getByRole('button', { name: '历史版本', exact: true }).click();
  await expect(root.getByRole('menu')).toContainText('版本 2 / 2');
  await expect(page.locator('.message-tools .version-switcher,.message-tools .rewrite-action')).toHaveCount(0);
  await root.getByRole('button', { name: '上一个版本' }).click(); await expect(root.getByRole('menu')).toContainText('版本 1 / 2');
});

test('copy returns source Markdown for whole/partial/multiple blocks; release outside keeps toolbar and paints math selection', async ({ page, request }) => {
  const settings = await (await request.get('/api/settings')).json(); await request.put('/api/settings', { data: { ...settings, fakeDelay: 0 } });
  await page.goto('/'); await page.getByRole('button', { name: '新的对话', exact: true }).click();
  const md = '# 标题\n\n前 **加粗** 与 $x^2$ 后\n\n- 列表项';
  await page.getByRole('textbox', { name: '输入你的问题' }).fill(md); await page.getByRole('button', { name: '发送问题', exact: true }).click();
  const blocks = page.locator('.workspace .message-user [data-node]'); await expect(blocks).toHaveCount(3);
  // Selection actions require the stream to be idle, not just the user message to be rendered.
  await expect(page.getByRole('button', { name: '停止生成', exact: true })).toHaveCount(0);
  await expect(page.locator('.workspace .message-assistant .content-block').first()).toBeVisible();
  const copied = async () => page.evaluate(() => {
    const data = new DataTransfer(); document.querySelector('.app-shell')!.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: data })); return data.getData('text/plain');
  });
  await blocks.nth(1).evaluate(el => { const r = document.createRange(); r.selectNodeContents(el); getSelection()!.removeAllRanges(); getSelection()!.addRange(r); document.body.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); });
  await expect(page.getByRole('toolbar', { name: '选区操作' })).toBeVisible();
  await expect(blocks.nth(1).locator('[data-math]')).toHaveAttribute('data-selected', '');
  expect(await copied()).toBe('前 **加粗** 与 $x^2$ 后');
  await blocks.nth(1).evaluate(el => { const r = document.createRange(); r.setStart(el.querySelector('p')!.firstChild!.firstChild!, 0); r.setEnd(el.querySelector('strong')!.querySelector('span')!.firstChild!, 1); getSelection()!.removeAllRanges(); getSelection()!.addRange(r); document.body.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); });
  expect(await copied()).toBe('前 **加');
  await blocks.first().evaluate(el => { const last = el.closest('.message')!.querySelectorAll('[data-node]')[2]; const r = document.createRange(); r.setStart(el, 0); r.setEnd(last, last.childNodes.length); getSelection()!.removeAllRanges(); getSelection()!.addRange(r); });
  expect(await copied()).toBe(md);
  await blocks.nth(1).locator('[data-math]').click(); await expect(page.getByRole('toolbar').getByRole('button', { name: '复制', exact: true })).toBeVisible();
  expect(await copied()).toBe('$x^2$');
});

test('note branches save without a model response, keep separate colors and can continue asking or nest', async ({ page, request }) => {
  const settings = await (await request.get('/api/settings')).json(); await request.put('/api/settings', { data: { ...settings, fakeDelay: 0 } });
  await page.goto('/'); await page.getByRole('button', { name: '新的对话', exact: true }).click();
  await page.getByRole('textbox', { name: '输入你的问题' }).fill('笔记功能'); await page.getByRole('button', { name: '发送问题', exact: true }).click();
  const source = page.locator('.workspace .message-assistant [data-node]').first(); await expect(source).toBeVisible();
  await expect(page.locator('.workspace .message-assistant .message-avatar').first()).toHaveCSS('border-radius','50%');
  let modelCalls = 0; page.on('request', req => { if (/\/generations\/[^/]+\/events/.test(req.url())) modelCalls++; });
  await source.evaluate(el => { const r = document.createRange(); r.selectNodeContents(el.querySelector('strong')!); getSelection()!.removeAllRanges(); getSelection()!.addRange(r); document.body.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); });
  await page.getByRole('toolbar').getByRole('button', { name: '笔记', exact: true }).click();
  const editor = page.locator('.selection-popover.expanded');
  await expect(editor.getByRole('textbox', {name:'笔记内容',exact:true})).toBeFocused();
  await editor.getByRole('button',{name:'取消',exact:true}).click();
  await expect(editor).toHaveCount(0);await expect(source.locator('mark')).toHaveCount(0);
  await source.evaluate(el => { const r=document.createRange();r.selectNodeContents(el.querySelector('strong')!);getSelection()!.removeAllRanges();getSelection()!.addRange(r);document.body.dispatchEvent(new MouseEvent('mouseup',{bubbles:true})); });
  await page.getByRole('toolbar').getByRole('button',{name:'笔记',exact:true}).click();

  await expect(page.locator('.branch-dialog')).toHaveCount(0);
  await expect(editor.getByRole('button',{name:'切换模型',exact:true})).toHaveCount(0);
  await expect(editor.getByRole('button',{name:'发送问题',exact:true})).toHaveCount(0);
  await editor.getByRole('textbox',{name:'笔记内容',exact:true}).fill('**我的理解**：沿着梯度调整。');
  await page.keyboard.press('Enter');
  await expect(editor).toBeVisible(); // Notes preserve ordinary multiline editing.
  await editor.getByRole('button',{name:'保存笔记',exact:true}).click();
  await expect(editor).toHaveCount(0);await expect(page.locator('.branch-dialog')).toHaveCount(0);
  await expect(page.locator('.workspace .note-preview .preview-question')).toContainText('我的理解');
  await source.locator('mark').click();
  const note = page.locator('.top-layer');
  await expect(note.locator('.message-user .note-avatar .lucide-sticky-note')).toHaveCount(1);await expect(note.locator('.message-user .message-avatar')).toHaveText('');
  await expect(note.locator('.message-user')).toContainText('我的理解'); await expect(note.locator('.message-assistant')).toHaveCount(0); expect(modelCalls).toBe(0);
  await branch(page, note.locator('[data-node]').first(), '我的理解', '这段笔记正确吗'); await closeBranch(page);
  await note.getByRole('textbox', { name: '继续分支对话', exact: true }).fill('请帮我检查笔记'); await note.getByRole('button', { name: '发送问题', exact: true }).click();
  await expect(note.locator('.message-assistant')).toHaveCount(1); await expect(note.locator('.message-assistant [data-node]').first()).toBeVisible();
  await expect(note.locator('.message-assistant .message-avatar')).toHaveCSS('border-radius','50%');
  await expect(note.locator('.message-user').nth(1).locator('.message-avatar')).toHaveText(Array.from(new Intl.Segmenter('zh',{granularity:'grapheme'}).segment(settings.nickname || '你'))[0].segment);
  await closeBranch(page); await expect(source.locator('mark')).toHaveClass('note-anchor');
  await expect(page.locator('.workspace .note-preview .preview-question')).toContainText('我的理解');
  await page.reload(); await expect(page.locator('.workspace .note-preview')).toBeVisible(); await source.locator('mark').click();
  await expect(page.locator('.top-layer .message-user').first()).toContainText('我的理解');
  await expect(page.locator('.top-layer .message-user').first().locator('.note-avatar .lucide-sticky-note')).toHaveCount(1);
});

test('list editing creates independent blocks that survive version switches and source deletion', async ({ page, request }) => {
  const settings = await (await request.get('/api/settings')).json(); await request.put('/api/settings', { data: { ...settings, fakeDelay: 0 } });
  await page.goto('/'); await page.getByRole('button', { name: '新的对话', exact: true }).click();
  await page.getByRole('textbox', { name: '输入你的问题' }).fill('- 原列表一\n- 原列表二'); await page.getByRole('button', { name: '发送问题', exact: true }).click();
  const user = page.locator('.workspace .message-user'), root = user.locator('.content-block').first(); await expect(root).toBeVisible();
  await (await blockMenu(root)).getByRole('menuitem', { name: '编辑内容', exact: true }).click();
  await root.getByRole('textbox', { name: '编辑块内容', exact: true }).fill('- 新一\n- 新二\n\n独立段落'); await root.getByRole('button', { name: '保存新版本', exact: true }).click();
  await expect(user.locator('.content-block')).toHaveCount(4); await expect(user.locator('.list-block')).toHaveCount(3);
  await changeVersion(root, '上一个版本'); await expect(user.locator('.content-block')).toHaveCount(4); await expect(root).toContainText('原列表一');
  await changeVersion(root, '下一个版本'); await expect(user.locator('.content-block')).toHaveCount(4);
  await (await blockMenu(root)).getByRole('menuitem', { name: '在下方添加块', exact: true }).click(); await expect(root.getByRole('textbox', { name: '新块内容', exact: true })).toBeFocused();
  await root.getByRole('textbox', { name: '新块内容', exact: true }).fill('新增段落\n\n- 新增项'); await root.getByRole('button', { name: '添加块', exact: true }).click();
  await expect(user.locator('.content-block')).toHaveCount(6); await expect(user.locator('.content-block').nth(1)).toContainText('新增段落');
  await page.reload(); await expect(user.locator('.content-block')).toHaveCount(6); await expect(user.locator('.content-block').nth(2)).toContainText('新增项');
  const deleteMenu=await blockMenu(root);await deleteMenu.getByRole('menuitem',{name:'删除块',exact:true}).hover();await deleteMenu.getByRole('menuitem', { name: '删除所有版本', exact: true }).click();
  await root.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(user.locator('.content-block')).toHaveCount(5);
  await expect(user.locator('.content-block').filter({hasText:'新二'})).toHaveCount(1);
  await page.reload(); await expect(user.locator('.content-block')).toHaveCount(5);
  await expect(user.locator('.content-block').filter({hasText:'独立段落'})).toHaveCount(1);
});

test('model management adds individual models, discovers IDs, edits advanced values and keeps fake fixed', async({page,request})=>{
  await page.goto('/settings');
  const panel=page.getByRole('tabpanel');const dialog=page.getByRole('dialog',{name:'配置模型',exact:true});
  await expect(panel.getByRole('button',{name:'删除模型：模拟模式',exact:true})).toHaveCount(0);
  await panel.getByRole('button',{name:'添加模型',exact:true}).click();await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox',{name:'模型 ID',exact:true}).fill('vendor/path/model-name');
  await expect(dialog.getByRole('textbox',{name:'显示名称',exact:true})).toHaveValue('Model-Name');
  await expect(dialog.getByRole('spinbutton',{name:'上下文长度',exact:true})).toBeVisible();
  await dialog.getByRole('spinbutton',{name:'上下文长度',exact:true}).fill('64000');
  await dialog.getByRole('textbox',{name:'显示名称',exact:true}).fill('发现的模型');
  await dialog.getByRole('textbox',{name:'Base URL',exact:true}).fill('http://127.0.0.1:9999/v1');
  await dialog.getByRole('textbox',{name:'API Key',exact:true}).fill('ui-stub-secret');
  await page.route('**/api/models/discover',route=>route.fulfill({json:{models:['stub-one','stub-two']}}));
  await dialog.getByRole('button',{name:'读取模型列表',exact:true}).click();await dialog.getByRole('combobox',{name:'选择发现的模型'}).selectOption('stub-two');
  await expect(dialog.getByRole('textbox',{name:'模型 ID',exact:true})).toHaveValue('stub-two');
  await dialog.getByText('高级设置',{exact:true}).click();await dialog.getByRole('textbox',{name:'参数值 1',exact:true}).fill('0.3');
  await dialog.getByRole('button',{name:'添加参数',exact:true}).click();await dialog.getByRole('textbox',{name:'参数名 4',exact:true}).fill('top_p');await dialog.getByRole('textbox',{name:'参数值 4',exact:true}).fill('0.9');
  await dialog.getByRole('button',{name:'保存模型',exact:true}).click();await expect(panel.getByRole('button',{name:'编辑模型：发现的模型',exact:true})).toBeVisible();
  const models=await(await request.get('/api/models')).json(),saved=models.find((m:any)=>m.name==='发现的模型');expect(saved.parameters[0].value).toBe(.3);expect(saved.parameters.find((p:any)=>p.key==='context_length').value).toBe(64000);expect(JSON.stringify(saved)).not.toContain('ui-stub-secret');
  await panel.getByRole('button',{name:'编辑模型：发现的模型',exact:true}).click();await expect(dialog.getByRole('textbox',{name:'API Key',exact:true})).toHaveValue('');
  await expect(dialog.getByRole('spinbutton',{name:'上下文长度',exact:true})).toHaveValue('64000');
  await dialog.getByRole('button',{name:'清除密钥',exact:true}).click();await expect(dialog.getByRole('textbox',{name:'API Key',exact:true})).toHaveAttribute('placeholder','输入 API Key');
  await page.unroute('**/api/models/discover');await page.route('**/api/models/discover',async route=>{expect(route.request().postDataJSON().configuredModelId).toBeUndefined();await route.fulfill({json:{models:[]}});});
  await dialog.getByRole('button',{name:'读取模型列表',exact:true}).click();
  await dialog.getByRole('textbox',{name:'显示名称',exact:true}).fill('纯文本模型');await dialog.getByRole('button',{name:'保存模型',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  expect((await(await request.get('/api/models')).json()).find((m:any)=>m.id===saved.id).hasApiKey).toBe(false);
  await page.getByRole('button',{name:'回到对话',exact:true}).click();await page.getByRole('button',{name:'新的对话',exact:true}).click();
  const composer=page.locator('.workspace .unified-composer');await composer.getByRole('button',{name:'切换模型',exact:true}).click();await composer.getByRole('menuitemradio',{name:'纯文本模型',exact:true}).click();
  await expect(composer.getByRole('button',{name:'添加图片附件',exact:true})).toHaveCount(0);await expect(composer.getByRole('button',{name:'添加文本附件',exact:true})).toBeVisible();
  await composer.getByRole('button',{name:'切换模型',exact:true}).click();await composer.getByRole('menuitemradio',{name:'模拟模式',exact:true}).click();await expect(composer.getByRole('button',{name:'添加图片附件',exact:true})).toBeVisible();
  await page.reload();await expect(page.locator('.workspace .model-switch')).toHaveText('模拟模式');
  await request.delete(`/api/models/${saved.id}`);
});

test('shared composers send attachments, persist simulated reasoning and match the document body width', async({page,request})=>{await request.put('/api/models/fake',{data:{fakeDelay:30}});
  await page.goto('/');await page.getByRole('button',{name:'新的对话',exact:true}).click();
  const composer=page.locator('.workspace .unified-composer');
  const beforeFocus = await composer.evaluate(el=>getComputedStyle(el).borderColor); await composer.getByRole('textbox',{name:'输入你的问题'}).focus(); expect(await composer.evaluate(el=>getComputedStyle(el).borderColor)).toBe(beforeFocus);
  const arc = await composer.locator('.context-meter circle').last().getAttribute('stroke-dasharray'); expect(Number(arc!.split(' ')[0])).toBeLessThan(25);
  await composer.getByRole('button',{name:'上下文余量',exact:true}).hover();await expect(composer.getByRole('tooltip')).toContainText('估算剩余');
  await composer.locator('input[aria-label="图片附件"]').setInputFiles({name:'pixel.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ1sAAAAASUVORK5CYII=','base64')});
  await composer.locator('input[aria-label="文本附件"]').setInputFiles({name:'example.py',mimeType:'text/plain',buffer:Buffer.from('print("hello")')});
  await expect(composer.locator('.attachment-chip')).toHaveCount(2);await composer.getByRole('textbox',{name:'输入你的问题'}).fill('结合附件解释');await composer.getByRole('button',{name:'发送问题',exact:true}).click();
  const reasoning=page.locator('.workspace .reasoning-panel');await expect(reasoning).toContainText('模拟思考摘要');await expect(reasoning.getByLabel('思考用时')).toHaveText(/\d+秒/);await reasoning.locator('summary').click();await expect(reasoning).toContainText('固定的模拟思考摘要');
  const source=page.locator('.workspace .message-assistant [data-node]').first();await expect(source).toBeVisible();await expect(page.locator('.workspace .message-user .message-attachments a')).toHaveCount(2);
  const body=await page.locator('.workspace .message-user .message-content').boundingBox(), box=await composer.boundingBox();expect(Math.abs(body!.x-box!.x)).toBeLessThan(2);expect(Math.abs(body!.width-box!.width)).toBeLessThan(2);
  await page.reload();await expect(reasoning).toContainText('固定的模拟思考摘要');await expect(page.locator('.workspace .message-attachments img')).toHaveCount(1);
  await request.put('/api/models/fake',{data:{fakeDelay:0}});
  await selectText(page,source,'梯度下降');const floating=page.locator('.selection-popover .unified-composer');await expect(floating.getByRole('button',{name:'添加图片附件',exact:true})).toBeVisible();await expect(floating.getByRole('button',{name:'上下文余量',exact:true})).toBeVisible();
  await floating.locator('input[aria-label="文本附件"]').setInputFiles({name:'branch.md',mimeType:'text/plain',buffer:Buffer.from('分支附件')});await floating.getByRole('textbox',{name:'输入追问',exact:true}).fill('解释这部分');await floating.getByRole('button',{name:'创建分支',exact:true}).click();
  const layer=page.locator('.top-layer');await expect(layer.locator('.message-user .message-attachments')).toContainText('branch.md');await expect(layer.getByRole('button',{name:'切换模型',exact:true})).toBeVisible();
  await layer.getByRole('textbox',{name:'继续分支对话',exact:true}).fill('继续看附件');await layer.locator('.unified-composer input[aria-label="文本附件"]').setInputFiles({name:'next.txt',mimeType:'text/plain',buffer:Buffer.from('下一段')});await layer.getByRole('button',{name:'发送问题',exact:true}).click();await expect(layer.locator('.message-user')).toHaveCount(2);
});

test('homepage document import handles missing local images, persists split document and supports ordinary follow-up and branches',async({page,request})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await page.getByRole('button',{name:'新的对话',exact:true}).click();
  await expect(page.getByRole('heading',{name:'想从哪里开始？',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'导入文档',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'导入文档',exact:true});
  const doc={name:'测试讲义.md',mimeType:'text/markdown',buffer:Buffer.from('# 导入标题\n\n需要补充的先修知识。\n\n前文 ![示意图](assets/chart.png) 后文。\n\n最后一段。')};
  await dialog.getByLabel('Markdown 文件',{exact:true}).setInputFiles(doc);
  await dialog.getByRole('button',{name:'导入 Markdown',exact:true}).click();await expect(dialog.getByRole('alert')).toContainText('缺少图片资源');
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ1sAAAAASUVORK5CYII=','base64');
  const folder=await import('node:fs/promises');const os=await import('node:os');const path=await import('node:path');const temp=await folder.mkdtemp(path.join(os.tmpdir(),'zhizhi-import-'));await folder.mkdir(path.join(temp,'assets'));await folder.writeFile(path.join(temp,'测试讲义.md'),doc.buffer);await folder.writeFile(path.join(temp,'assets/chart.png'),png);await dialog.getByLabel('文档文件夹',{exact:true}).setInputFiles(temp);
  await dialog.getByRole('button',{name:'导入 Markdown',exact:true}).click();await expect(dialog).toHaveCount(0);await folder.rm(temp,{recursive:true,force:true});
  const docMessage=page.locator('.workspace .message-user').first();await expect(docMessage.locator('.message-role')).toHaveText('测试讲义.md');await expect(docMessage.locator('.message-avatar').getByRole('img', { name: '文档', exact: true })).toBeVisible();
  const image=docMessage.getByRole('img',{name:'示意图',exact:true});await expect(image).toBeVisible();await expect.poll(()=>image.evaluate(el=>(el as HTMLImageElement).naturalWidth)).toBe(1);
  await image.click();const viewer=page.getByRole('dialog',{name:'图片查看器',exact:true});await expect(viewer).toBeVisible();
  await viewer.getByRole('button',{name:'放大图片',exact:true}).click();await expect(viewer.getByLabel('图片缩放比例')).toHaveText('125%');
  await viewer.getByRole('button',{name:'缩小图片',exact:true}).click();await expect(viewer.getByLabel('图片缩放比例')).toHaveText('100%');
  await viewer.locator('.image-viewer-scroll').dispatchEvent('wheel',{deltaY:-100});await expect(viewer.getByLabel('图片缩放比例')).toHaveText('110%');
  const gestureImage=viewer.getByRole('img',{name:'示意图',exact:true});
  const initialGesture=(await gestureImage.boundingBox())!;
  await viewer.locator('.image-viewer-scroll').dispatchEvent('wheel',{deltaX:20,deltaY:12});
  await expect(viewer.getByLabel('图片缩放比例')).toHaveText('110%');
  const panned=(await gestureImage.boundingBox())!;expect(panned.x-initialGesture.x).toBeCloseTo(-20,0);expect(panned.y-initialGesture.y).toBeCloseTo(-12,0);
  await viewer.locator('.image-viewer-scroll').dispatchEvent('wheel',{deltaY:-10,ctrlKey:true});await expect(viewer.getByLabel('图片缩放比例')).toHaveText('122%');
  await viewer.locator('.image-viewer-scroll').dispatchEvent('wheel',{deltaY:10,ctrlKey:true});await expect(viewer.getByLabel('图片缩放比例')).toHaveText('110%');
  const enlarged=viewer.getByRole('img',{name:'示意图',exact:true});const before=(await enlarged.boundingBox())!;
  await page.mouse.move(before.x+before.width/2,before.y+before.height/2);await page.mouse.down();await page.mouse.move(before.x+before.width/2+60,before.y+before.height/2+40,{steps:5});
  await expect(viewer.locator('.image-viewer-scroll')).toHaveClass(/dragging/);await page.mouse.up();
  await expect(viewer).toBeVisible();await expect(viewer.locator('.image-viewer-scroll')).not.toHaveClass(/dragging/);
  const shifted=(await enlarged.boundingBox())!;expect(shifted.x-before.x).toBeCloseTo(60,0);expect(shifted.y-before.y).toBeCloseTo(40,0);
  await page.waitForTimeout(300);await viewer.locator('.image-viewer-scroll').dispatchEvent('wheel',{deltaY:100});await expect(viewer.getByLabel('图片缩放比例')).toHaveText('100%');
  await viewer.getByRole('button',{name:'重置图片缩放',exact:true}).click();await expect(viewer.getByLabel('图片缩放比例')).toHaveText('100%');
  await expect(enlarged).toHaveAttribute('style',/translate\(0px, 0px\)/);
  await page.keyboard.press('Escape');await expect(viewer).toHaveCount(0);
  await expect(docMessage.locator('.content-block')).toHaveCount(6);await expect(page.locator('.workspace .message-assistant')).toHaveCount(0);
  const sid=await page.evaluate(()=>localStorage.getItem('lastSession'));const session=(await(await request.get('/api/sessions')).json()).find((s:any)=>s.id===sid);
  const context=await(await request.get(`/api/streams/${session.root_stream_id}/context`)).json();expect(context.used).toBeGreaterThan(0);
  await page.reload();await expect(page.locator('.workspace .message-role').first()).toHaveText('测试讲义.md');await expect(page.locator('.workspace .markdown-image')).toBeVisible();
  await branch(page,page.locator('.workspace .selectable').filter({hasText:'先修知识'}).first(),'先修知识','解释这个术语');await closeBranch(page);
  await page.getByRole('textbox',{name:'输入你的问题',exact:true}).fill('继续解释最后一段');await page.getByRole('button',{name:'发送问题',exact:true}).click();await expect(page.locator('.workspace .message-assistant .content-block').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('paper import entry accepts an arXiv link and displays imported document',async({page,request})=>{
  let submitted='';
  await page.route('**/api/documents/paper',async route=>{
    submitted=route.request().postDataJSON().url;
    const result=await request.post('/api/documents/import',{data:{name:'论文标题.md',markdown:'# 论文标题\n\n论文正文。',resources:[]}});
    await route.fulfill({status:result.status(),contentType:'application/json',body:await result.text()});
  });
  await page.goto('/');await page.getByRole('button',{name:'新的对话',exact:true}).click();await page.getByRole('button',{name:'导入文档',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'导入文档',exact:true});await dialog.getByLabel('论文链接或 arXiv ID',{exact:true}).fill('https://arxiv.org/abs/1706.03762');await dialog.getByRole('button',{name:'导入论文',exact:true}).click();
  await expect(dialog).toHaveCount(0);await expect(page.locator('.workspace .message-role').first()).toHaveText('论文标题.md');expect(submitted).toBe('https://arxiv.org/abs/1706.03762');
});

test('stream completion never renders finalized blocks together with the streaming draft in main or branch', async ({page,request}) => {
  const settings=await(await request.get('/api/settings')).json();
  await request.put('/api/settings',{data:{...settings,fakeDelay:4}});
  // Keep the old finishing job alive long enough to expose a split state update.
  await page.route('**/api/sessions', async route => {
    const response=await route.fetch();
    await new Promise(resolve=>setTimeout(resolve,250));
    await route.fulfill({response});
  });
  await page.goto('/');await page.getByRole('button',{name:'新的对话',exact:true}).click();
  await page.evaluate(()=>{
    const violations:string[]=[];
    (window as any).__duplicateDrafts=violations;
    new MutationObserver(()=>{
      document.querySelectorAll('.message').forEach(message=>{
        if(message.querySelector('.content-block') && message.querySelector('.streaming-container')) violations.push(message.getAttribute('data-message') || 'unknown');
      });
    }).observe(document.body,{subtree:true,childList:true});
  });
  await page.getByRole('textbox',{name:'输入你的问题',exact:true}).fill('完成切换回归');
  await page.getByRole('button',{name:'发送问题',exact:true}).click();
  const root=page.locator('.workspace .message-assistant .content-block').first();
  await expect(root).toBeVisible();
  await expect(page.getByRole('button',{name:'停止生成',exact:true})).toHaveCount(0);
  await branch(page,root.locator('.selectable'),'梯度下降','解释这个概念');
  await expect(page.locator('.top-layer .streaming-container')).toHaveCount(0);
  expect(await page.evaluate(()=>(window as any).__duplicateDrafts)).toEqual([]);
});

test('block context menu shares block actions, explains unavailable selections and copies cross-block Markdown', async ({page,request}) => {
  const settings=await(await request.get('/api/settings')).json(); await request.put('/api/settings',{data:{...settings,fakeDelay:0}});
  await page.goto('/');await page.getByRole('button',{name:'新的对话',exact:true}).click();
  await page.evaluate(()=>{(window as any).__copied='';Object.defineProperty(navigator.clipboard,'writeText',{configurable:true,value:async(value:string)=>{(window as any).__copied=value;}});});
  await page.getByRole('textbox',{name:'输入你的问题',exact:true}).fill('**第一段**和 $x^2$。\n\n第二段文字');
  await page.getByRole('button',{name:'发送问题',exact:true}).click();await expect(page.locator('.workspace .message-assistant [data-node]').first()).toBeVisible();await expect(page.locator('.workspace .streaming-draft')).toHaveCount(0);
  const bodies=page.locator('.workspace .message-user [data-node]'), first=bodies.first();
  const open=async(target:Locator, select=true)=>{
    await target.evaluate((el,select)=>{
      if(select){const range=document.createRange();range.selectNodeContents(el);getSelection()!.removeAllRanges();getSelection()!.addRange(range);}
    },select);
    await target.click({button:'right',position:{x:15,y:8}});
  };
  const menu=page.getByRole('menu',{name:'内容右键菜单',exact:true});
  await open(first);await expect(menu).toBeVisible();await expect(menu.getByRole('separator')).toHaveCount(3);
  await expect(menu.getByRole('menuitem',{name:'追问',exact:true})).toHaveAttribute('aria-disabled','false');
  await expect(menu.getByRole('menuitem',{name:'编辑内容',exact:true})).toBeVisible();
  await menu.getByRole('menuitem',{name:'复制块',exact:true}).dispatchEvent('click');expect(await page.evaluate(()=>(window as any).__copied)).toBe('**第一段**和 $x^2$。');
  await open(first);await menu.getByRole('menuitem',{name:'笔记',exact:true}).click();
  await page.getByRole('textbox',{name:'笔记内容',exact:true}).fill('菜单笔记');await page.getByRole('button',{name:'保存笔记',exact:true}).click();
  await expect(first.locator('mark')).not.toHaveCount(0);
  await first.evaluate(el=>{const range=document.createRange();range.selectNodeContents(el);getSelection()!.removeAllRanges();getSelection()!.addRange(range);el.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,button:0}));});
  await expect(page.locator('.selection-trigger')).toHaveCount(0);
  await expect(page.getByRole('status').filter({hasText:'选区包含已有分支'})).toHaveCount(0);
  await open(first);const disabled=menu.getByRole('menuitem',{name:'追问',exact:true});await expect(disabled).toHaveAttribute('aria-disabled','true');
  // aria-disabled remains focusable/clickable solely to explain why it is unavailable.
  await disabled.evaluate(el=>(el as HTMLButtonElement).click());await expect(page.getByRole('status').filter({hasText:'选区包含已有分支'})).toBeVisible();await expect(page.locator('.branch-dialog')).toHaveCount(0);
  await page.keyboard.press('Escape');await expect(menu).toHaveCount(0);
  await bodies.evaluateAll(elements=>{const range=document.createRange();range.setStart(elements[0],0);range.setEnd(elements[1],elements[1].childNodes.length);getSelection()!.removeAllRanges();getSelection()!.addRange(range);});
  await open(bodies.nth(1),false);await expect(menu.getByRole('menuitem')).toHaveCount(1);await menu.getByRole('menuitem',{name:'复制为 Markdown',exact:true}).click();
  expect(await page.evaluate(()=>(window as any).__copied)).toBe('**第一段**和 $x^2$。\n\n第二段文字');
  await page.evaluate(()=>getSelection()?.removeAllRanges());await open(bodies.nth(1),false);await expect(menu.getByRole('menuitem',{name:'笔记',exact:true})).toHaveAttribute('aria-disabled','true');
  await menu.getByRole('menuitem',{name:'编辑内容',exact:true}).click();const editor=page.getByRole('textbox',{name:'编辑块内容',exact:true});await editor.fill('修改后的第二段');await page.getByRole('button',{name:'保存新版本',exact:true}).click();
  await open(bodies.nth(1));await expect(menu.getByRole('button',{name:'上一个版本',exact:true})).toBeVisible();await menu.getByRole('button',{name:'上一个版本',exact:true}).click();await expect(bodies.nth(1)).toContainText('第二段文字');await page.keyboard.press('Escape');
  await page.locator('.workspace .note-preview').click();const nested=page.locator('.top-layer [data-node]').first();await open(nested);await menu.getByRole('menuitem',{name:'追问',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'输入追问',exact:true})).toBeFocused();await page.getByRole('textbox',{name:'输入追问',exact:true}).fill('菜单追问');await page.getByRole('button',{name:'创建分支',exact:true}).click();await expect(page.locator('.branch-dialog')).toHaveCount(2);
});

test('highlight context menu confirms recursive branch deletion, cancellation preserves data and confirmed deletion frees the original text', async ({page,request}) => {
  const settings=await(await request.get('/api/settings')).json();await request.put('/api/settings',{data:{...settings,fakeDelay:0,confirmDeletion:true}});
  await page.goto('/');await page.getByRole('button',{name:'新的对话',exact:true}).click();
  await page.getByRole('textbox',{name:'输入你的问题',exact:true}).fill('删除分支测试');await page.getByRole('button',{name:'发送问题',exact:true}).click();
  const root=page.locator('.workspace .message-assistant [data-node]').first();await expect(root).toBeVisible();
  await branch(page,root,'梯度下降','第一层');const first=page.locator('.top-layer .message-assistant [data-node]').first();
  await branch(page,first,'梯度','第二层');await closeBranch(page);await closeBranch(page);
  const highlight=root.locator('mark').first();
  const branchId=await highlight.getAttribute('data-branch');
  await highlight.click({button:'right'});const menu=page.getByRole('menu',{name:'内容右键菜单',exact:true});
  await expect(menu.getByRole('menuitem').nth(0)).toHaveText('追问');
  await expect(menu.getByRole('menuitem').nth(1)).toHaveText('笔记');
  await expect(menu.getByRole('menuitem').nth(2)).toHaveText('删除分支');
  expect(await menu.locator(':scope > [role=separator]').first().evaluate(el => el.previousElementSibling?.textContent)).toBe('删除分支');
  await menu.getByRole('menuitem',{name:'删除分支',exact:true}).click();
  await expect(menu).toContainText('删除此分支？其子分支也将被同时删除');
  await menu.getByRole('button',{name:'取消',exact:true}).click();await expect(root.locator('mark')).not.toHaveCount(0);
  await menu.getByRole('menuitem',{name:'删除分支',exact:true}).click();await menu.getByRole('button',{name:'确认删除分支',exact:true}).click();
  await expect(menu).toHaveCount(0);await expect(root.locator('mark')).toHaveCount(0);await expect(root).toContainText('梯度下降');
  expect((await request.delete(`/api/branches/${branchId}`)).status()).toBe(404);
  await page.reload();await expect(page.locator('.workspace .message-assistant [data-node]').first().locator('mark')).toHaveCount(0);
  await branch(page,page.locator('.workspace .message-assistant [data-node]').first(),'梯度下降','删除后重新追问');
});

test('settings tabs persist nickname, reading font and send shortcut; data clear requires confirmation and resets app',async({page,request})=>{
  await page.goto('/');await expect(page.locator('.sidebar-footer').getByRole('button')).toHaveCount(1);await expect(page.locator('.sidebar-footer').getByRole('button',{name:'设置',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'切换模型',exact:true}).click();await page.getByRole('menuitem',{name:'供应商',exact:true}).click();await expect(page).toHaveURL(/\/settings$/);await expect(page.getByRole('tab',{name:'供应商',exact:true})).toHaveAttribute('aria-selected','true');await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByRole('button',{name:'添加模型',exact:true})).toBeVisible();
  await page.getByRole('tab',{name:'通用',exact:true}).click();await page.getByRole('textbox',{name:'昵称',exact:true}).fill('学习者');await page.getByRole('slider',{name:'正文文字大小',exact:true}).fill('18');await page.getByRole('combobox',{name:'发送快捷键',exact:true}).selectOption('mod-enter');await expect(page.locator('.general-settings').getByRole('status')).toHaveText('已自动保存');
  await page.reload();await page.getByRole('tab',{name:'通用',exact:true}).click();await expect(page.getByRole('textbox',{name:'昵称',exact:true})).toHaveValue('学习者');await expect(page.getByRole('slider',{name:'正文文字大小',exact:true})).toHaveValue('18');await expect(page.getByRole('combobox',{name:'发送快捷键',exact:true})).toHaveValue('mod-enter');
  await request.put('/api/settings',{data:{fakeDelay:0}});
  await page.getByRole('button',{name:'回到对话',exact:true}).click();await page.getByRole('button',{name:'新的对话',exact:true}).click();const input=page.getByRole('textbox',{name:'输入你的问题',exact:true});await input.fill('第一行');await input.press('Enter');await expect(page.locator('.workspace .message-user')).toHaveCount(0);await input.press('Control+Enter');await expect(page.locator('.workspace .message-assistant [data-node]').first()).toBeVisible();await expect(page.locator('.workspace .message-user .message-role')).toHaveText('学习者');await expect(page.locator('.local-profile')).toHaveCount(0);await expect(page.locator('.workspace .message-user .message-avatar')).toHaveText('学');await expect(page.locator('.workspace .message-assistant .markdown').first()).toHaveCSS('font-size','18px');
  const root=page.locator('.workspace .message-assistant [data-node]').first();await selectText(page,root,'梯度下降');const followup=page.getByRole('textbox',{name:'输入追问',exact:true});await followup.fill('追问第一行');await followup.press('Enter');await expect(page.locator('.branch-dialog')).toHaveCount(0);await followup.press('Meta+Enter');await expect(page.locator('.branch-dialog')).toHaveCount(1);await expect(page.locator('.top-layer .message-assistant [data-node]').first()).toBeVisible();const branchInput=page.getByRole('textbox',{name:'继续分支对话',exact:true});await branchInput.fill('继续');await branchInput.press('Enter');await expect(page.locator('.top-layer .message-user')).toHaveCount(1);await branchInput.press('Control+Enter');await expect(page.locator('.top-layer .message-user')).toHaveCount(2);for(const avatar of await page.locator('.top-layer .message-user .message-avatar').all())await expect(avatar).toHaveText('学');await closeBranch(page);
  await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('tab',{name:'数据',exact:true}).click();await expect(page.getByRole('tabpanel')).toContainText('learnhelper.sqlite');await expect(page.getByRole('tabpanel')).toContainText('占用空间');await page.getByRole('button',{name:'清除所有数据',exact:true}).click();const confirm=page.getByRole('dialog',{name:'清除所有数据',exact:true});await expect(confirm).toContainText('API Key');await confirm.getByRole('button',{name:'取消',exact:true}).click();await expect(confirm).toHaveCount(0);expect((await(await request.get('/api/sessions')).json()).length).toBeGreaterThan(0);
  await page.evaluate(()=>localStorage.setItem('dialogSize',JSON.stringify({width:800,height:600})));
  await page.getByRole('button',{name:'清除所有数据',exact:true}).click();await page.getByRole('button',{name:'确认清除所有数据',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByRole('tab',{name:'供应商',exact:true})).toHaveAttribute('aria-selected','true');expect(await(await request.get('/api/sessions')).json()).toEqual([]);expect(await page.evaluate(()=>localStorage.getItem('dialogSize'))).toBeNull();await page.getByRole('tab',{name:'通用',exact:true}).click();await expect(page.getByRole('textbox',{name:'昵称',exact:true})).toHaveValue('你');await expect(page.getByRole('combobox',{name:'发送快捷键',exact:true})).toHaveValue('enter');
});


test('deletion confirmation preference persists and bypasses branch, version and block prompts',async({page,request})=>{
  await request.put('/api/settings',{data:{confirmDeletion:true,fakeDelay:0}});
  await page.goto('/settings');await page.getByRole('tab',{name:'通用',exact:true}).click();
  const checkbox=page.getByRole('checkbox',{name:'删除二次确认',exact:true});await expect(checkbox).toBeChecked();await checkbox.uncheck();
  await expect(page.locator('.general-settings').getByRole('status')).toHaveText('已自动保存');
  await page.reload();await page.getByRole('tab',{name:'通用',exact:true}).click();await expect(checkbox).not.toBeChecked();
  await page.getByRole('button',{name:'回到对话',exact:true}).click();await page.getByRole('button',{name:'新的对话',exact:true}).click();
  await page.getByRole('textbox',{name:'输入你的问题',exact:true}).fill('免确认删除');await page.getByRole('button',{name:'发送问题',exact:true}).click();
  const body=page.locator('.workspace .message-assistant [data-node]').first();await expect(body).toBeVisible();await branch(page,body,'梯度下降','待删除分支');await closeBranch(page);
  await body.locator('mark').first().click({button:'right'});await page.getByRole('menuitem',{name:'删除分支',exact:true}).click();await expect(body.locator('mark')).toHaveCount(0);await expect(page.getByRole('button',{name:'确认删除分支',exact:true})).toHaveCount(0);
  const slot=body.locator('xpath=ancestor::*[@data-slot][1]');const id=await slot.getAttribute('data-slot');const block=page.locator(`[data-slot="${id}"]`);
  await (await blockMenu(block)).getByRole('menuitem',{name:'编辑内容',exact:true}).click();await block.getByRole('textbox',{name:'编辑块内容'}).fill('新版内容');await block.getByRole('button',{name:'保存新版本',exact:true}).click();await expect(block).toContainText('新版内容');
  const deleteMenu=await blockMenu(block);await deleteMenu.getByRole('menuitem',{name:'删除块',exact:true}).hover();await deleteMenu.getByRole('menuitem',{name:'删除当前版本',exact:true}).click();await expect(block).toContainText('梯度下降');await expect(block.getByRole('button',{name:'确认删除',exact:true})).toHaveCount(0);
  await (await blockMenu(block)).getByRole('menuitem',{name:'删除块',exact:true}).click();await expect(block).toHaveCount(0);
  await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('tab',{name:'通用',exact:true}).click();await checkbox.check();await expect(page.locator('.general-settings').getByRole('status')).toHaveText('已自动保存');
});

test('CJK punctuation bold renders, copies raw Markdown and preserves branch selection after reload',async({page,request})=>{
  await request.put('/api/settings',{data:{fakeDelay:0,sendShortcut:'enter'}});
  await page.goto('/');await page.getByRole('button',{name:'新的对话',exact:true}).click();
  const raw='**注意：**LLM... **判断：**有真实行业场景时很值得做。';
  await page.getByRole('textbox',{name:'输入你的问题',exact:true}).fill(raw);await page.getByRole('button',{name:'发送问题',exact:true}).click();
  const body=page.locator('.workspace .message-user [data-node]').first();
  await expect(body.locator('strong')).toHaveText(['注意：','判断：']);await expect(body).toHaveText('注意：LLM... 判断：有真实行业场景时很值得做。');
  await expect(page.locator('.workspace .message-assistant [data-node]').first()).toBeVisible();
  await expect(page.locator('.workspace .streaming-draft')).toHaveCount(0);
  await page.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(value:string)=>{(window as any).__copied=value;}}});});
  await body.evaluate(el=>{const r=document.createRange();r.selectNodeContents(el);getSelection()!.removeAllRanges();getSelection()!.addRange(r);});
  await body.click({button:'right'});await page.getByRole('menuitem',{name:'复制块',exact:true}).dispatchEvent('click');expect(await page.evaluate(()=>(window as any).__copied)).toBe(raw);
  await branch(page,body,'判断：','解释这个判断');await closeBranch(page);await expect(body.locator('strong mark')).toHaveText('判断：');
  await page.reload();await expect(body.locator('strong mark')).toHaveText('判断：');await body.locator('mark').click();await expect(page.locator('.top-layer .source-quote')).toContainText('判断：');
});

test('general settings autosave serializes slow edits, flushes on navigation and recovers from failures',async({page,request})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/settings');await page.getByRole('tab',{name:'通用',exact:true}).click();
  await expect(page.getByRole('button',{name:'保存设置',exact:true})).toHaveCount(0);
  let release!:()=>void;const hold=new Promise<void>(r=>{release=r;});let writes=0;
  await page.route('**/api/settings',async route=>{
    if(route.request().method()!=='PUT'){await route.continue();return;}
    writes++;const response=await route.fetch();if(writes===1)await hold;await route.fulfill({response});
  });
  const name=page.getByRole('textbox',{name:'昵称',exact:true});await name.fill('第一版');await expect.poll(()=>writes).toBe(1);
  await name.fill('最后一版');await page.getByRole('slider',{name:'正文文字大小',exact:true}).fill('17');
  await page.getByRole('tab',{name:'供应商',exact:true}).click();release();
  await expect.poll(async()=>await(await request.get('/api/settings')).json()).toMatchObject({nickname:'最后一版',fontSize:17});
  await page.unroute('**/api/settings');
  await page.getByRole('tab',{name:'通用',exact:true}).click();await expect(page.getByRole('textbox',{name:'昵称',exact:true})).toHaveValue('最后一版');
  await page.route('**/api/settings',async route=>{if(route.request().method()==='PUT')await route.fulfill({status:500,json:{error:{message:'保存失败测试'}}});else await route.continue();});
  await page.getByRole('textbox',{name:'昵称',exact:true}).fill('失败值');await expect(page.locator('.general-settings').getByRole('status')).toHaveText('保存失败测试');
  expect((await(await request.get('/api/settings')).json()).nickname).toBe('最后一版');await page.unroute('**/api/settings');
  await page.getByRole('textbox',{name:'昵称',exact:true}).fill('恢复成功');await expect(page.locator('.general-settings').getByRole('status')).toHaveText('已自动保存');
  expect((await(await request.get('/api/settings')).json()).nickname).toBe('恢复成功');expect(errors).toEqual([]);
});

test('model configuration dialogs discard drafts until explicitly saved',async({page,request})=>{
  await page.goto('/settings');const before=await(await request.get('/api/models')).json();
  await page.getByRole('button',{name:'添加模型',exact:true}).click();const modelDialog=page.getByRole('dialog',{name:'配置模型',exact:true});
  await modelDialog.getByRole('textbox',{name:'模型 ID',exact:true}).fill('vendor/manual-model');await modelDialog.getByRole('textbox',{name:'API Key',exact:true}).fill('draft-model-key');
  await modelDialog.getByRole('textbox',{name:'显示名称',exact:true}).fill('手动确认模型');await modelDialog.getByRole('textbox',{name:'显示名称',exact:true}).press('Tab');
  await page.waitForTimeout(600);expect((await(await request.get('/api/models')).json()).length).toBe(before.length);
  await modelDialog.getByRole('button',{name:'取消',exact:true}).click();await expect(modelDialog).toHaveCount(0);expect((await(await request.get('/api/models')).json()).length).toBe(before.length);
  await page.getByRole('button',{name:'添加模型',exact:true}).click();await modelDialog.getByRole('textbox',{name:'模型 ID',exact:true}).fill('vendor/manual-model');await modelDialog.getByRole('textbox',{name:'显示名称',exact:true}).fill('手动确认模型');await modelDialog.getByRole('textbox',{name:'API Key',exact:true}).fill('saved-model-key');await modelDialog.getByRole('button',{name:'保存模型',exact:true}).click();await expect(modelDialog).toHaveCount(0);
  const saved=(await(await request.get('/api/models')).json()).find((m:any)=>m.name==='手动确认模型');expect(saved.hasApiKey).toBe(true);
  await page.getByRole('button',{name:'编辑模型：手动确认模型',exact:true}).click();await modelDialog.getByRole('textbox',{name:'显示名称',exact:true}).fill('不会保存的名称');await modelDialog.getByRole('button',{name:'清除密钥',exact:true}).click();await page.keyboard.press('Escape');await expect(modelDialog).toHaveCount(0);
  expect((await(await request.get('/api/models')).json()).find((m:any)=>m.id===saved.id)).toMatchObject({name:'手动确认模型',hasApiKey:true});
  await page.getByRole('button',{name:'复制模型：手动确认模型',exact:true}).click();await modelDialog.getByRole('button',{name:'取消',exact:true}).click();await expect(modelDialog).toHaveCount(0);expect((await(await request.get('/api/models')).json()).length).toBe(before.length+1);
  await request.delete(`/api/models/${saved.id}`);
});


test('supplier and shared composers have no web search configuration or requests', async ({page,request}) => {
  const searchRequests:string[]=[];
  page.on('request',req=>{if(req.url().includes('/api/search/'))searchRequests.push(req.url());});
  await page.goto('/settings');
  await expect(page.getByRole('button',{name:'配置联网搜索',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'添加模型',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'配置模型',exact:true});
  await expect(dialog.getByText('支持联网',{exact:true})).toHaveCount(0);
  await dialog.getByRole('button',{name:'取消',exact:true}).click();
  expect((await request.get('/api/search/settings')).status()).toBe(404);
  await page.getByRole('button',{name:'回到对话',exact:true}).click();
  await page.getByRole('button',{name:'新的对话',exact:true}).click();
  const composer=page.locator('.workspace .unified-composer');
  await expect(composer.getByRole('button',{name:'联网搜索',exact:true})).toHaveCount(0);
  await composer.getByRole('button',{name:'切换模型',exact:true}).click();
  await composer.getByRole('menuitemradio',{name:'模拟模式',exact:true}).click();
  await page.route('**/api/streams/*/messages',async route=>{
    expect(route.request().postDataJSON()).not.toHaveProperty('webSearch');
    await route.continue();
  });
  await composer.getByRole('textbox').fill('普通回答回归');
  await composer.getByRole('button',{name:'发送问题',exact:true}).click();
  await expect(page.locator('.workspace .message-assistant [data-node]').first()).toBeVisible();
  expect(searchRequests).toEqual([]);
});

test('appearance autosaves, persists and follows system only when selected',async({page,request})=>{
  await request.put('/api/settings',{data:{theme:'system'}});
  await page.emulateMedia({colorScheme:'light'});
  await page.goto('/settings');await page.getByRole('tab',{name:'通用',exact:true}).click();
  const appearance=page.getByRole('combobox',{name:'外观',exact:true});
  await expect(appearance).toHaveValue('system');
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  await page.emulateMedia({colorScheme:'dark'});
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await appearance.selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  await expect.poll(async()=>(await(await request.get('/api/settings')).json()).theme).toBe('light');
  await page.reload();await page.getByRole('tab',{name:'通用',exact:true}).click();
  await expect(appearance).toHaveValue('light');await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  await appearance.selectOption('dark');await page.emulateMedia({colorScheme:'light'});
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await page.getByRole('tab',{name:'供应商',exact:true}).click();
  await page.getByRole('button',{name:'添加模型',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'配置模型',exact:true});
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgb(32, 32, 32)');
  await dialog.getByRole('button',{name:'取消',exact:true}).click();
  await page.getByRole('tab',{name:'通用',exact:true}).click();await appearance.selectOption('system');
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  await page.emulateMedia({colorScheme:'dark'});await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await expect.poll(async()=>(await(await request.get('/api/settings')).json()).theme).toBe('system');
  expect((await request.put('/api/settings',{data:{theme:'invalid'}})).status()).toBe(400);
});

test('HTML paper tables and superscripts render, copy source and preserve branch anchors', async ({page,request}) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await request.put('/api/settings',{data:{fakeDelay:0,sendShortcut:'enter'}});
  await page.goto('/'); await page.getByRole('button',{name:'新的对话',exact:true}).click();
  const raw='<table><thead><tr><th colspan="2">Method</th></tr></thead><tbody><tr><td>T2T</td><td>0.83</td></tr></tbody></table>\n\nShiqi He<sup>∗</sup>，H<sub>2</sub>O';
  await page.getByRole('textbox',{name:'输入你的问题',exact:true}).fill(raw); await page.getByRole('button',{name:'发送问题',exact:true}).click();
  const blocks=page.locator('.workspace .message-user [data-node]');
  await expect(blocks).toHaveCount(2); await expect(blocks.first().locator('td')).toHaveText(['T2T','0.83']);
  await expect(blocks.first().locator('th')).toHaveAttribute('colspan','2'); await expect(blocks.nth(1).locator('sup')).toHaveText('∗');
  await expect(blocks.nth(1).locator('sub')).toHaveText('2');
  await expect(page.locator('.workspace .message-assistant [data-node]').first()).toBeVisible();
  await expect(page.locator('.workspace .streaming-draft')).toHaveCount(0);
  await page.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(value:string)=>{(window as any).__copied=value;}}});});
  await blocks.first().evaluate(el=>{const r=document.createRange();r.selectNodeContents(el);getSelection()!.removeAllRanges();getSelection()!.addRange(r);});
  await blocks.first().click({button:'right'}); await page.getByRole('menuitem',{name:'复制块',exact:true}).dispatchEvent('click');
  expect(await page.evaluate(()=>(window as any).__copied)).toBe(raw.split('\n\n')[0]);
  await branch(page,blocks.nth(1),'∗','这个作者标记是什么意思？'); await closeBranch(page);
  await expect(blocks.nth(1).locator('sup mark')).toHaveText('∗'); await page.reload();
  await expect(blocks.nth(1).locator('sup mark')).toHaveText('∗'); await blocks.nth(1).locator('sup mark').click();
  await expect(page.locator('.top-layer .source-quote')).toContainText('∗'); expect(errors).toEqual([]);
});

test('unified import uses native folder images, offers conversion and matches assistant paragraph spacing',async({page,request})=>{
  await request.put('/api/settings',{data:{fakeDelay:0,sendShortcut:'enter'}});
  await page.route('**/api/documents/picker',async route=>{
    await route.fulfill({json:route.request().method()==='GET'?{available:true}:{name:'native.md',markdown:'第一段。\n\n第二段。\n\n![图](assets/chart.png)',resources:[{path:'assets/chart.png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ1sAAAAASUVORK5CYII='}]}});
  });
  await page.goto('/');await page.getByRole('button',{name:'新的对话',exact:true}).click();await page.getByRole('button',{name:'导入文档',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'导入文档',exact:true});
  await expect(dialog.getByRole('link',{name:'前往转换'})).toHaveAttribute('href','https://www.inktomd.com/');
  await expect(dialog.getByRole('button',{name:'选择文件夹',exact:true})).toHaveCount(0);
  await dialog.getByRole('button',{name:'选择 Markdown 文件',exact:true}).click();await expect(dialog).toContainText('native.md');
  await dialog.getByRole('button',{name:'导入 Markdown',exact:true}).click();await expect(dialog).toHaveCount(0);
  await expect(page.locator('.workspace .markdown-image')).toBeVisible();
  await page.getByRole('textbox',{name:'输入你的问题',exact:true}).fill('继续解释');await page.getByRole('button',{name:'发送问题',exact:true}).click();
  const assistant=page.locator('.workspace .message-assistant [data-node].markdown p').first();await expect(assistant).toBeVisible();
  const imported=page.locator('.workspace .message-user .markdown p').first();
  expect(await imported.evaluate(el=>getComputedStyle(el).marginBottom)).toBe(await assistant.evaluate(el=>getComputedStyle(el).marginBottom));
});

test('generation auto-scroll persists and manual wheel cancels following for the entire current generation',async({page,request})=>{
  await request.put('/api/settings',{data:{autoScroll:true,fakeDelay:15,sendShortcut:'enter'}});
  await page.goto('/');await page.getByRole('button',{name:'新的对话',exact:true}).click();
  await page.getByRole('textbox',{name:'输入你的问题',exact:true}).fill(Array.from({length:45},(_,i)=>`第${i}段用于滚动测试。`).join('\n\n'));
  await page.getByRole('button',{name:'发送问题',exact:true}).click();await expect(page.locator('.workspace .streaming-draft')).toBeVisible();
  const scroll=page.locator('.workspace .conversation-scroll');
  await expect.poll(()=>scroll.evaluate(el=>el.scrollHeight-el.scrollTop-el.clientHeight)).toBeLessThan(110);
  await scroll.dispatchEvent('wheel',{deltaY:-300});await scroll.evaluate(el=>{el.scrollTop-=300;});
  await page.waitForTimeout(150);const top=await scroll.evaluate(el=>el.scrollTop);
  await page.waitForTimeout(300);expect(await scroll.evaluate(el=>el.scrollTop)).toBeCloseTo(top,0);
  // Returning to the bottom must not re-enable following in this generation.
  await scroll.evaluate(el=>{el.scrollTop=el.scrollHeight;});await page.waitForTimeout(100);const after=await scroll.evaluate(el=>el.scrollTop);
  await expect(page.locator('.workspace .streaming-draft')).toHaveCount(0,{timeout:30000});expect(await scroll.evaluate(el=>el.scrollTop)).toBeCloseTo(after,0);
  await scroll.evaluate(el=>{el.scrollTop=0;});
  await page.getByRole('textbox',{name:'输入你的问题',exact:true}).fill('下一轮恢复自动跟随');await page.getByRole('button',{name:'发送问题',exact:true}).click();
  await expect(page.locator('.workspace .streaming-draft')).toBeVisible();await expect.poll(()=>scroll.evaluate(el=>el.scrollHeight-el.scrollTop-el.clientHeight)).toBeLessThan(110);
  await expect(page.locator('.workspace .streaming-draft')).toHaveCount(0);
  await page.goto('/settings');await page.getByRole('tab',{name:'通用',exact:true}).click();
  const toggle=page.getByRole('checkbox',{name:'生成时自动滚动',exact:true});await toggle.uncheck();
  await expect.poll(async()=> (await(await request.get('/api/settings')).json()).autoScroll).toBe(false);
  await page.reload();await page.getByRole('tab',{name:'通用',exact:true}).click();await expect(toggle).not.toBeChecked();
  await request.put('/api/settings',{data:{autoScroll:true,fakeDelay:0}});
});

test('context menu groups block and message actions, copies current message and confirms message deletion',async({page,request})=>{
  await request.put('/api/settings',{data:{fakeDelay:0,confirmDeletion:true,fontSize:15}});
  await page.goto('/');await page.getByRole('button',{name:'新的对话',exact:true}).click();
  const raw='第一块。\n\n第二块。';await page.getByRole('textbox',{name:'输入你的问题',exact:true}).fill(raw);await page.getByRole('button',{name:'发送问题',exact:true}).click();
  await expect(page.locator('.workspace .message-assistant [data-node]').first()).toBeVisible();await expect(page.locator('.workspace .streaming-draft')).toHaveCount(0);
  const user=page.locator('.workspace .message-user').first(),block=user.locator('.content-block').first();
  expect(await block.locator('[data-node]').evaluate(el=>getComputedStyle(el).fontSize)).toBe('15px');
  expect(await page.getByRole('button',{name:'新的对话',exact:true}).evaluate(el=>getComputedStyle(el).fontSize)).toBe('12px');
  await page.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(value:string)=>{(window as any).__copied=value;}}});});
  await block.locator('[data-node]').click({button:'right'});const menu=page.getByRole('menu',{name:'内容右键菜单',exact:true});await expect(menu.getByRole('separator')).toHaveCount(3);
  const groups=await menu.evaluate(el=>{const groups:string[][]=[[]];for(const child of el.children){if(child.getAttribute('role')==='separator')groups.push([]);else groups.at(-1)!.push(child.textContent || '');}return groups;});
  expect(groups[0]).toEqual(['追问','笔记']);expect(groups[1]).toContain('编辑内容');expect(groups[2]).toEqual(['复制块','复制整条消息']);expect(groups[3]).toEqual(['删除块','删除整条消息']);
  await menu.getByRole('menuitem',{name:'复制整条消息',exact:true}).click();expect(await page.evaluate(()=>(window as any).__copied)).toBe(raw);
  await block.locator('[data-node]').click({button:'right'});await menu.getByRole('menuitem',{name:'删除整条消息',exact:true}).click();await expect(menu).toContainText('删除整条消息？消息内的分支也将删除');
  await menu.getByRole('button',{name:'取消',exact:true}).click();await expect(user).toBeVisible();
  await menu.getByRole('menuitem',{name:'删除整条消息',exact:true}).click();await menu.getByRole('button',{name:'确认删除消息',exact:true}).click();await expect(page.locator('.workspace .message-user')).toHaveCount(0);
  await expect(page.locator('.workspace .message-assistant')).toHaveCount(1);await page.reload();await expect(page.locator('.workspace .message-user')).toHaveCount(0);
});

test('block deletion submenu offers current/all versions with icons',async({page,request})=>{
  await request.put('/api/settings',{data:{fakeDelay:0,confirmDeletion:true}});await page.goto('/');await page.getByRole('button',{name:'新的对话',exact:true}).click();
  await page.getByRole('textbox',{name:'输入你的问题',exact:true}).fill('原内容');await page.getByRole('button',{name:'发送问题',exact:true}).click();await expect(page.locator('.workspace .message-assistant [data-node]').first()).toBeVisible();await expect(page.locator('.workspace .streaming-draft')).toHaveCount(0);
  const block=page.locator('.workspace .message-user .content-block').first();await(await blockMenu(block)).getByRole('menuitem',{name:'编辑内容',exact:true}).click();await block.getByRole('textbox',{name:'编辑块内容'}).fill('新内容');await block.getByRole('button',{name:'保存新版本'}).click();
  const menu=await blockMenu(block);await menu.getByRole('menuitem',{name:'删除块',exact:true}).focus();await page.keyboard.press('ArrowRight');const sub=menu.getByRole('menu',{name:'删除块版本',exact:true});await expect(sub).toBeVisible();
  await expect(sub.getByRole('menuitem')).toHaveCount(2);
  await expect(sub.getByRole('menuitem',{name:'删除当前版本',exact:true}).locator('svg')).toHaveCount(1);
  await expect(sub.getByRole('menuitem',{name:'删除所有版本',exact:true}).locator('svg')).toHaveCount(1);
  await sub.getByRole('menuitem',{name:'删除当前版本',exact:true}).click();await expect(menu).toContainText('删除当前版本？此版本的分支也将删除');await menu.getByRole('button',{name:'确认删除',exact:true}).click();await expect(block.locator('[data-node]')).toHaveText('原内容');await expect(block.getByRole('button',{name:'历史版本',exact:true})).toHaveCount(0);
});

test('paste/drop attachments and reedit latest answer restore question ahead of existing draft', async ({ page, request }) => {
  await request.put('/api/settings', { data: { fakeDelay: 0, confirmDeletion: true } });
  await page.goto('/'); await page.getByRole('button', { name: '新的对话', exact: true }).click();
  const input = page.getByRole('textbox', { name: '输入你的问题', exact: true });
  await input.fill('原来的问题');
  await input.evaluate(el => {
    const data = new DataTransfer(); data.items.add(new File(['粘贴的文档'], 'pasted.md', { type: 'text/markdown' }));
    el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
  });
  await expect(page.locator('.attachment-chip')).toContainText('pasted.md');
  await input.evaluate(el => {
    const data = new DataTransfer();
    const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+nmT8AAAAASUVORK5CYII='), c => c.charCodeAt(0));
    data.items.add(new File([bytes], 'dropped.png', { type: 'image/png' }));
    el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }));
  });
  await expect(page.locator('.attachment-chip')).toHaveCount(2);
  await page.getByRole('button', { name: '发送问题', exact: true }).click();
  await expect(page.locator('.workspace .message-assistant .content-block').first()).toBeVisible();
  await input.fill('现有草稿');
  await page.locator('.workspace .message-assistant .content-block').first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: '删除整条消息并重新提问', exact: true }).click();
  await expect(page.getByText('删除本轮问答？相关分支也将删除，原问题将恢复到输入框', { exact: true })).toBeVisible();
  await page.locator('.reedit-confirm').getByRole('button', { name: '确认', exact: true }).click();
  await expect(input).toHaveValue('原来的问题\n\n现有草稿');
  await expect(page.locator('.attachment-chip')).toHaveCount(2);
  await expect(page.locator('.workspace .message')).toHaveCount(0);
  // Ensure the restored attachments really survive deletion and can be sent again.
  await page.getByRole('button', { name: '发送问题', exact: true }).click();
  await expect(page.locator('.workspace .message-assistant .content-block').first()).toBeVisible();
  await expect(page.locator('.workspace .message-user .message-attachments a')).toHaveCount(2);
});

test('empty failed answer is removed and toast restores question', async ({ page, request }) => {
  await request.put('/api/settings', { data: { confirmDeletion: false } });
  const response = await request.post('/api/models', { data: { name: 'local-error-stub', baseUrl: 'http://127.0.0.1:1/v1', model: 'stub', supportsImages: false, parameters: [], apiKey: 'not-a-real-key' } });
  expect(response.ok()).toBe(true); const model = await response.json();
  try {
    await page.goto('/');
    await page.evaluate(id => localStorage.setItem('lastModelId', id), model.id);
    await page.reload(); await page.getByRole('button', { name: '新的对话', exact: true }).click();
    const input = page.getByRole('textbox', { name: '输入你的问题', exact: true });
    await input.fill('失败的问题'); await page.getByRole('button', { name: '发送问题', exact: true }).click();
    await expect(page.locator('.workspace .message-assistant')).toHaveCount(0);
    const button = page.getByRole('status').getByRole('button', { name: '重新编辑', exact: true });
    await expect(button).toBeEnabled(); await button.click();
    await expect(input).toHaveValue('失败的问题');
    await expect(page.locator('.workspace .message')).toHaveCount(0);
  } finally { await request.delete(`/api/models/${model.id}`); }
});

test('rewrite preview and adoption split paragraphs into independent blocks', async ({ page, request }) => {
  await request.put('/api/settings', { data: { fakeDelay: 0 } });
  await page.goto('/'); await page.getByRole('button', { name: '新的对话', exact: true }).click();
  await page.getByRole('textbox', { name: '输入你的问题', exact: true }).fill('重构拆块测试');
  await page.getByRole('button', { name: '发送问题', exact: true }).click();
  const root = page.locator('.workspace .message-assistant .message-content > .content-block').first();
  await expect(root).toBeVisible();
  await branch(page, root.locator('[data-node]'), '梯度下降', '解释一下'); await closeBranch(page);
  const blocks = page.locator('.workspace .message-assistant .message-content > .content-block');
  const originalCount = await blocks.count();
  await (await blockMenu(root)).getByRole('menuitem', { name: '结合追问重新回答', exact: true }).click();
  await expect(root.locator('.rewrite-blocks > .markdown-blocks > .content-block')).toHaveCount(3);
  await root.getByRole('button', { name: '采用新版', exact: true }).click();
  await expect(blocks).toHaveCount(originalCount + 2);
  await expect(root.locator('[data-node]')).not.toContainText('例如，');
  await expect(blocks.nth(1).locator('[data-node]')).toContainText('例如，');
  const extraId = await blocks.nth(1).getAttribute('data-slot');
  await changeVersion(root, '上一个版本');
  expect(await blocks.nth(1).getAttribute('data-slot')).toBe(extraId);
  await expect(blocks.nth(1).locator('[data-node]')).toContainText('例如，');
});

test('rewrite streaming and completed paragraph styles match main conversation inside a list source', async ({ page, request }) => {
  await request.put('/api/settings', { data: { fakeDelay: 0 } });
  await page.goto('/'); await page.getByRole('button', { name: '新的对话', exact: true }).click();
  await page.getByRole('textbox', { name: '输入你的问题', exact: true }).fill('- 原来的列表项');
  await page.getByRole('button', { name: '发送问题', exact: true }).click();
  const source = page.locator('.workspace .message-user .message-content > .content-block').first();
  await expect(page.locator('.workspace .message-assistant [data-node]').first()).toBeVisible();
  await branch(page, source.locator('[data-node]'), '原来的列表项', '解释一下'); await closeBranch(page);
  const metrics = async (locator: Locator) => locator.evaluate(el => {
    const css = getComputedStyle(el); return { marginTop: css.marginTop, marginBottom: css.marginBottom, fontSize: css.fontSize, lineHeight: css.lineHeight };
  });
  const normal = await metrics(page.locator('.workspace .message-assistant .message-content > .content-block:not(.list-block) > .markdown p').first());
  const list = await metrics(page.locator('.workspace .message-assistant .message-content > .list-block > .markdown p').first());
  await request.put('/api/settings', { data: { fakeDelay: 40 } });
  await (await blockMenu(source)).getByRole('menuitem', { name: '结合追问重新回答', exact: true }).click();
  const stream = source.locator('.rewrite-preview .streaming-markdown');
  await expect(stream.locator('.markdown-blocks > .content-block:not(.list-block) > .markdown p').first()).toBeVisible();
  expect(await metrics(stream.locator('.markdown-blocks > .content-block:not(.list-block) > .markdown p').first())).toEqual(normal);
  expect(await metrics(stream.locator('.markdown-blocks > .list-block > .markdown p').first())).toEqual(list);
  await expect(source.locator('.rewrite-blocks .markdown-blocks > .content-block')).toHaveCount(3);
  expect(await metrics(source.locator('.rewrite-blocks .content-block:not(.list-block) > .markdown p').first())).toEqual(normal);
  expect(await metrics(source.locator('.rewrite-blocks .list-block > .markdown p').first())).toEqual(list);
  await request.put('/api/settings', { data: { fakeDelay: 0 } });
});

test('sidebar folders drag sessions, preserve recent dates and release chats on deletion', async ({ page, request }) => {
  await request.put('/api/settings', { data: { confirmDeletion: true } });
  const suffix = Date.now();
  const a = await (await request.post('/api/folders', { data: { name: `文件夹A${suffix}` } })).json();
  const b = await (await request.post('/api/folders', { data: { name: `文件夹B${suffix}` } })).json();
  const child = await (await request.post('/api/folders', { data: { name: `子文件夹${suffix}`, parentId: a.id } })).json();
  const first = await (await request.post('/api/sessions', { data: { title: `拖动会话${suffix}` } })).json();
  const second = await (await request.post('/api/sessions', { data: { title: `另一会话${suffix}` } })).json();
  try {
    await page.goto('/');
    const folder = (name: string) => page.locator('.folder-row').filter({ has: page.getByRole('button', { name, exact: true }) });
    const aRow = folder(a.name), bRow = folder(b.name);
    const transfer = await page.evaluateHandle(() => new DataTransfer());
    const dragSource = page.locator('.session-row').filter({ has: page.getByRole('button', { name: first.title, exact: true }) });
    await dragSource.dispatchEvent('dragstart', { dataTransfer: transfer });
    await aRow.dispatchEvent('dragover', { dataTransfer: transfer, clientX: 80, clientY: 150 });
    await expect(page.getByRole('tooltip')).toContainText(`移入「${a.name}」末尾`);
    await expect(aRow).toHaveClass(/drop-inside/);
    await page.locator('.recent-section').dispatchEvent('dragover', { dataTransfer: transfer, clientX: 80, clientY: 300 });
    await expect(page.getByRole('tooltip')).toContainText('按日期排序');
    await dragSource.dispatchEvent('dragend', { dataTransfer: transfer });
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await aRow.dispatchEvent('dragstart', { dataTransfer: transfer });
    await aRow.dispatchEvent('dragover', { dataTransfer: transfer, clientX: 80, clientY: 150 });
    await expect(page.getByRole('tooltip')).toContainText('不能移动到自身');
    await expect(aRow).not.toHaveClass(/drop-inside/);
    await aRow.dispatchEvent('dragend', { dataTransfer: transfer });

    const row = (name: string) => page.locator('.session-row').filter({ has: page.getByRole('button', { name, exact: true }) });
    await row(first.title).dragTo(aRow); await aRow.getByRole('button', { name: a.name, exact: true }).click();
    // Dragging into a folder expands it automatically; ensure children are visible.
    if (!await folder(child.name).isVisible()) await aRow.getByRole('button', { name: a.name, exact: true }).click();
    await expect(row(first.title)).toBeVisible();
    await row(second.title).dragTo(aRow);
    await row(second.title).dragTo(row(first.title));
    const members = await (await request.get('/api/sessions')).json();
    expect(members.find((s: {id:string}) => s.id === second.id).position).toBeLessThan(members.find((s: {id:string}) => s.id === first.id).position);
    await row(first.title).dragTo(folder(child.name));
    await expect.poll(async () => (await (await request.get('/api/sessions')).json()).find((s: {id:string}) => s.id === first.id).folder_id).toBe(child.id);
    await row(second.title).dragTo(bRow);
    await row(second.title).dragTo(page.locator('.recent-section .sidebar-label'));
    await expect(page.locator('.recent-section').getByRole('button', { name: second.title, exact: true })).toBeVisible();
    await aRow.hover(); await aRow.getByTitle('删除文件夹', { exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '删除文件夹', exact: true });
    await expect(dialog).toContainText('不会删除聊天内容');
    await dialog.getByRole('button', { name: '删除', exact: true }).click();
    await expect(page.locator('.recent-section').getByRole('button', { name: first.title, exact: true })).toBeVisible();
    const dates = await (await request.get('/api/sessions')).json();
    expect(dates.find((s: {id:string}) => s.id === first.id).updated_at).toBe(first.updated_at);
  } finally {
    await request.delete(`/api/folders/${a.id}`); await request.delete(`/api/folders/${b.id}`);
    await request.delete(`/api/sessions/${first.id}`); await request.delete(`/api/sessions/${second.id}`);
  }
});

test('manual stop removes empty answer and toast restores attachments; blur setting persists', async ({ page, request }) => {
  await request.put('/api/settings', { data: { fakeDelay: 150, blurBackdrop: false } });
  await page.goto('/'); await page.evaluate(() => localStorage.setItem('lastModelId', 'fake')); await page.reload();
  await page.getByRole('button', { name: '新的对话', exact: true }).click();
  const input = page.getByRole('textbox', { name: '输入你的问题', exact: true });
  await input.fill('停止并恢复附件');
  await input.dispatchEvent('drop', { dataTransfer: await page.evaluateHandle(() => { const dt = new DataTransfer(); dt.items.add(new File(['original text'], 'stop.txt', { type: 'text/plain' })); return dt; }) });
  await expect(page.locator('.attachment-chip')).toContainText('stop.txt');
  await page.getByRole('button', { name: '发送问题', exact: true }).click();
  await page.getByRole('button', { name: '停止生成', exact: true }).click();
  const toast = page.getByRole('status');
  await expect(toast).toContainText('生成已停止');
  await expect(page.locator('.workspace .message-assistant')).toHaveCount(0);
  await toast.getByRole('button', { name: '重新编辑', exact: true }).click();
  await expect(input).toHaveValue('停止并恢复附件');
  await expect(page.locator('.attachment-chip')).toContainText('stop.txt');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('tab', { name: '通用', exact: true }).click();
  const blur = page.getByRole('checkbox', { name: '窗口背景模糊', exact: true });
  await expect(blur).not.toBeChecked(); await blur.check();
  await expect.poll(async () => (await (await request.get('/api/settings')).json()).blurBackdrop).toBe(true);
  await page.getByRole('tab', { name: '供应商', exact: true }).click();
  await page.getByRole('button', { name: '编辑模型：模拟模式', exact: true }).click();
  const backdrop = page.locator('.model-management-backdrop');
  expect(await backdrop.evaluate(el => getComputedStyle(el).backdropFilter)).toBe('blur(3px)');
  const corner = page.getByRole('button', { name: '调整管理窗口：se', exact: true });
  await corner.focus();
  for (let i = 0; i < 40; i++) await corner.press('ArrowUp');
  expect(await page.getByRole('dialog', { name: '配置模型', exact: true }).evaluate(el => getComputedStyle(el).height)).toBe('220px');
  await request.put('/api/settings', { data: { fakeDelay: 0, blurBackdrop: false } });
});

test('stop before event subscription still restores the exact original question', async ({ page, request }) => {
  await request.put('/api/settings', { data: { fakeDelay: 150 } });
  await page.goto('/'); await page.evaluate(() => localStorage.setItem('lastModelId', 'fake')); await page.reload();
  await page.getByRole('button', { name: '新的对话', exact: true }).click();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(/\/api\/streams\/[^/]+$/, async route => { await gate; await route.continue(); });
  try {
    const input = page.getByRole('textbox', { name: '输入你的问题', exact: true });
    await input.fill('立刻停止时仍应恢复这个问题');
    await page.getByRole('button', { name: '发送问题', exact: true }).click();
    const cancelled = page.waitForResponse(response => /\/api\/generations\/[^/]+\/cancel$/.test(response.url()) && response.request().method() === 'POST');
    await page.getByRole('button', { name: '停止生成', exact: true }).click();
    expect((await cancelled).ok()).toBe(true); release();
    const toast = page.getByRole('status'); await expect(toast).toContainText('生成已停止');
    await toast.getByRole('button', { name: '重新编辑', exact: true }).click();
    await expect(input).toHaveValue('立刻停止时仍应恢复这个问题');
    await expect(page.locator('.workspace .message')).toHaveCount(0);
  } finally { release(); await request.put('/api/settings', { data: { fakeDelay: 0 } }); }
});

test('about update controls and logo navigation follow release builds and notification preference', async ({ page, request }) => {
  await request.put('/api/settings', { data: { updateNotifications: true } });
  const update = { currentVersion: 'v0.1.0', available: true, checkedAt: Date.now(), release: { tag: 'v0.2.0', name: '新版本', notes: '修复与改进', publishedAt: '2026-11-04T00:00:00Z', url: 'https://github.com/wwtwwwt/zhizhi/releases/tag/v0.2.0' } };
  let checks = 0;
  await page.route('**/api/updates', route => route.fulfill({ json: update }));
  await page.route('**/api/updates/check', route => { checks++; return route.fulfill({ json: update }); });
  await page.goto('/settings?tab=about');
  const check = page.getByRole('button', { name: '检查更新', exact: true });
  await expect(page.getByRole('tab', { name: '关于', exact: true })).toHaveAttribute('aria-selected', 'true');
  const development = await page.getByText('开发版本', { exact: true }).count();
  if (development) {
    await expect(check).toBeDisabled(); expect(checks).toBe(0);
    await expect(page.getByText('开发版本不检查更新', { exact: true })).toBeVisible();
    return;
  }
  await expect.poll(() => checks).toBe(1);
  const upgrade = page.getByRole('button', { name: '查看新版本', exact: true });
  await expect(upgrade).toBeVisible();
  await page.getByRole('tab', { name: '通用', exact: true }).click(); await upgrade.click();
  await expect(page.getByRole('tab', { name: '关于', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('link', { name: '前往 GitHub Release 下载 ↗', exact: true })).toHaveAttribute('href', update.release.url);
  await check.click(); await expect.poll(() => checks).toBe(2);
  const enabled = page.getByRole('checkbox', { name: '新版本提醒', exact: true }); await enabled.uncheck();
  await expect(upgrade).toHaveCount(0);
  await expect.poll(async () => (await (await request.get('/api/settings')).json()).updateNotifications).toBe(false);
  await page.reload(); await expect(enabled).not.toBeChecked(); expect(checks).toBe(2);
  await check.click(); await expect.poll(() => checks).toBe(3);
  await request.put('/api/settings', { data: { updateNotifications: true } });
});
