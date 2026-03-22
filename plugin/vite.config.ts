import fs from 'node:fs';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const rootDir = __dirname;
const distDir = path.resolve(rootDir, 'dist');
const uiOutDir = path.resolve(distDir, 'ui');

function inlineBuiltUi() {
  const assetsDir = path.resolve(uiOutDir, 'assets');
  if (!fs.existsSync(assetsDir)) {
    return '<div id="root"></div>';
  }

  const assetFiles = fs.readdirSync(assetsDir);
  const scriptFile = assetFiles.find((file) => file.endsWith('.js'));
  const styleFile = assetFiles.find((file) => file.endsWith('.css'));
  const scriptContent = scriptFile ? fs.readFileSync(path.resolve(assetsDir, scriptFile), 'utf8') : '';
  const styleContent = styleFile ? fs.readFileSync(path.resolve(assetsDir, styleFile), 'utf8') : '';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Mintay</title>
    <style>${styleContent}</style>
  </head>
  <body>
    <div id="root"></div>
    <script>${scriptContent}<\/script>
  </body>
</html>`;
}

export default defineConfig(({ mode }) => {
  if (mode === 'sandbox') {
    return {
      root: rootDir,
      define: {
        __MINTAY_UI_HTML__: JSON.stringify(inlineBuiltUi()),
      },
      build: {
        target: 'es2017',
        outDir: path.resolve(distDir, 'sandbox'),
        emptyOutDir: false,
        lib: {
          entry: path.resolve(rootDir, 'src/sandbox/index.ts'),
          formats: ['cjs'],
          fileName: () => 'index.js',
        },
        rollupOptions: {
          external: [],
          output: {
            exports: 'named',
          },
        },
        minify: false,
      },
    };
  }

  return {
    root: rootDir,
    plugins: [react()],
    build: {
      outDir: uiOutDir,
      emptyOutDir: true,
      rollupOptions: {
        input: path.resolve(rootDir, 'index.html'),
      },
    },
  };
});
