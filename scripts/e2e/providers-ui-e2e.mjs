// Test-only UI E2E for /admin/providers against a LOCAL throwaway CPA (see scripts/e2e/README.md).
// Requires playwright-core + Chrome; never run against a live CPA.
import { execSync as _x } from "node:child_process";
import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args:['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: +(process.env.W||1280), height: 900 }, locale: 'zh-CN' });
const sess = { access_token:'x', token_type:'Bearer', access_expires_at: Date.now()/1000+86400, session:{sid:'s',current:true}, user:{id:1,display_name:'Blank',username:'blank'}, is_admin:true };
await ctx.addInitScript((s) => { sessionStorage.setItem('mrblank.session.cache', JSON.stringify(s)); }, sess);
const ok = (data) => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
await ctx.route('**/api/**', async (route) => {
  const path = new URL(route.request().url()).pathname;
  if (!path.startsWith('/api/') || path.startsWith('/api/admin/cpa-mgmt/')) return route.continue();
  if (path === '/api/user/session') return route.fulfill(ok(sess));
  if (path === '/api/admin/me') return route.fulfill(ok({ is_admin: true }));
  return route.fulfill(ok({}));
});
const p = await ctx.newPage(); p.setDefaultTimeout(8000);
p.on('pageerror', e => console.log('PAGEERR', e.message));
p.on('console', m => { if (m.type()==='error') console.log('CONSOLE', m.text()); });
p.on('response', r => { if (r.url().includes('cpa-mgmt')) console.log('RESP', r.request().method(), r.status(), r.url().replace(/^.*cpa-mgmt/,'')); });
const execSync=_x;
const MK = 'local-test-mgmt-key', CPA = 'http://127.0.0.1:18417/v0/management/';
const SECTIONS = ['gemini-api-key','claude-api-key','codex-api-key','vertex-api-key','openai-compatibility','xai-api-key','interactions-api-key','meta-api-key'];
const cpa = async (s) => { const r = await fetch(CPA+s, { headers: { Authorization: 'Bearer '+MK } }); return r.ok ? (await r.json()) : { status: r.status }; };
const snap = async () => { const o = {}; for (const s of SECTIONS) o[s] = await cpa(s); o.__config = await cpa('config'); return o; };
const fileText = () => execSync('cat /workspace/cpa-local/run/config.yaml').toString();
const strip = (o) => JSON.parse(JSON.stringify(o, (k, v) => k === 'auth-index' ? undefined : v));
const results = [];
function check(name, cond, extra='') { results.push([name, !!cond]); console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' :: ' + extra : '')); }
function sameExcept(before, after, section, pick) {
  // every section other than `section` must be deep-equal; in `section`, entries not matched by pick must be deep-equal
  for (const s of SECTIONS) {
    if (s === section) continue;
    if (JSON.stringify(strip(before[s])) !== JSON.stringify(strip(after[s]))) return 'section changed: ' + s;
  }
  const b = (strip(before[section])[section] || []).filter(e => !pick(e));
  const a = (strip(after[section])[section] || []).filter(e => !pick(e));
  if (JSON.stringify(b) !== JSON.stringify(a)) return 'other entries changed in ' + section + '\n' + JSON.stringify(b) + '\n' + JSON.stringify(a);
  const cb = { ...before.__config }, ca = { ...after.__config };
  for (const s of SECTIONS) { delete cb[s]; delete ca[s]; }
  if (JSON.stringify(cb) !== JSON.stringify(ca)) {
    const diff = Object.keys({...cb,...ca}).filter(k => JSON.stringify(cb[k]) !== JSON.stringify(ca[k]));
    return 'non-provider config changed: ' + diff.join(',');
  }
  return '';
}
const fileChecks = (label) => {
  const t = fileText();
  check(label + ': file keeps unknown top-level key', /x-mrblank-unknown-top:/.test(t) && /keep: me|keep: "me"/.test(t));
  check(label + ': file keeps request-retry', /request-retry: 2/.test(t));
  check(label + ': file keeps management secret', /secret-key:/.test(t));
  if (label==='baseline') check(label + ': file has yaml-only entry fields', /claude-keep/.test(t)); else console.log('INFO', label, 'yaml-only entry fields still in file:', /claude-keep/.test(t));
};
const cardOf = (text) => p.locator(`xpath=//*[normalize-space(text())='${text}']/ancestor::*[.//button[@aria-label='编辑']][1]`);
const reload = async () => { await p.goto('http://127.0.0.1:5288/#/admin/providers', { waitUntil: 'networkidle' }); await p.waitForTimeout(1200); };
const saveDrawer = async () => { const d = p.locator('[role=dialog]').last(); await d.getByRole('button', { name: '保存' }).click(); await p.waitForTimeout(1500); };
const isNew = (e) => e['api-key'] === 'AIza-e2e-new-ZZ';

await reload();
fileChecks('baseline');
let before = await snap();

// ADD
await p.getByText('添加配置', { exact: true }).click(); await p.waitForTimeout(300);
await p.locator('[role=menuitem]', { hasText: 'Gemini' }).first().click(); await p.waitForTimeout(600);
let d = p.locator('[role=dialog]').last();
await d.getByPlaceholder('输入 Gemini API 密钥').fill('AIza-e2e-new-ZZ');
await d.getByPlaceholder('例如: team-a').fill('team-e2e');
await saveDrawer();
let after = await snap();
let added = (after['gemini-api-key']['gemini-api-key'] || []).find(isNew);
check('add: new entry present with prefix', added && added.prefix === 'team-e2e', JSON.stringify(added));
check('add: others preserved', !sameExcept(before, after, 'gemini-api-key', isNew), sameExcept(before, after, 'gemini-api-key', isNew));
fileChecks('add');

// EDIT (base url + priority)
before = after; await reload();
await cardOf('AI******ZZ').getByRole('button', { name: '编辑', exact: true }).click(); await p.waitForTimeout(600);
d = p.locator('[role=dialog]').last();
check('edit drawer shows plaintext key', (await d.getByPlaceholder('输入 Gemini API 密钥').inputValue()) === 'AIza-e2e-new-ZZ');
await d.getByPlaceholder('例如: https://generativelanguage.googleapis.com').fill('https://gemini-e2e.example.com');
await saveDrawer();
after = await snap();
let edited = (after['gemini-api-key']['gemini-api-key'] || []).find(isNew);
check('edit: base-url updated', edited && edited['base-url'] === 'https://gemini-e2e.example.com', JSON.stringify(edited));
check('edit: prefix retained', edited && edited.prefix === 'team-e2e');
check('edit: others preserved', !sameExcept(before, after, 'gemini-api-key', isNew), sameExcept(before, after, 'gemini-api-key', isNew));
fileChecks('edit');

// PRIORITY (inline priority editor)
before = after; await reload();
await cardOf('AI******ZZ').getByRole('button', { name: '编辑优先级' }).click(); await p.waitForTimeout(300);
const pin = cardOf('AI******ZZ').locator('input[aria-label="编辑优先级"]');
await pin.fill('7'); await pin.press('Enter'); await p.waitForTimeout(1500);
after = await snap();
const prioE = (after['gemini-api-key']['gemini-api-key'] || []).find(isNew);
check('priority: priority=7 saved', prioE && Number(prioE.priority) === 7, JSON.stringify(prioE));
check('priority: edited fields retained', prioE && prioE['base-url'] === 'https://gemini-e2e.example.com' && prioE.prefix === 'team-e2e');
check('priority: others preserved', !sameExcept(before, after, 'gemini-api-key', isNew), sameExcept(before, after, 'gemini-api-key', isNew));
fileChecks('priority');

// TOGGLE
before = after; await reload();
const card = cardOf('AI******ZZ');
const sw = card.locator('input[type=checkbox], [role=switch]').first();
await sw.click({ force: true }).catch(async () => { await card.locator('label').first().click(); });
await p.waitForTimeout(1500);
after = await snap();
const toggled = (after['gemini-api-key']['gemini-api-key'] || []).find(isNew);
check('toggle: entry disabled (excluded-models contains * or disabled flag)', toggled && (toggled.disabled === true || (toggled['excluded-models']||[]).includes('*')), JSON.stringify(toggled));
check('toggle: edited fields retained', toggled && toggled['base-url'] === 'https://gemini-e2e.example.com' && Number(toggled.priority) === 7 && toggled.prefix === 'team-e2e');
check('toggle: others preserved', !sameExcept(before, after, 'gemini-api-key', isNew), sameExcept(before, after, 'gemini-api-key', isNew));
fileChecks('toggle');

// OPENAI-COMPAT edit (nested) — change base-url of existing provider
before = after; await reload();
await cardOf('localcompat').getByRole('button', { name: '编辑', exact: true }).click(); await p.waitForTimeout(600);
d = p.locator('[role=dialog]').last();
const baseInput = d.locator('input[value="https://example.com/v1"]');
await baseInput.fill('https://compat-e2e.example.com/v1');
await saveDrawer();
after = await snap();
const comp = (after['openai-compatibility']['openai-compatibility']||[])[0];
check('compat edit: base-url updated, keys+models kept', comp && comp['base-url'] === 'https://compat-e2e.example.com/v1' && comp['api-key-entries']?.[0]?.['api-key'] === 'sk-compat-1' && comp.models?.[0]?.name === 'm1', JSON.stringify(comp));
check('compat edit: other sections preserved', !sameExcept(before, after, 'openai-compatibility', () => true), sameExcept(before, after, 'openai-compatibility', () => true));
fileChecks('compat-edit');

// DELETE
before = after; await reload();
await cardOf('AI******ZZ').getByRole('button', { name: '删除', exact: true }).click(); await p.waitForTimeout(600);
const modal = p.locator('[role=dialog]').last();
console.log('CONFIRM TEXT', (await modal.innerText()).replace(/\n+/g, ' | '));
await modal.getByRole('button', { name: '下一步' }).click(); await p.waitForTimeout(500);
const modal2 = p.locator('[role=dialog]').last();
console.log('CONFIRM2 TEXT', (await modal2.innerText()).replace(/\n+/g, ' | '));
const confirmInput = modal2.locator('input');
if (await confirmInput.count()) { const ph = await confirmInput.first().getAttribute('placeholder'); console.log('confirm input placeholder', ph); }
await p.screenshot({ path: '/tmp/e2e-del2.png' });
const btns = await modal2.locator('button').allInnerTexts(); console.log('BTNS', btns.join(' | '));
await modal2.locator('button').last().click(); await p.waitForTimeout(1500);
after = await snap();
check('delete: entry removed', !(after['gemini-api-key']['gemini-api-key'] || []).some(isNew));
check('delete: others preserved', !sameExcept(before, after, 'gemini-api-key', isNew), sameExcept(before, after, 'gemini-api-key', isNew));
fileChecks('delete');

console.log('SUMMARY', results.filter(r => r[1]).length + '/' + results.length + ' passed');
await b.close();
