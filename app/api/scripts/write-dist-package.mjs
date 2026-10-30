import { writeFile } from "node:fs/promises";

await writeFile(
  new URL("../dist/package.json", import.meta.url),
  '{"type":"module"}\n',
);
