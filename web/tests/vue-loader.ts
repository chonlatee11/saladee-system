// Bun test-time loader for Vue SFCs (02-05). `bun test` has no Vue plugin (unlike
// the Vite build), so an `import Foo from "*.vue"` would otherwise resolve to an
// invalid component. This registers a Bun `onLoad` hook that compiles each `.vue`
// file with @vue/compiler-sfc (already present as a Vue dependency — no new package)
// so component tests can import and server-render real SFCs. Preloaded via bunfig.toml.
//
// Scope: `<script setup>` + inline template only (all of this project's SFCs). Styles
// are Tailwind utility classes, so `<style>` blocks are ignored. This file is a test
// harness — it never ships in the Vite build.
import { plugin } from "bun";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { compileScript, parse, rewriteDefault } from "@vue/compiler-sfc";

plugin({
  name: "vue-sfc-loader",
  setup(build) {
    build.onLoad({ filter: /\.vue$/ }, (args) => {
      const source = readFileSync(args.path, "utf8");
      const id = createHash("md5").update(args.path).digest("hex").slice(0, 8);
      const { descriptor } = parse(source, { filename: args.path });
      // inlineTemplate:true folds the template's render into setup, so a single
      // compile step yields a complete component (client render — renderToString
      // executes it fine for SSR assertions).
      const script = compileScript(descriptor, { id, inlineTemplate: true });
      const code =
        rewriteDefault(script.content, "__sfc__", ["typescript"]) +
        `\n__sfc__.__file = ${JSON.stringify(args.path)};\nexport default __sfc__;`;
      return { contents: code, loader: "ts" };
    });
  },
});
