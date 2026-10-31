import { randomUUID } from 'node:crypto';
import { AppError, type Store } from './store';
import type { AttachmentInput, AttachmentInfo } from '../shared/models';
export function validateAttachments(inputs: AttachmentInput[]) {
  if (inputs.length > 6) throw new AppError(400, 'ATTACHMENT_LIMIT', '每条消息最多 6 个附件');
  let total = 0;
  return inputs.map(a => {
    if (!a.name.trim() || a.name.length > 250) throw new AppError(400, 'INVALID_ATTACHMENT', '附件名称无效');
    let data: Buffer;
    if (a.kind === 'image') {
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(a.data)) throw new AppError(400, 'INVALID_ATTACHMENT', '图片编码无效');
      data = Buffer.from(a.data, 'base64');
      const png = data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
      const jpg = data[0] === 255 && data[1] === 216 && data[2] === 255;
      if (!(a.mime === 'image/png' && png || a.mime === 'image/jpeg' && jpg) || !/\.(png|jpe?g)$/i.test(a.name)) throw new AppError(400, 'INVALID_ATTACHMENT', '仅支持 JPG 和 PNG 图片');
      if (data.length > 5 * 1024 * 1024) throw new AppError(400, 'ATTACHMENT_LIMIT', '单张图片最多 5 MiB');
    } else {
      if (/[\x00-\x08\x0b\x0c\x0e-\x1f\ufffd]/.test(a.data)) throw new AppError(400, 'INVALID_ATTACHMENT', '文本附件需要为 UTF-8 纯文本');
      data = Buffer.from(a.data, 'utf8');
      if (data.length > 1024 * 1024) throw new AppError(400, 'ATTACHMENT_LIMIT', '单个文本附件最多 1 MiB');
    }
    total += data.length; if (total > 12 * 1024 * 1024) throw new AppError(400, 'ATTACHMENT_LIMIT', '每条消息的附件总计最多 12 MiB');
    return { ...a, buffer: data };
  });
}
export function saveAttachments(store: Store, messageId: string, inputs: AttachmentInput[]) {
  for (const a of validateAttachments(inputs)) store.run('INSERT INTO attachments VALUES(?,?,?,?,?,?,?)', randomUUID(), messageId, a.name, a.kind, a.kind === 'text' ? 'text/plain' : a.mime, a.buffer.length, a.buffer);
}
export function attachmentInfo(store: Store, messageId: string): AttachmentInfo[] { return store.all('SELECT id,name,kind,mime,size FROM attachments WHERE message_id=? ORDER BY rowid', messageId) as AttachmentInfo[]; }
