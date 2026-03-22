import fs from 'node:fs';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const rootDir = __dirname;
const distDir = path.resolve(rootDir, 'dist');
const uiOutDir = path.resolve(distDir, 'ui');

function inlineBuiltUi() {
  const uiHtmlPath = path.resolve(uiOutDir, 'index.html');
  return fs.existsSync(uiHtmlPath) ? fs.readFileSync(uiHtmlPath, 'utf8') : '<div id="root"></div>';
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
