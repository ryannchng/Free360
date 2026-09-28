import { createFree360Server } from './server.mjs';

const port = Number(process.env.PORT || 8080);
const { server } = createFree360Server({
  databasePath: process.env.DATA_PATH || '/data/free360.sqlite',
  setupCode: process.env.FREE360_SETUP_CODE,
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Free360 server listening on port ${port}`);
});
