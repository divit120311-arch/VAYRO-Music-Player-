import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

/**
 * The on-device text reader used by "Sync lyrics" on the website (src/services/spotifyTab.ts) is
 * served from this site, not a CDN: its worker and engine files are copied from node_modules into
 * /ocr/ (the language data, public/ocr/eng.traineddata, is already there).
 */
const require = createRequire(import.meta.url);
const OCR_FILES: Record<string, string> = {
  'worker.min.js': 'tesseract.js/dist/worker.min.js',
  'tesseract-core-lstm.wasm.js': 'tesseract.js-core/tesseract-core-lstm.wasm.js',
  'tesseract-core-simd-lstm.wasm.js': 'tesseract.js-core/tesseract-core-simd-lstm.wasm.js',
  'tesseract-core-relaxedsimd-lstm.wasm.js': 'tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js',
};
const ocrPath = (spec: string) => {
  const [pkg, ...rest] = spec.startsWith('@') ? [spec.split('/').slice(0, 2).join('/'), ...spec.split('/').slice(2)] : spec.split('/');
  return path.join(path.dirname(require.resolve(`${pkg}/package.json`)), ...rest);
};
function ocrFiles(): Plugin {
  return {
    name: 'vayro-ocr-files',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = req.url?.match(/^\/ocr\/([^/?]+)/)?.[1];
        if (!name || !OCR_FILES[name]) return next();
        res.setHeader('Content-Type', 'text/javascript');
        res.end(readFileSync(ocrPath(OCR_FILES[name])));
      });
    },
    generateBundle() {
      for (const [name, spec] of Object.entries(OCR_FILES)) this.emitFile({ type: 'asset', fileName: `ocr/${name}`, source: readFileSync(ocrPath(spec)) });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), ocrFiles()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8787', changeOrigin: false },
    },
  },
});
