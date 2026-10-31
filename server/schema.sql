CREATE TABLE sessions(id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE streams(id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, kind TEXT NOT NULL CHECK(kind IN ('root','branch')), context_snapshot_json TEXT NOT NULL DEFAULT '[]');
CREATE UNIQUE INDEX one_root ON streams(session_id) WHERE kind='root';
CREATE TABLE messages(id TEXT PRIMARY KEY, stream_id TEXT NOT NULL REFERENCES streams(id) ON DELETE CASCADE, ordinal INTEGER NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL, content_markdown TEXT NOT NULL DEFAULT '', generation_id TEXT, reasoning_text TEXT NOT NULL DEFAULT '', model_label TEXT NOT NULL DEFAULT '', document_name TEXT, document_source TEXT, UNIQUE(stream_id,ordinal));
CREATE TABLE block_slots(id TEXT PRIMARY KEY, message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE, ordinal INTEGER NOT NULL, active_node_id TEXT, render_meta_json TEXT NOT NULL, deleted_at TEXT, UNIQUE(message_id,ordinal));
CREATE TABLE content_nodes(id TEXT PRIMARY KEY, slot_id TEXT NOT NULL REFERENCES block_slots(id) ON DELETE CASCADE, version_no INTEGER NOT NULL, source_node_id TEXT, markdown TEXT NOT NULL, selection_text TEXT NOT NULL, block_type TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(slot_id,version_no));
CREATE TABLE branches(id TEXT PRIMARY KEY, source_node_id TEXT NOT NULL REFERENCES content_nodes(id) ON DELETE CASCADE, stream_id TEXT NOT NULL UNIQUE REFERENCES streams(id) ON DELETE CASCADE, start_offset INTEGER NOT NULL CHECK(start_offset>=0), end_offset INTEGER NOT NULL CHECK(end_offset>start_offset), selected_text TEXT NOT NULL, created_at TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('question','note')), request_id TEXT);
CREATE TRIGGER nonoverlap BEFORE INSERT ON branches BEGIN
 SELECT RAISE(ABORT,'ANCHOR_OVERLAP') WHERE EXISTS(SELECT 1 FROM branches WHERE source_node_id=NEW.source_node_id AND start_offset<NEW.end_offset AND end_offset>NEW.start_offset);
END;
CREATE TRIGGER immutable_node BEFORE UPDATE OF markdown,selection_text,source_node_id ON content_nodes BEGIN SELECT RAISE(ABORT,'IMMUTABLE_NODE'); END;
CREATE TRIGGER valid_active BEFORE UPDATE OF active_node_id ON block_slots WHEN NEW.active_node_id IS NOT NULL BEGIN
 SELECT RAISE(ABORT,'INVALID_VERSION') WHERE NOT EXISTS(SELECT 1 FROM content_nodes WHERE id=NEW.active_node_id AND slot_id=NEW.id AND status='available');
END;
CREATE TABLE generations(id TEXT PRIMARY KEY, stream_id TEXT NOT NULL REFERENCES streams(id) ON DELETE CASCADE, target_message_id TEXT REFERENCES messages(id) ON DELETE CASCADE, source_node_id TEXT REFERENCES content_nodes(id) ON DELETE CASCADE, kind TEXT NOT NULL, status TEXT NOT NULL, provider TEXT NOT NULL, settings_json TEXT NOT NULL, context_json TEXT NOT NULL, draft_markdown TEXT NOT NULL DEFAULT '', error_code TEXT, request_id TEXT NOT NULL UNIQUE, request_signature TEXT NOT NULL, created_at TEXT NOT NULL, finished_at TEXT, reasoning_text TEXT NOT NULL DEFAULT '');
CREATE TABLE rewrite_proposals(id TEXT PRIMARY KEY, generation_id TEXT NOT NULL UNIQUE REFERENCES generations(id) ON DELETE CASCADE, source_node_id TEXT NOT NULL REFERENCES content_nodes(id) ON DELETE CASCADE, candidate_node_id TEXT NOT NULL REFERENCES content_nodes(id) ON DELETE CASCADE, status TEXT NOT NULL);
CREATE TABLE settings(key TEXT PRIMARY KEY,value_json TEXT NOT NULL);
CREATE INDEX stream_session ON streams(session_id);
CREATE INDEX message_stream ON messages(stream_id);
CREATE INDEX slot_message ON block_slots(message_id);
CREATE INDEX node_slot ON content_nodes(slot_id);
CREATE INDEX branch_node ON branches(source_node_id);
CREATE UNIQUE INDEX branch_request ON branches(request_id) WHERE request_id IS NOT NULL;
CREATE TABLE node_layout(node_id TEXT PRIMARY KEY REFERENCES content_nodes(id) ON DELETE CASCADE, meta_json TEXT NOT NULL);
CREATE TABLE models(id TEXT PRIMARY KEY, config_json TEXT NOT NULL);
CREATE TABLE attachments(id TEXT PRIMARY KEY, message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE, name TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('text','image')), mime TEXT NOT NULL, size INTEGER NOT NULL, data BLOB NOT NULL);
CREATE INDEX attachment_message ON attachments(message_id);
CREATE TABLE document_resources(id TEXT PRIMARY KEY, message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE, path TEXT NOT NULL, mime TEXT NOT NULL, data BLOB NOT NULL);
CREATE INDEX document_resource_message ON document_resources(message_id);
