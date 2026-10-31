import { resolve } from 'node:path';
import { Store } from './store';
import { createApp } from './app';
const store = new Store(resolve(process.env.LEARNHELPER_DATA_DIR || '.learnhelper'));
const { app, active } = createApp(store);
const port = Number(process.env.PORT || 3001);
const server = app.listen(port, '127.0.0.1', () => console.log(`Learnhelper API: http://127.0.0.1:${port}`));
function shutdown() { for (const controller of active.values()) controller.abort('interrupted'); server.close(() => { store.db.close(); process.exit(0); }); }
process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
