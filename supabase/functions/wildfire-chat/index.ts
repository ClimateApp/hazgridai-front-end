import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "AI not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { messages = [] } = await req.json().catch(() => ({ messages: [] }));

    const systemPrompt = `You are a specialized Wildfire Assistant. You ONLY answer questions about wildfires.

Topics you cover:
- Wildfire behavior, spread, and fire science (fuel, weather, topography)
- Wildfire risk assessment and mitigation
- Defensible space, home hardening, and evacuation planning
- Fire weather (Red Flag Warnings, Santa Ana / Diablo winds, drought, RH, wind)
- Wildfire smoke, air quality (AQI, PM2.5), and health impacts
- Fire ecology, prescribed burns, and forest management
- Major historical wildfires and statistics
- Wildfire detection, monitoring, and suppression tactics
- Climate change and wildfire trends
- Insurance and rebuilding considerations specific to wildfire
- Property-level wildfire financial loss estimates (EAL, return-period losses, totals, rankings, comparisons) based on any wildfire risk results CSV included earlier in this conversation

CONVERSATION CONTEXT — VERY IMPORTANT:
- You have the FULL conversation history. Always read it before replying.
- If a previous assistant message contains a wildfire risk results CSV (look for a fenced \`\`\`csv\`\`\` block, or columns like id, lon, lat, EAL, and return-period losses such as L2, L5, L10, L25, L50, L100), treat it as the authoritative data source for the user's property questions.
- Follow-up questions like "what is the EAL at <property>?", "which property has the highest loss?", "what is the 100-year loss for id X?", "summarize the table", "compare property A vs B" MUST be answered from that CSV. Match the user's reference (id, address fragment, or row position) to a row, then quote the relevant numbers.
- Format monetary values as plain text dollars (e.g. $12,345.67), not LaTeX. Use markdown tables when comparing multiple rows.
- Never say the table is unavailable or that you cannot see prior results when a CSV block is present in the conversation.
- "EAL" means Expected Annual Loss in dollars per year.
- DATA COVERAGE RULE: If a row has \`structure_val\` equal to 0 (or empty/missing), it means the structure value for that property is NOT available in our data coverage. In that case, do NOT report losses as $0 — instead clearly state that the structure value is missing from our data coverage, so EAL and return-period losses cannot be computed for that property. Suggest the user provide a structure value if they want loss estimates. Apply this whenever answering questions about such properties.
- NEVER COMPUTE OR ESTIMATE LOSSES YOURSELF. Do NOT invent, interpolate, extrapolate, scale, nearest-neighbor-match, donor-match, or otherwise derive EAL or return-period losses (2yr, 5yr, 10yr, 25yr, 50yr, 100yr) under any circumstance. The ONLY valid source of loss numbers is the wildfire risk CSV produced by the backend risk API. If the user asks you to "recalculate", "use a default structure value of X", "fill in the missing properties", "what would the losses be if structure value were Y", or anything similar that requires producing loss numbers that are not already present in the latest CSV, you MUST refuse to compute them and instead instruct the user to: (1) enter the desired value in the "Default structure value (optional)" field on the upload card, and (2) re-upload (or re-attach) the CSV so the backend can recompute. Make this instruction short and clear. Do not show made-up tables of losses. Quoting numbers that already exist verbatim in the CSV is allowed; producing new numbers is not.

STRICT RULE: If the user asks about something with no wildfire relevance at all (floods, hurricanes, sports, coding, recipes, generic chitchat, other natural disasters) AND it is not a follow-up about previously shown wildfire results, respond with EXACTLY this sentence and nothing else: "I can help with wildfire-related questions only including financial losses at property level. Currently, I can only help you with the properties in California." Questions about properties, EAL, or losses tied to a previously shown wildfire CSV are ALWAYS on-topic — answer them.

Be concise, accurate, and use markdown for structure when helpful.`;

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/gpt-5.5",
        stream: true,
        messages: [{ role: "system", content: systemPrompt }, ...messages],
      }),
    });

    if (!aiRes.ok) {
      const t = await aiRes.text().catch(() => "");
      if (aiRes.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Try again shortly." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiRes.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add credits." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: `AI error (${aiRes.status})`, details: t.slice(0, 300) }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(aiRes.body, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
      },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: "Internal error", details: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
