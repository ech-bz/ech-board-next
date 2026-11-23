import tailwindcss from "@tailwindcss/vite";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

function sourceHash(path: string): string {
  const hash = createHash("sha256");
  for (const entry of readdirSync(path, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const full = join(path, entry.name);
    if (entry.isDirectory()) hash.update(sourceHash(full));
    else hash.update(entry.name).update(readFileSync(full));
  }
  return hash.digest("hex");
}

const buildId = sourceHash(fileURLToPath(new URL("./src", import.meta.url))).slice(0, 12);

export default defineConfig({
  plugins: [solid(), tailwindcss()],
  server: {
    port: 5174,
  },
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
    __BUILD_TIME__: JSON.stringify(Date.now()),
  },
});
