import { BuildOptions, context, Plugin, PluginBuild } from "esbuild";
import { mkdirSync, readdirSync, readFileSync, statSync } from "fs";
import { emptyDirSync, pathExistsSync, readFile, writeFile } from "fs-extra";
import { dirname, join, resolve } from "path";

// -----------------------------------------------------
//  Log Colors
// -----------------------------------------------------
enum LogColor {
  Red = 31,
  Green = 32,
  Yellow = 33,
  Magenta = 35,
  Cyan = 36
}

// -----------------------------------------------------
//  Constants
// -----------------------------------------------------
const PROJECT_ROOT = resolve(__dirname, "..");
const SRC_DIR = join(PROJECT_ROOT, "src");
const OUT_DIR = join(PROJECT_ROOT, "scripts");
const OUT_FILE = join(OUT_DIR, "index.js");

// Internal Minecraft Script Modules
const MC_INTERNAL_MODULES = [
  "@minecraft/server",
  "@minecraft/server-ui",
  "@minecraft/server-gametest",
  "@minecraft/debug-utilities",
  "@minecraft/server-graphics",
  "@minecraft/server-admin",
  "@minecraft/server-net",
  "@minecraft/diagnostics",
  "@minecraft/server-editor"
];

// -----------------------------------------------------
//  CLI FLAGS
// -----------------------------------------------------
const FLAGS = {
  watch: process.argv.includes("--watch"),
  minify: process.argv.includes("--minify")
};

// -----------------------------------------------------
//  PRE-BUILD VALIDATIONS
// -----------------------------------------------------

// Ensure Source Directory Exists
if (!pathExistsSync(SRC_DIR)) {
  log(LogColor.Red, `❌ Source directory not found: ${SRC_DIR}`);
  process.exit(1);
}

// Ensure Output Directory Exists and is Clean
if (!pathExistsSync(OUT_DIR)) mkdirSync(OUT_DIR);
emptyDirSync(OUT_DIR);

// -----------------------------------------------------
//  UTILITY FUNCTIONS
// -----------------------------------------------------

// Cache directory checks
const DIR_CACHE = new Map<string, boolean>();

// Check if path is a directory with caching
function isDirectory(path: string): boolean {
  if (DIR_CACHE.has(path)) return DIR_CACHE.get(path)!;

  let isDir = false;
  try {
    isDir = statSync(path).isDirectory();
  } catch {}
  DIR_CACHE.set(path, isDir);
  return isDir;
}

// Recursively collect all files
function getFiles(dir: string, acc: string[] = []): string[] {
  for (const file of readdirSync(dir)) {
    const full = join(dir, file);
    statSync(full).isDirectory() ? getFiles(full, acc) : acc.push(full);
  }
  return acc;
}

// -----------------------------------------------------
//  IMPORT TRANSFORMER
// -----------------------------------------------------
async function transformDirectoryImports(filePath: string): Promise<boolean> {
  const original = await readFile(filePath, "utf8");
  const fileDir = dirname(filePath);

  // matches: import ... from "./dir"
  const regex = /(from\s+["'])(\.[^"']+)(["'])/g;

  const updated = original.replace(regex, (full, p1, path, p3) => {
    if (path.endsWith(".js")) return full;

    const cleaned = path.replace(/\/$/, "");
    const resolved = resolve(fileDir, cleaned);

    return isDirectory(resolved)
      ? `${p1}${cleaned}/index.js${p3}`
      : `${p1}${cleaned}.js${p3}`;
  });

  if (updated !== original) {
    await writeFile(filePath, updated);
    return true;
  }

  return false;
}

// -----------------------------------------------------
//  LOGGING
// -----------------------------------------------------
function log(color: LogColor, msg: string) {
  process.stdout.write(
    `\x1b[${color}m[${new Date().toLocaleTimeString()}] ${msg}\x1b[0m\n`
  );
}

// -----------------------------------------------------
//  ESBUILD PLUGIN (STATUS NOTIFICATIONS)
// -----------------------------------------------------
class NotificationPlugin implements Plugin {
  public name = "notification-plugin";
  private static startTime: number = 0;

  public setup(build: PluginBuild) {
    build.onStart(() => {
      if (FLAGS.watch) process.stdout.write("\r\x1b[K");
      DIR_CACHE.clear();
      NotificationPlugin.startTime = Date.now();
      log(LogColor.Yellow, "🔄 Build started...");
    });

    build.onEnd(async (result) => {
      const duration = Date.now() - NotificationPlugin.startTime;

      if (result.errors.length)
        return log(
          LogColor.Red,
          `❌ Build failed with ${result.errors.length} error(s) in ${duration}ms`
        );

      log(LogColor.Green, `✅ Build completed in ${duration}ms`);

      if (FLAGS.watch)
        process.stdout.write(`\n\x1b[36mWatching for changes...\x1b[0m`);
    });
  }
}

// -----------------------------------------------------
//  ESBUILD OPTIONS
// -----------------------------------------------------
const options: BuildOptions = {
  entryPoints: [join(SRC_DIR, "index.ts")],
  outfile: OUT_FILE,
  outdir: undefined,
  bundle: true,
  minify: FLAGS.minify,
  format: "esm",
  external: MC_INTERNAL_MODULES,
  plugins: [new NotificationPlugin()],
  mainFields: ["main"],
  platform: "node"
};

// -----------------------------------------------------
//  EXECUTE BUILD
// -----------------------------------------------------
(async () => {
  try {
    const ctx = await context(options);
    if (FLAGS.watch) await ctx.watch();
    else await ctx.rebuild();

    if (!FLAGS.watch) process.exit(0);
  } catch (err: any) {
    log(LogColor.Red, `❌ Fatal build error: ${err.message || err}`);
    process.exit(1);
  }
})();
