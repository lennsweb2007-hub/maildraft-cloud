import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Vite-Konfiguration fuer die Cloud-Fassung.
 *
 * Das Ergebnis landet in client/dist und wird von Vercel als statische Seite
 * ausgeliefert. Die API laeuft unter derselben Adresse auf /api - deshalb
 * braucht der Client keine Basis-URL und es gibt keine CORS-Fragen.
 *
 * Fuer die lokale Entwicklung mit "vercel dev" leitet der Proxy /api an den
 * lokalen Funktions-Server weiter.
 */
export default defineConfig({
  plugins: [react()],

  // Env-Dateien liegen im Projektwurzelverzeichnis, nicht in client/. So teilen
  // sich API und Oberflaeche eine .env - sonst suchte Vite hier im Unterordner
  // und die VITE_-Werte fehlten im Build, ohne dass es auffaellt.
  // Auf Vercel greift das ohnehin nicht: dort kommen die Werte aus der Umgebung.
  envDir: '..',

  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false },
    },
  },

  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // Recharts ist gross. Als eigener Chunk laedt das Dashboard schneller,
        // weil die Diagramme erst auf der Statistikseite gebraucht werden.
        manualChunks: {
          charts: ['recharts'],
          vendor: ['react', 'react-dom', 'react-router-dom'],
          supabase: ['@supabase/supabase-js'],
        },
      },
    },
  },
});
