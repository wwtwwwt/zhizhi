import type { Anchor, Role, Status } from './types';

export type MapMessage = { id: string; streamId: string; parentId: string | null; role: Role; kind: 'user' | 'assistant' | 'note' | 'document'; status: Status; preview: string };
export type MapBranch = { anchor: Anchor; parentMessageId: string; parentStreamId: string };
export type ConversationMapData = { rootStreamId: string; messages: MapMessage[]; branches: MapBranch[] };
export type MapPoint = MapMessage & { x: number; y: number };

export function layoutConversationMap(data: ConversationMapData) {
  const groups = new Map<string, MapMessage[]>();
  for (const message of data.messages) {
    const group = groups.get(message.streamId) || [];
    group.push(message); groups.set(message.streamId, group);
  }
  const children = new Map<string, MapBranch[]>();
  for (const branch of data.branches) {
    const group = children.get(branch.parentStreamId) || [];
    group.push(branch); children.set(branch.parentStreamId, group);
  }
  const rows = new Map<string, number>();
  const ends = new Map<string, number>();
  const order = [{ streamId: data.rootStreamId, start: 0 }];
  const visited = new Set<string>();
  for (let index = 0; index < order.length; index++) {
    const stream = order[index];
    if (visited.has(stream.streamId)) continue;
    visited.add(stream.streamId);
    const messages = groups.get(stream.streamId) || [];
    messages.forEach((message, offset) => rows.set(message.id, stream.start + offset));
    ends.set(stream.streamId, stream.start + messages.length - 1);
    for (const branch of children.get(stream.streamId) || []) {
      const parentRow = rows.get(branch.parentMessageId);
      if (parentRow !== undefined) order.push({ streamId: branch.anchor.stream_id, start: parentRow + 1 });
    }
  }
  for (const stream of [...order].reverse()) {
    ends.set(stream.streamId, Math.max(ends.get(stream.streamId) ?? 0, ...(children.get(stream.streamId) || []).map(branch => ends.get(branch.anchor.stream_id) ?? 0)));
  }
  const points = new Map<string, MapPoint>();
  const lanes: { start: number; end: number }[][] = [];
  const pending = [{ streamId: data.rootStreamId, parentId: null as string | null, parentLane: -1 }];
  visited.clear();
  while (pending.length) {
    const stream = pending.pop()!;
    if (visited.has(stream.streamId)) continue;
    visited.add(stream.streamId);
    const messages = groups.get(stream.streamId) || [];
    const start = stream.parentId ? rows.get(stream.parentId) ?? 0 : 0;
    const end = ends.get(stream.streamId) ?? start;
    let lane = stream.parentLane + 1;
    while (lanes[lane]?.some(range => start <= range.end && end >= range.start)) lane++;
    (lanes[lane] ||= []).push({ start, end });
    messages.forEach(message => points.set(message.id, { ...message, x: 24 + lane * 40, y: 24 + rows.get(message.id)! * 28 }));
    const branches = [...children.get(stream.streamId) || []].sort((first, second) => (rows.get(first.parentMessageId) ?? 0) - (rows.get(second.parentMessageId) ?? 0));
    for (const branch of branches) {
      if (points.has(branch.parentMessageId)) pending.push({ streamId: branch.anchor.stream_id, parentId: branch.parentMessageId, parentLane: lane });
    }
  }
  const nodes = [...points.values()];
  return { nodes, width: Math.max(48, ...nodes.map(node => node.x + 24)), height: Math.max(48, ...nodes.map(node => node.y + 24)) };
}

export function mapBranchPath(data: ConversationMapData, streamId: string) {
  const branches = new Map(data.branches.map(branch => [branch.anchor.stream_id, branch]));
  const path: MapBranch[] = [], visited = new Set<string>();
  while (streamId !== data.rootStreamId) {
    const branch = branches.get(streamId);
    if (!branch || visited.has(streamId)) throw new Error('该分支已发生变化，请重新打开对话地图');
    visited.add(streamId); path.unshift(branch); streamId = branch.parentStreamId;
  }
  return path;
}
