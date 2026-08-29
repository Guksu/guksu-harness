import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  parseFrontmatter,
  scoreEntry,
  rankCandidates,
  buildCatalog,
  ensureCache,
  copyPayload,
} from './feSkills.mjs';

const skillDoc = ({ name, description }) => `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`;

const makeLibraryFixture = async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'fe-skills-'));
  const ui = join(rootDir, 'plugins/ui/skills');
  const system = join(rootDir, 'plugins/system/skills');
  await mkdir(join(ui, 'bottom-sheet/assets'), { recursive: true });
  await mkdir(join(ui, 'pinch-zoom/assets'), { recursive: true });
  await mkdir(join(ui, 'broken'), { recursive: true });
  await mkdir(join(system, 'list-filter-detail/references'), { recursive: true });

  await writeFile(
    join(ui, 'bottom-sheet/SKILL.md'),
    skillDoc({ name: 'bottom-sheet', description: '아래에서 올라오는 바텀시트(드래그로 끌어내려 닫기) 구현.' }),
  );
  await writeFile(join(ui, 'bottom-sheet/assets/BottomSheet.tsx'), 'export const BottomSheet = () => null\n');
  await writeFile(join(ui, 'bottom-sheet/assets/bottom-sheet.css'), '.sheet { inset: 0 }\n');
  await writeFile(
    join(ui, 'pinch-zoom/SKILL.md'),
    skillDoc({ name: 'pinch-zoom', description: '피드 이미지 핀치줌 구현 — 두 손가락으로 벌리면 커진다.' }),
  );
  await writeFile(join(ui, 'pinch-zoom/assets/createPinchZoom.ts'), 'export const createPinchZoom = () => {}\n');
  // frontmatter가 깨진 스킬 — 카탈로그에서 조용히 빠지되 나머지는 살아야 한다
  await writeFile(join(ui, 'broken/SKILL.md'), '# 제목만 있고 frontmatter가 없다\n');
  await writeFile(
    join(system, 'list-filter-detail/SKILL.md'),
    skillDoc({ name: 'list-filter-detail', description: '목록+필터/정렬/검색+상세 화면의 시스템 설계를 결정한다.' }),
  );
  await writeFile(join(system, 'list-filter-detail/references/data-fetching.md'), '# 데이터 페칭\n');
  return rootDir;
};

test('frontmatter에서 name·description을 뽑는다 (멀티라인 포함)', () => {
  assert.equal(parseFrontmatter(skillDoc({ name: 'switch', description: '토글 스위치' }))?.name, 'switch');
  const multiline = '---\nname: tooltip\ndescription: "호버는 지연 후,\n  포커스는 즉시"\n---\n';
  assert.equal(parseFrontmatter(multiline)?.description, '호버는 지연 후, 포커스는 즉시');
  assert.equal(parseFrontmatter('frontmatter 없음'), null);
});

test('카탈로그 — 두 플러그인을 모두 읽고 payload 위치를 구분한다', async () => {
  const rootDir = await makeLibraryFixture();
  const catalog = buildCatalog({ rootDir });

  assert.deepEqual(
    catalog.map((entry) => entry.slug).sort(),
    ['bottom-sheet', 'list-filter-detail', 'pinch-zoom'],
    'frontmatter가 깨진 스킬은 빠지고 나머지는 살아남는다',
  );
  const ui = catalog.find((entry) => entry.slug === 'bottom-sheet');
  assert.equal(ui.plugin, 'fe-ui');
  assert.equal(ui.payload, 'assets');
  const system = catalog.find((entry) => entry.slug === 'list-filter-detail');
  assert.equal(system.plugin, 'fe-system');
  assert.equal(system.payload, 'references', '설계 스킬은 코드가 아니라 근거 문서를 갖는다');

  await rm(rootDir, { recursive: true, force: true });
});

test('검색 — slug 정확 일치가 최상위, 조사가 붙은 한글도 매칭된다', async () => {
  const rootDir = await makeLibraryFixture();
  const catalog = buildCatalog({ rootDir });

  assert.equal(rankCandidates({ catalog, query: 'bottom-sheet' })[0].slug, 'bottom-sheet');
  // 사용자는 스킬 이름이 아니라 하고 싶은 일을 말한다
  assert.equal(rankCandidates({ catalog, query: '바텀시트로 메뉴 고르게 해줘' })[0].slug, 'bottom-sheet');
  assert.equal(rankCandidates({ catalog, query: '피드 사진 핀치줌 되게' })[0].slug, 'pinch-zoom');
  assert.equal(
    rankCandidates({ catalog, query: '상품 목록에 필터 붙여줘' })[0].slug,
    'list-filter-detail',
    'UI 패턴과 설계 스킬이 한 카탈로그에 있어도 요청 성격에 맞는 쪽이 먼저 온다',
  );
  // 없는 것을 있다고 하지 않는다 — 호출부는 이 빈 결과를 "직접 구현" 신호로 쓴다
  assert.equal(rankCandidates({ catalog, query: '결제 게이트웨이 연동' }).length, 0);
  assert.equal(scoreEntry(catalog[0], ''), 0);

  await rm(rootDir, { recursive: true, force: true });
});

test('정본 복사 — 파일을 옮기고 덮어쓴 것을 보고한다', async () => {
  const rootDir = await makeLibraryFixture();
  const catalog = buildCatalog({ rootDir });
  const entry = catalog.find((candidate) => candidate.slug === 'bottom-sheet');
  const into = join(rootDir, 'target/ui/bottom-sheet');

  const first = copyPayload({ payloadDir: entry.payloadDir, into });
  assert.equal(first.copied.length, 2);
  assert.equal(first.overwritten.length, 0);
  assert.ok(existsSync(join(into, 'BottomSheet.tsx')));

  // 두 번째 호출은 덮어쓴 사실을 알린다 — 프로젝트에서 수정한 사본을 조용히 지우지 않는다
  const second = copyPayload({ payloadDir: entry.payloadDir, into });
  assert.equal(second.overwritten.length, 2);

  // payload가 없는 스킬(문서만 있는 경우)도 실패하지 않는다
  assert.deepEqual(copyPayload({ payloadDir: join(rootDir, '없음'), into }).copied, []);

  await rm(rootDir, { recursive: true, force: true });
});

test('캐시 — 갱신 실패 시 기존 캐시로 진행하고, 캐시도 없으면 실패로 알린다', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'fe-cache-'));
  const cacheDir = join(rootDir, 'cache');
  const failing = () => {
    throw new Error('네트워크 없음');
  };

  // 캐시 없음 + 클론 실패 → 실패 (호출부가 exit 3으로 알린다)
  assert.equal(ensureCache({ cacheDir, cloneFn: failing }).ok, false);

  // 캐시 있음 + 갱신 실패 → 낡은 캐시로 진행. 없는 라이브러리보다 낡은 쪽이 낫다
  await mkdir(join(cacheDir, '.git'), { recursive: true });
  const logs = [];
  const stale = ensureCache({ cacheDir, refresh: true, cloneFn: failing, log: (m) => logs.push(m) });
  assert.equal(stale.ok, true);
  assert.equal(stale.stale, true);
  assert.match(logs[0], /기존 캐시로 진행/);

  // 캐시 있음 + refresh 아님 → 네트워크를 아예 건드리지 않는다
  let called = false;
  const cached = ensureCache({ cacheDir, cloneFn: () => { called = true; } });
  assert.equal(cached.ok, true);
  assert.equal(called, false);

  await rm(rootDir, { recursive: true, force: true });
});
