// 숨은 인수 테스트가 채점 대상 작업 공간의 모듈을 불러온다. 에이전트는 이 폴더를 보지 못한다.
import { createServer } from 'node:http';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const workspace = process.env.BENCH_WORKSPACE;
if (!workspace) throw new Error('BENCH_WORKSPACE가 필요합니다');

export const load = (path) => import(pathToFileURL(join(workspace, path)).href);

const PAYMENT = { baseUrl: 'http://pg.test', secretKey: 'test', timeoutMs: 1000 };

export async function startServer(options = {}) {
  const { createApp } = await load('src/app.js');
  const { buildContainer } = await load('src/container.js');
  const container = buildContainer({ payment: PAYMENT }, options);
  const server = createServer(createApp(container));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const request = async (method, path, body) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : null };
  };
  return { container, request, close: () => new Promise((resolve) => server.close(resolve)) };
}
