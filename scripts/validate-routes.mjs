import { access, readFile } from "node:fs/promises";

const routes = [
  ["/", "dist/index.html"],
  ["/compare/alttab/", "dist/compare/alttab/index.html"],
  ["/guides/search-open-tabs-on-mac/", "dist/guides/search-open-tabs-on-mac/index.html"],
  ["/press/", "dist/press/index.html"],
  ["/pricing/", "dist/pricing/index.html"],
  ["/privacy/", "dist/privacy/index.html"],
  ["/terms/", "dist/terms/index.html"],
];

const failures = [];

for (const [route, file] of routes) {
  try {
    await access(file);
    const html = await readFile(file, "utf8");
    const h1Count = (html.match(/<h1\b/gi) ?? []).length;

    if (!/<title>.+<\/title>/is.test(html)) failures.push(`${route}: missing title`);
    if (!/<meta\s+name="description"\s+content="[^"]+"/i.test(html)) failures.push(`${route}: missing description`);
    if (!/<link\s+rel="canonical"\s+href="[^"]+"/i.test(html)) failures.push(`${route}: missing canonical URL`);
    if (h1Count !== 1) failures.push(`${route}: expected one h1, found ${h1Count}`);
  } catch {
    failures.push(`${route}: missing generated page at ${file}`);
  }
}

try {
  await access("dist/sitemap-index.xml");
} catch {
  failures.push("missing dist/sitemap-index.xml");
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Validated ${routes.length} routes and the sitemap.`);
}
