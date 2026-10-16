// Public reads only. No DB client and no import option by design.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const output = path.resolve('.codex-tmp/naver-design-history');
await mkdir(output, { recursive: true });
const posts = new Map();
let expected;
for (let page = 1; page <= 1000; page++) {
  const url = `https://blog.naver.com/PostTitleListAsync.naver?blogId=wl_0109&currentPage=${page}&categoryNo=0&countPerPage=30`;
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Page ${page}: HTTP ${response.status}`);
  const raw = await response.text();
  await writeFile(path.join(output, `page-${page}.json.txt`), raw);
  // Naver returns legacy JavaScript-style escaped apostrophes in pagingHtml.
  const data = JSON.parse(raw.replaceAll("\\'", "'"));
  if (data.resultCode !== 'S' || !Array.isArray(data.postList)) throw new Error(`Unexpected page ${page}`);
  expected ??= Number(data.totalCount);
  const before = posts.size;
  for (const post of data.postList) {
    if (!/^\d+$/.test(post.logNo)) throw new Error('Invalid post ID');
    posts.set(post.logNo, { approved: '', normalized_project_name: '', blog_url: `https://blog.naver.com/wl_0109/${post.logNo}`,
      title: decodeURIComponent(post.title.replaceAll('+', ' ')).replaceAll('&#39;', "'").replaceAll('&amp;', '&'),
      published_date_display: post.addDate, category: post.categoryNo, source: 'history' });
  }
  console.log(`page ${page}: ${posts.size}/${expected || '?'}`);
  if (data.postList.length === 0 || (expected > 0 && posts.size >= expected)) break;
  if (posts.size === before) throw new Error('Pagination repeated; refusing to claim a complete export');
  if (page === 1000) throw new Error('Page limit reached');
  await new Promise(resolve => setTimeout(resolve, 300));
}
if (expected > 0 && posts.size !== expected) throw new Error('Public count mismatch; export incomplete');
const columns = ['approved','normalized_project_name','blog_url','title','published_date_display','category','source'];
const cell = value => '"' + String(value ?? '').replace(/^[=+@-]/, "'$&").replaceAll('"', '""') + '"';
await writeFile(path.join(output, 'wl_0109-review.csv'), '\ufeff' + [columns.join(','), ...[...posts.values()].map(row => columns.map(key => cell(row[key])).join(','))].join('\r\n'));
await writeFile(path.join(output, 'summary.json'), JSON.stringify({ publicPosts: posts.size, expected, fetchedAt: new Date().toISOString(), completePublicList: posts.size === expected, imported: false }, null, 2));
console.log(path.join(output, 'wl_0109-review.csv'));
