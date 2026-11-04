import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { notify, reeditQuestion, useAppState } from './client';

export function ReeditQuestion({ messageId, streamId, label = '删除整条消息并重新提问', menu = false, onDone }: { messageId: string; streamId: string; label?: string; menu?: boolean; onDone?: () => void }) {
  const state = useAppState();
  const [confirm, setConfirm] = useState(false), [saving, setSaving] = useState(false);
  const messages = state.streams[streamId]?.messages || [];
  const index = messages.findIndex(message => message.id === messageId), answer = messages[index];
  const eligible = answer?.role === 'assistant' && messages[index - 1]?.role === 'user' && index === messages.length - 1;
  if (!eligible) return null;
  const busy = saving || messages.some(m => ['queued', 'streaming'].includes(m.status)) || Object.values(state.jobs).some(j => j.streamId === streamId);
  const remove = async () => {
    setSaving(true);
    try {
      await reeditQuestion(messageId, streamId); onDone?.();
    } catch (error) { notify((error as Error).message); } finally { setSaving(false); }
  };
  return confirm ? <div className="reedit-confirm"><p>删除本轮问答？相关分支也将删除，原问题将恢复到输入框</p><div className="block-menu-confirm"><button disabled={saving} onClick={() => setConfirm(false)}>取消</button><button className="delete-action" disabled={busy} onClick={() => void remove()}>确认</button></div></div> :
    <button type="button" role={menu ? 'menuitem' : undefined} className="delete-action reedit-question" disabled={busy} onClick={() => { if (state.settings?.confirmDeletion === false) void remove(); else setConfirm(true); }}><Pencil size={14}/>{label}</button>;
}
