import { createServer } from 'vite';

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
});
try {
  await server.ssrLoadModule('/src/app/scenes/MenuScene.ts');
  console.log('MenuScene ok');
  await server.ssrLoadModule('/src/app/scenes/Game3DScene.ts');
  console.log('Game3DScene ok');
  await server.ssrLoadModule('/src/main.ts');
  console.log('main ok');
} catch (e) {
  console.error('IMPORT FAIL', e);
  process.exitCode = 1;
} finally {
  await server.close();
}
