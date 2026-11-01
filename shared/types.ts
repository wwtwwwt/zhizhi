export type Role = 'user' | 'assistant' | 'system';
export type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
export type ChatMessage = { role: Role; content: string | ContentPart[] };
export type Status = 'queued' | 'streaming' | 'complete' | 'error' | 'interrupted' | 'stopped';
export type Settings = { theme: 'light' | 'dark' | 'system'; confirmDeletion: boolean; nickname: string; fontSize: number; sendShortcut: 'enter' | 'mod-enter'; fakeDelay: number; stackDirection: 'up' | 'left' };
export type Ast = { type: string; tagName?: string; properties?: Record<string, string | number>; value?: string; url?: string; alt?: string; identifier?: string; title?: string | null; depth?: number; ordered?: boolean; start?: number | null; lang?: string | null; children?: Ast[]; checked?: boolean | null; position?: { start: { offset?: number }; end: { offset?: number } }; offset?: number };
export type RenderMeta = { depth?: number; marker?: string; quote?: boolean };
export type ParsedBlock = { markdown: string; type: string; text: string; tree: Ast; meta: RenderMeta };
export type Anchor = { kind?: 'question' | 'note'; id: string; source_node_id: string; stream_id: string; start_offset: number; end_offset: number; selected_text: string; parent_stream_id?: string; preview?: { question: string; answer: string; status: Status | 'empty' } };
export type ContentNode = { id: string; slot_id: string; version_no: number; markdown: string; selection_text: string; block_type: string; status: string };
export type Slot = { id: string; active_node_id: string; meta: RenderMeta; node: ContentNode; versions: ContentNode[]; anchors: Anchor[]; proposals: { id: string; node: ContentNode }[] };
export type Message = { document_name?: string | null; document_source?: string | null; reasoning_text?: string; model_label?: string; attachments?: import('./models').AttachmentInfo[]; id: string; stream_id: string; ordinal: number; role: Role; status: Status; content_markdown: string; generation_id: string | null; slots: Slot[] };
export type Stream = { id: string; session_id: string; kind: string; source?: Anchor; messages: Message[]; pendingRewrites: { id: string; source_node_id: string; status: Status; draft_markdown: string }[] };
export type Session = { id: string; title: string; root_stream_id: string; updated_at: string };
export type ContextRef = { role: Role; nodeIds?: string[]; quote?: string; attachmentMessageId?: string };
export type GenerationResult = { generationId: string; streamId: string; messageId?: string; branch?: Anchor; proposalId?: string; candidateNodeId?: string };

export type StorageInfo = { mode: 'local' | 'cache'; path?: string; totalBytes: number; files: {name:string;bytes:number;path?:string}[]; sessions:number; messages:number; blocks:number; branches:number; attachments:number; models:number };
