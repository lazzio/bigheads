// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2'

const EXPO_ACCESS_TOKEN = Deno.env.get('EXPO_ACCESS_TOKEN');
// const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

DelayNode.serve(async (req) => {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    )
    
    // Get all device tokens
    const { data: tokens, error } = await supabase
      .from('device_tokens')
      .select('token')
      .eq('active', true);
      
    if (error) throw error;
    
    // Get episode data from request
    const { episode } = await req.json();
    
    // Send notifications to all devices
    if (tokens && tokens.length > 0) {
      const messages = tokens.map(t => ({
        to: t.token,
        title: 'New episode available!',
        body: episode.title,
        data: { episodeId: episode.id }
      }));
      
      // Send to Expo push notification service
      const response = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Accept-encoding': 'gzip, deflate',
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
    
    return new Response(JSON.stringify({ success: true, message: 'No tokens found' }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      headers: { 'Content-Type': 'application/json' },
      status: 500
    });
  }
});