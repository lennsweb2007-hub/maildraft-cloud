import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Vite-Konfiguration fuer die Cloud-Fassung.
 *
 * Das Ergebnis landet in client/dist und wird von Vercel als statische Seite
 * ausgeliefert. Die API laeuft unter derselben Adresse auf /api - deshalb
 * braucht der Client keine Basis-URL und es gibt keine CORS-Fragen.
 *
 * Fuer die lokale Entwicklung leitet der Proxy /api standardmaessig an
 * "vercel dev" auf Port 3000 weiter. Wer nur an der Oberflaeche arbeitet,
 * braucht dafuer keinen lokalen Funktions-Server: DEV_API_TARGET auf die
 * bereitgestellte Adresse setzen, dann laeuft die Oberflaeche lokal gegen die
 * echte API. Aenderungen wirken dabei auf echte Daten - beim blossen Ansehen
 * unkritisch, beim Ausprobieren von Loeschen und Senden nicht.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '..', '');
  const apiZiel = env.DEV_API_TARGET || 'http://127.0.0.1:3000';

  return {
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
      /* changeOrigin ist noetig, sobald das Ziel nicht localhost ist: Vercel
         waehlt das Projekt anhand des Host-Kopfes aus. */
      '/api': { target: apiZiel, changeOrigin: true },
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
  };
});
