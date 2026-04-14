import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import { scannerMiddlewarePlugin } from './src/server/scanner-middleware';

/** Vite plugin to serve PDF files from the OneDrive scan folder */
function servePdfsPlugin() {
  const scanRoot = path.resolve(__dirname, '../../OneDrive_2026-03-27');

  return {
    name: 'serve-pdfs',
    configureServer(server: { middlewares: { use: Function } }) {
      server.middlewares.use((req: { url?: string }, res: { setHeader: Function; end: Function; statusCode: number }, next: Function) => {
        const url = req.url ?? '';
        if (!url.startsWith('/pdfs/')) return next();

        // /pdfs/Revenue Flash/03192026/file.pdf → scanRoot/Revenue Flash/03192026/file.pdf
        const relativePath = decodeURIComponent(url.slice('/pdfs/'.length));
        const filePath = path.join(scanRoot, relativePath);

        if (!filePath.startsWith(scanRoot)) {
          res.statusCode = 403;
          res.end('Forbidden');
          return;
        }

        if (!fs.existsSync(filePath)) {
          res.statusCode = 404;
          res.end('Not found');
          return;
        }

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'inline');
        const stream = fs.createReadStream(filePath);
        stream.pipe(res);
      });
    },
  };
}

export default defineConfig({
  // Load .env from monorepo root (single .env for everything)
  envDir: path.resolve(__dirname, '../..'),
  plugins: [react(), servePdfsPlugin(), scannerMiddlewarePlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
