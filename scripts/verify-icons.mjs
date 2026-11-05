/**
 * 核验 ICON-MAP 图标 slug 在本锁定的 Lucide 包中确实存在，
 * 并记录逐文件 SHA-256 与版本，供 AC22/许可审计复核。
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { RESOURCES_LICENSES, ROOT, log } from './lib/paths.mjs';
import { loadSharedModule } from './lib/ts-module.mjs';

const LUCIDE_STATIC = path.join(ROOT, 'node_modules', 'lucide-static');

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex').toUpperCase();
}

export async function verifyIcons({ write = true } = {}) {
  const manifestPath = path.join(LUCIDE_STATIC, 'package.json');
  if (!existsSync(manifestPath)) throw new Error('缺少 lucide-static，请先运行 npm install');
  const lucide = JSON.parse(readFileSync(manifestPath, 'utf8'));

  const navigation = await loadSharedModule('src/shared/navigation-icons.ts');
  const navigationRows=[];
  for(const key of navigation.NAVIGATION_ICON_KEYS){const pair=navigation.NAVIGATION_PATHS[key];
    if(!pair||!pair.outline||!pair.solid||pair.outline===pair.solid||/[<>]/.test(pair.outline+pair.solid))throw Error('Invalid navigation icon pair: '+key);
    for(const variant of ['outline','solid'])navigationRows.push(sha256(Buffer.from(pair[variant]))+'  '+key+'.'+variant);
  }
  if(navigationRows.length!==18)throw Error('Expected nine navigation pairs');
  const shared = await loadSharedModule('src/shared/icons.ts');
  const slugs = [...shared.ICON_SLUGS];
  const categorySlugs = [...shared.CATEGORY_ICON_SLUGS];

  const missing = [];
  const rows = [];
  for (const slug of slugs) {
    const iconPath = path.join(LUCIDE_STATIC, 'icons', `${slug}.svg`);
    if (!existsSync(iconPath)) {
      missing.push(slug);
      continue;
    }
    const content = readFileSync(iconPath);
    rows.push(`${sha256(content)}  ${slug}.svg`);
  }

  const duplicates = slugs.filter((slug, index) => slugs.indexOf(slug) !== index);
  const report = {
    navigationVariants:navigationRows,
    lucideVersion: lucide.version,
    totalSlugs: slugs.length,
    categorySlugs: categorySlugs.length,
    missing,
    duplicates,
    rows,
  };

  if (missing.length > 0 || duplicates.length > 0) {
    console.error(`[bookkeep] icon verification FAILED: missing=${missing.join(',')} duplicates=${duplicates.join(',')}`);
    return { ok: false, report };
  }

  if (write) {
    const navDir=path.join(RESOURCES_LICENSES,'navigation');mkdirSync(navDir,{recursive:true});writeFileSync(path.join(navDir,'ICON-VARIANTS.sha256'),'# Original BookKeepAI navigation vectors\n'+navigationRows.join('\n')+'\n','utf8');
    const targetDir = path.join(RESOURCES_LICENSES, 'lucide');
    mkdirSync(targetDir, { recursive: true });
    const header = [
      `# lucide-static ${lucide.version}`,
      '# 由 scripts/verify-icons.mjs 生成；用于确认 ICON-MAP 的 slug 在锁定版本中存在。',
      '# 格式：<SHA-256>  <slug>.svg',
      '',
    ].join('\n');
    writeFileSync(path.join(targetDir, 'ICON-SLUGS.sha256'), `${header}${rows.join('\n')}\n`, 'utf8');
  }

  log(
    `icon slugs verified: ${rows.length}/${slugs.length} (34 分类 + 导航), lucide-static ${lucide.version}`,
  );
  return { ok: true, report };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const result = await verifyIcons();
  process.exit(result.ok ? 0 : 1);
}
