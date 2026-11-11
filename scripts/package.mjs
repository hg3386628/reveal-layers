import { pack } from "@discourse-mini-app/sdk/pack";
import { readdir, copyFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
manifest.id = process.env.MINI_APP_ID || manifest.id;
manifest.version = process.env.MINI_APP_VERSION || manifest.version;

async function listFiles(dir, prefix = "") {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...(await listFiles(join(dir, entry.name), rel)));
    else if (entry.isFile()) files.push(rel);
  }
  return files;
}

const levelFiles = (await listFiles("dist/web/levels", "levels")).sort();
if (!levelFiles.includes("levels/levels.json")) {
  throw new Error("dist/web/levels/levels.json is missing; run prepare_levels first");
}
manifest.assets = levelFiles.filter((path) => path !== "levels/levels.json").concat();
// catalog must be packed too
if (!manifest.assets.includes("levels/levels.json")) {
  manifest.assets.unshift("levels/levels.json");
}

await copyFile("src/template.html", "dist/web/index.html");
await copyFile("src/strings.json", "dist/web/strings.json");
await writeFile("dist/web/manifest.json", JSON.stringify(manifest, null, 2));
const files = {};
for (const name of ["index.html", "app.js", "app.css", "strings.json"]) {
  files[name] = await readFile(`dist/web/${name}`);
}
for (const path of manifest.assets || []) {
  if (
    !/^[a-zA-Z0-9_.\-/]{1,160}$/.test(path) ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error(`Invalid package asset path: ${path}`);
  }
  files[path] = await readFile(`dist/web/${path}`);
}
const result = await pack({ manifest, files, outputDirectory: "dist/package" });
console.log(
  `Created ${result.file} (${result.size} bytes), app ${manifest.id}, version ${manifest.version}, ${manifest.assets.length} assets`
);
