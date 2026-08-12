/**
 * Supabase-Client im Browser.
 *
 * Verwendet ausschliesslich den oeffentlichen anon-Key - der darf im Browser
 * liegen, weil er allein nichts erlaubt: Erst das Anmelde-Token bestimmt, was
 * ein Nutzer sieht, und Row Level Security setzt das in der Datenbank durch.
 *
 * Der Service-Role-Key hat hier nichts zu suchen und ist deshalb in den
 * Umgebungsvariablen bewusst OHNE das Praefix VITE_ hinterlegt - Vite nimmt
 * nur Werte mit diesem Praefix in das Bundle auf.
 */

import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'VITE_SUPABASE_URL oder VITE_SUPABASE_ANON_KEY fehlen. ' +
      'In Vercel unter Settings > Environment Variables eintragen und neu bereitstellen.'
  );
}

export const supabase = createClient(url, anonKey, {
  auth: {
    // Die Sitzung soll einen Neustart des Browsers ueberleben.
    persistSession: true,
    autoRefreshToken: true,
    // Nach der Anmeldung kommt das Token im URL-Fragment zurueck - Supabase
    // liest es dort aus und raeumt die Adresszeile auf.
    detectSessionInUrl: true,
  },
});

/** Aktuelles Anmelde-Token, oder null. */
export async function holeToken() {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/** Meldet ueber Google an. */
export async function anmeldenMitGoogle() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${window.location.origin}/dashboard` },
  });
  if (error) throw new Error(error.message);
}

/** Meldet ab. */
export async function abmelden() {
  await supabase.auth.signOut();
}
