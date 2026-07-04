import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { input } = await req.json();

    if (!input || input.length < 3) {
      return new Response(
        JSON.stringify({ predictions: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const GOOGLE_API_KEY = Deno.env.get("GOOGLE_GEOCODING_API_KEY");

    if (!GOOGLE_API_KEY) {
      console.error("GOOGLE_GEOCODING_API_KEY is not configured");
      return new Response(
        JSON.stringify({ error: "API key not configured", predictions: [] }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Places autocomplete (New) request for:", input);

    // Places API (New) - Autocomplete
    const response = await fetch(
      "https://places.googleapis.com/v1/places:autocomplete",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": GOOGLE_API_KEY,
        },
        body: JSON.stringify({
          input,
          includedPrimaryTypes: ["street_address", "premise", "subpremise", "route"],
          includedRegionCodes: ["us"],
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("Places API (New) error:", response.status, JSON.stringify(data));
      return new Response(
        JSON.stringify({ error: data?.error?.message || "Places API error", predictions: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const predictions = (data.suggestions || [])
      .filter((s: any) => s.placePrediction)
      .map((s: any) => ({
        description: s.placePrediction.text?.text || "",
        place_id: s.placePrediction.placeId,
      }));

    console.log(`Found ${predictions.length} predictions`);

    return new Response(
      JSON.stringify({ predictions }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Places autocomplete error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error", predictions: [] }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
