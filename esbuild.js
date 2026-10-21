const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** Package version read from package.json at build time, inlined via esbuild `define`. */
const pkgVersion = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'package.json'), 'utf-8'),
).version;
const versionDefine = {
  'process.env.PIXEL_AGENTS_VERSION': JSON.stringify(pkgVersion),
};

/**
 * Copy assets folder to dist/assets
 */
function copyAssets() {
  const srcDir = path.join(__dirname, 'webview-ui', 'public', 'assets');
  const dstDir = path.join(__dirname, 'dist', 'assets');

  if (fs.existsSync(srcDir)) {
    if (fs.existsSync(dstDir)) {
      fs.rmSync(dstDir, { recursive: true });
    }
    fs.cpSync(srcDir, dstDir, { recursive: true });
    console.log('✓ Copied assets/ → dist/assets/');
  } else {
    console.log('ℹ️  assets/ folder not found (optional)');
  }
}

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
  name: 'esbuild-problem-matcher',

  setup(build) {
    build.onStart(() => {
      console.log('[watch] build started');
    });
    build.onEnd((result) => {
      result.errors.forEach(({ text, location }) => {
        console.error(`✘ [ERROR] ${text}`);
        console.error(`    ${location.file}:${location.line}:${location.column}:`);
      });
      console.log('[watch] build finished');
    });
  },
};

/** Build options for the standalone CLI entry point. */
const cliOptions = {
  entryPoints: ['server/src/cli.ts'],
  bundle: true,
  format: 'cjs',
  minify: production,
  sourcemap: !production,
  platform: 'node',
  outfile: 'dist/cli.js',
  external: ['fastify', '@fastify/websocket', '@fastify/static', '@fastify/cors'],
  define: versionDefine,
  logLevel: 'silent',
};

async function main() {
  if (watch) {
    const ctx = await esbuild.context({ ...cliOptions, plugins: [esbuildProblemMatcherPlugin] });
    await ctx.watch();
    return;
  }
  copyAssets();
  await esbuild.build(cliOptions);
  console.log('✓ Bundled CLI → dist/cli.js');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
