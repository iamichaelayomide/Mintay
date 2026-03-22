import fs from 'node:fs';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const rootDir = __dirname;
const distDir = path.resolve(rootDir, 'dist');
const uiOutDir = path.resolve(distDir, 'ui');

function inlineBuiltUi() {
  return {
    name: 'inline-built-ui',
    transform(code: string, id: string) {
      if (!id.endsWith(path.normalize('src/sandbox/index.ts'))) {
        return null;
      }

      const uiHtmlPath = path.resolve(uiOutDir, 'index.html');
      const uiHtml = fs.existsSync(uiHtmlPath) ? fs.readFileSync(uiHtmlPath, 'utf8') : '<div id="root"></div>';
      return code.replace('__MINTAY_UI_HTML__', JSON.stringify(uiHtml));
    },
  };
}

export default defineConfig(({ mode }) => {
  if (mode === 'sandbox') {
    return {
      root: rootDir,
      plugins: [inlineBuiltUi()],
      build: {
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
