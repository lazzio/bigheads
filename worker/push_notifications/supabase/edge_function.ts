// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const EXPO_ACCESS_TOKEN = Deno.env.get('EXPO_ACCESS_TOKEN');

if (!EXPO_ACCESS_TOKEN) {
  throw new Error("EXPO_ACCESS_TOKEN is not set");
}

console.log("Notification service started!");

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
    console.log("Processing notification request...");
    
    // Parse the webhook payload
    const payload: WebhookPayload = await req.json();
    console.log("Webhook payload:", JSON.stringify(payload, null, 2));
    
    // Only process INSERT operations (new episodes)
    if (payload.type !== 'INSERT') {
      console.log(`Ignoring ${payload.type} operation`);
      return new Response(JSON.stringify({ success: true, message: `Ignored ${payload.type} operation` }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Validate episode data
    const episode = payload.record;
    if (!episode || !episode.id || !episode.title) {
      console.error("Invalid episode data:", episode);
      return new Response(JSON.stringify({ success: false, error: 'Invalid episode data' }), {
        headers: { 'Content-Type': 'application/json' },
        status: 400
      });
    }
    
    console.log(`Processing new episode: ${episode.title} (ID: ${episode.id})`);

    // Récupération de tous les tokens d'appareils actifs
    const { data: tokens, error } = await supabase
      .from('device_tokens')
      .select('token')
      .eq('active', true);
      
    if (error) {
      console.error("Error fetching device tokens:", error);
      throw error;
    }
    
    console.log(`Found ${tokens?.length || 0} active device tokens`);

    // Check if there are any tokens
    if (tokens && tokens.length > 0) {
      console.log("Preparing notifications for devices...");
      
      const messages = tokens.map(t => ({
        to: t.token,
        title: 'Nouvel épisode disponible !',
        body: episode.title,
        data: { episodeId: episode.id },
        sound: 'default',
        priority: 'high'
      }));
      
      console.log(`Sending ${messages.length} notifications to Expo...`);
      
      // Send the notifications to Expo
      const response = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${EXPO_ACCESS_TOKEN}`,
        },
        body: JSON.stringify(messages)
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Expo API error (${response.status}):`, errorText);
        throw new Error(`Expo API error: ${response.status} - ${errorText}`);
      }
      
      const result = await response.json();
      console.log("Expo API response:", JSON.stringify(result, null, 2));
      
      // Check for any errors in the response
      if (Array.isArray(result) && result.some(r => r.status === 'error')) {
        console.warn("Some notifications failed:", result.filter(r => r.status === 'error'));
      }
      
      return new Response(JSON.stringify({ 
        success: true, 
        message: `Sent ${messages.length} notifications`,
        result 
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // No tokens found
    console.log("No active device tokens found");
    return new Response(JSON.stringify({ success: true, message: 'Aucun token actif trouvé' }), {
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error: any) {
    console.error("Edge function error:", error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: error.message || 'Unknown error',
      stack: error.stack 
    }), {
      headers: { 'Content-Type': 'application/json' },
      status: 500
    });
  }
});