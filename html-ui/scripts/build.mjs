import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const templatePath = "src/template.html";
const outPath = "dist/index.html";
const cssPath = "dist/app.css";
const jsPath = "dist/app.js";

const [template, css, js] = await Promise.all([
  readFile(templatePath, "utf8"),
  readFile(cssPath, "utf8"),
  readFile(jsPath, "utf8")
]);

const html = template
  // Use function form so $ in CSS/JS isn't treated as a replace token.
  .replace("__INLINE_CSS__", () => css.trim())
  .replace("__INLINE_JS__", () => js.trim());

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, html, "utf8");
