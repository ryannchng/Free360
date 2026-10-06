import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

async function loadModule(relativePath) {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
  const mod = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);
  return mod;
}

const sheet = await loadModule('../src/lib/member-sheet.ts');

test('collapsed rest height is ~52% of the map container', () => {
  assert.equal(sheet.resolveMemberSheetHeights(700, 30).collapsed, Math.round(700 * 0.52));
  assert.equal(sheet.resolveMemberSheetHeights(1000, 0).collapsed, 520);
});

test('expanded height leaves the header reserve plus an exposed map strip', () => {
  const { collapsed, expanded } = sheet.resolveMemberSheetHeights(700, 30);
  assert.ok(expanded > collapsed);
  // Header + strip must still fit above the expanded sheet.
  assert.ok(expanded + 30 + sheet.MEMBER_SHEET_TOP_RESERVE_PX <= 700);
  // Ideal 85% would overrun the reserve here, so the bound applies.
  assert.ok(expanded < Math.round(700 * 0.85));
});

test('large containers expand toward the ideal fraction', () => {
  const { expanded } = sheet.resolveMemberSheetHeights(2000, 40);
  assert.equal(expanded, Math.round(2000 * 0.85));
});

test('degenerate containers collapse the two snaps (no drag offered)', () => {
  for (const h of [200, 100, 0, -50, NaN]) {
    const { collapsed, expanded } = sheet.resolveMemberSheetHeights(h, 20);
    if (h > 0) assert.equal(expanded, collapsed);
    else assert.deepEqual({ collapsed, expanded }, { collapsed: 0, expanded: 0 });
  }
});

test('release past the drag threshold changes state, jitter keeps it', () => {
  assert.equal(sheet.nextMemberSheetExpanded({ expanded: false, dragDy: -80, velocityY: 0 }), true);
  assert.equal(sheet.nextMemberSheetExpanded({ expanded: true, dragDy: 80, velocityY: 0 }), false);
  assert.equal(sheet.nextMemberSheetExpanded({ expanded: false, dragDy: -10, velocityY: 0 }), false);
  assert.equal(sheet.nextMemberSheetExpanded({ expanded: true, dragDy: 10, velocityY: 0 }), true);
});

test('fast flings win over distance', () => {
  assert.equal(sheet.nextMemberSheetExpanded({ expanded: false, dragDy: -5, velocityY: -2 }), true);
  assert.equal(sheet.nextMemberSheetExpanded({ expanded: true, dragDy: 5, velocityY: 2 }), false);
});

test('non-finite gesture input keeps the current state', () => {
  assert.equal(sheet.nextMemberSheetExpanded({ expanded: false, dragDy: NaN, velocityY: 0 }), false);
  assert.equal(sheet.nextMemberSheetExpanded({ expanded: true, dragDy: 0, velocityY: NaN }), true);
});

test('live drag heights clamp into the snap range', () => {
  assert.equal(sheet.clampMemberSheetHeight(400, 364, 514), 400);
  assert.equal(sheet.clampMemberSheetHeight(100, 364, 514), 364);
  assert.equal(sheet.clampMemberSheetHeight(900, 364, 514), 514);
  assert.equal(sheet.clampMemberSheetHeight(NaN, 364, 514), 364);
});
