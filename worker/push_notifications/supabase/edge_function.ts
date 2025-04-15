// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const EXPO_ACCESS_TOKEN = Deno.env.get('EXPO_ACCESS_TOKEN');

if (!EXPO_ACCESS_TOKEN) {
  throw new Error("EXPO_ACCESS_TOKEN is not set");
}

console.log("Notification stated!");

interface Episode {
  id: string;
  title: string;
  publication_date: string;
}

interface WebhookPayload {
  type: 'INSERT';
  table: string;
  record: Episode;
  schema: 'public';
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

Deno.serve(async (req) => {
  try {
    // Récupération de tous les tokens d'appareils actifs
    const { data: tokens, error } = await supabase
      .from('device_tokens')
      .select('token')
      .eq('active', true);
      
    if (error) throw error;
    
    const payload: WebhookPayload = await req.json();
    const episode = payload.record;
    
    // Send notifications to all active devices
    // Check if there are any tokens
    // and if the payload is of type 'INSERT'
    if (tokens && tokens.length > 0) {
      const messages = tokens.map(t => ({
        to: t.token,
        title: 'Nouvel épisode disponible !',
        body: episode.title,
        data: { episodeId: episode.id }
      }));
      
      // Send the notifications to Expo
      const response = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${EXPO_ACCESS_TOKEN}`,
        },
        body: JSON.stringify(messages)
      });
      
      const result = await response.json();
      return new Response(JSON.stringify({ success: true, result }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // No token found
    return new Response(JSON.stringify({ success: true, message: 'Aucun token trouvé' }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      headers: { 'Content-Type': 'application/json' },
      status: 500
    });
  }
});
