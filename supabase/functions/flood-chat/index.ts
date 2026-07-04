import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FLOOD_API_BASE = "http://44.204.31.84:8000/raster/value";

// Geocode an address using Google Geocoding API
async function geocodeAddress(address: string): Promise<{ lon: number; lat: number } | null> {
  const GOOGLE_API_KEY = Deno.env.get("GOOGLE_GEOCODING_API_KEY");
  if (!GOOGLE_API_KEY) {
    console.error("GOOGLE_GEOCODING_API_KEY is not configured");
    return null;
  }

  const encodedAddress = encodeURIComponent(address);
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodedAddress}&key=${GOOGLE_API_KEY}`;
  
  console.log("Geocoding address:", address);
  
  try {
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.status === "OK" && data.results?.[0]?.geometry?.location) {
      const location = data.results[0].geometry.location;
      console.log("Geocoded result:", location);
      return { lon: location.lng, lat: location.lat };
    } else {
      console.error("Geocoding failed:", data.status, data.error_message);
      return null;
    }
  } catch (error) {
    console.error("Geocoding error:", error);
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authentication check
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      console.error("No authorization header provided");
      return new Response(
        JSON.stringify({ error: 'Authorization required. Please log in to use this service.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace('Bearer ', '');
    const { data: claimsData, error: claimsError } = await supabaseClient.auth.getClaims(token);
    
    if (claimsError || !claimsData?.claims) {
      console.error("JWT validation failed:", claimsError);
      return new Response(
        JSON.stringify({ error: 'Invalid or expired session. Please log in again.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userId = claimsData.claims.sub;
    console.log("Authenticated user:", userId);

    const { messages, stream: shouldStream, streamSpeed = "normal" } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    // Build conversation history for context
    const conversationHistory = messages.map((m: any) => ({
      role: m.role,
      content: m.content
    }));

    // Use AI to extract coordinates OR address with full conversation context
    const extractionResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/gpt-5.5",
        messages: [
          {
            role: "system",
            content: `You are a flood risk analysis assistant. You help users find flood levels at specific coordinates or addresses.

IMPORTANT: You have access to the full conversation history. Use it to understand context and follow-up questions.

**Your capabilities:**
1. Extract coordinates OR addresses and fetch flood data
2. Explain flood terminology and metrics
3. Answer questions about your data sources and methodology
4. Answer general flood risk questions using FEMA, NOAA, and other authoritative sources
5. Answer follow-up questions about specific return periods from previous results
6. Have natural conversations about flood risk

**Response format - respond ONLY with valid JSON:**

If coordinates are found or can be inferred:
{"lon": <number>, "lat": <number>}

If an ADDRESS is provided (street address, city, place name, etc.):
{"address": "<the full address to geocode>"}

If user greets you:
{"greeting": true}

If user asks about a SPECIFIC RETURN PERIOD from previous results (e.g., "what about the 100-year?", "tell me about 50-year risk", "what is the risk for 100-year for this property?"):
{"followup_period": true, "period": "<the return period they're asking about, e.g., '100-year'>", "question": "<their full question>"}

If user asks to explain previous results or asks about flood terminology:
{"explain": true, "topic": "<what they want explained>"}

If user asks about RISK at a SPECIFIC LOCATION (with address or coordinates):
-> Extract the location and return coordinates or address (see above)

If user asks a GENERAL question about flood risk (not location-specific) such as:
- "What is flood risk?"
- "How do I reduce flood risk?"
- "What are flood zones?"
- "How does FEMA determine flood risk?"
- "What is a 100-year flood?" (when NO previous location was discussed)
- "How do I prepare for flooding?"
{"general_risk": true, "question": "<the user's question>"}

If user asks about your references, methodology, data sources, how you work, or any conversational question:
{"general": true, "question": "<the user's question>"}

If the conversation contains a fenced \`\`\`csv\`\`\` block (uploaded flood results CSV) AND the user's question refers to "the table", "the results", "the csv", "this property", "which property", "highest", "lowest", "average", "compare", a property id, or any column/value visible in that CSV — treat it as a CSV follow-up:
{"csv_question": true, "question": "<the user's question>"}

If user asks something completely unrelated (like jokes, recipes, sports, etc.):
{"off_topic": true}

If the user's question is ambiguous, unclear, or you're not sure what they want:
{"unclear": true, "original_question": "<what they asked>"}

If you cannot find/infer coordinates or address in a location-seeking query:
{"error": "Could not extract location. Please provide an address or longitude/latitude values."}

**Examples:**
- "What's the flood level at -80.13493, 25.85401?" -> {"lon": -80.13493, "lat": 25.85401}
- "Check lon -80.5 lat 26.2" -> {"lon": -80.5, "lat": 26.2}
- "Flood risk at 123 Main Street, Miami, FL" -> {"address": "123 Main Street, Miami, FL"}
- "Check 500 Brickell Ave Miami" -> {"address": "500 Brickell Ave, Miami, FL"}
- "What about downtown Fort Lauderdale?" -> {"address": "Downtown Fort Lauderdale, FL"}
- "What does damage ratio mean?" -> {"explain": true, "topic": "damage ratio"}
- "Explain the results" -> {"explain": true, "topic": "flood results"}
- "What is the risk of 100-year for this property?" -> {"followup_period": true, "period": "100-year", "question": "What is the risk of 100-year for this property?"}
- "Tell me about the 50-year flood risk" -> {"followup_period": true, "period": "50-year", "question": "Tell me about the 50-year flood risk"}
- "What about 200-year?" -> {"followup_period": true, "period": "200-year", "question": "What about 200-year?"}
- "What is your reference for this?" -> {"general": true, "question": "What is your reference for this?"}
- "Where does your data come from?" -> {"general": true, "question": "Where does your data come from?"}
- "How accurate is this?" -> {"general": true, "question": "How accurate is this?"}
- "What is flood risk?" -> {"general_risk": true, "question": "What is flood risk?"}
- "How can I protect my home from flooding?" -> {"general_risk": true, "question": "How can I protect my home from flooding?"}
- "What are the different flood zones?" -> {"general_risk": true, "question": "What are the different flood zones?"}
- "Which property has the highest loss?" (CSV present) -> {"csv_question": true, "question": "Which property has the highest loss?"}
- "Summarize the table" (CSV present) -> {"csv_question": true, "question": "Summarize the table"}
- "What is the depth at property 5?" (CSV present) -> {"csv_question": true, "question": "What is the depth at property 5?"}
- "Hello" -> {"greeting": true}
- "Tell me a joke" -> {"off_topic": true}
- "Can you help me?" -> {"unclear": true, "original_question": "Can you help me?"}
- "What do you think?" -> {"unclear": true, "original_question": "What do you think?"}
- "Is it bad?" -> {"unclear": true, "original_question": "Is it bad?"}`
            },
            ...conversationHistory
          ],
        }),
      });

    if (!extractionResponse.ok) {
      const errorText = await extractionResponse.text();
      console.error("AI extraction error:", extractionResponse.status, errorText);
      throw new Error("Failed to process your request");
    }

    const extractionData = await extractionResponse.json();
    const extractedText = extractionData.choices?.[0]?.message?.content || "";
    
    console.log("Extracted text:", extractedText);

    let parsedExtraction;
    try {
      // Clean the response - remove markdown code blocks if present
      const cleanedText = extractedText.replace(/```json\n?|\n?```/g, '').trim();
      parsedExtraction = JSON.parse(cleanedText);
    } catch (e) {
      console.error("Failed to parse extraction:", e);
      // If parsing fails, treat it as a general question and let the AI respond
      parsedExtraction = { general: true, question: "general inquiry" };
    }

    // If an address was extracted, geocode it first
    if (parsedExtraction.address) {
      console.log("Address detected, geocoding:", parsedExtraction.address);
      const geocoded = await geocodeAddress(parsedExtraction.address);
      
      if (geocoded) {
        // Replace address with coordinates
        parsedExtraction = { 
          lon: geocoded.lon, 
          lat: geocoded.lat,
          originalAddress: parsedExtraction.address 
        };
      } else {
        parsedExtraction = { 
          error: `I couldn't find the location for "${parsedExtraction.address}". Please try a more specific address or provide coordinates directly.` 
        };
      }
    }

    let responseMessage = "";

    if (parsedExtraction.greeting) {
      responseMessage = `Hello! I'm a flood risk analysis assistant. I help you find flood levels at any location.

You can provide either an **address** or **coordinates**:
• "What's the flood risk at 123 Main Street, Miami, FL?"
• "Check flood level at -80.13493, 25.85401"
• "Flood risk for 500 Brickell Ave, Miami"

I'll analyze the flood data and provide you with:
- **Water Level** - The flood water elevation in feet
- **Ground Elevation** - Height of the ground surface (NAVD88)
- **Foundation Height** - Building's first floor height above ground
- **Depth Above FFE** - Water depth above the first floor
- **Damage Ratio** - Estimated structural damage percentage

You can also ask me to explain any of these terms!`;
    } else if (parsedExtraction.explain) {
      const topic = parsedExtraction.topic?.toLowerCase() || "";
      if (topic.includes("damage ratio")) {
        responseMessage = `**Damage Ratio** represents the estimated percentage of structural damage to a building based on flood depth.

It's calculated using depth-damage functions from FEMA/USACE that consider:
- How deep the water is above the first floor
- Building type (single-story vs multi-story)
- Construction materials

**Risk Levels:**
- 🟢 **0-20%**: Minor damage (cleanup, drying)
- 🟡 **20-40%**: Moderate damage (flooring, drywall replacement)
- 🟠 **40-60%**: Significant damage (major repairs needed)
- 🔴 **>60%**: Severe damage (potential total loss)`;
      } else if (topic.includes("ffe") || topic.includes("first floor")) {
        responseMessage = `**Depth Above FFE (First Floor Elevation)** measures how high floodwater rises above a building's first floor.

**Calculation:** Water Level - Ground Elevation - Foundation Height = Depth Above FFE

A positive value means water enters the building. Higher values mean deeper flooding and more damage.`;
      } else if (topic.includes("ground") || topic.includes("elevation")) {
        responseMessage = `**Ground Elevation** is the height of the land surface at the building location, measured in feet above sea level (NAVD88 datum).

This is a key factor in determining flood risk - lower elevations are more prone to flooding.`;
      } else if (topic.includes("foundation")) {
        responseMessage = `**Foundation Height** is the height of the building's first floor above the ground level.

Buildings with higher foundations (like those on stilts or raised foundations) have better flood protection since water must rise higher before entering the living space.`;
      } else {
        // Open-ended explanation / analytical follow-up — use full conversation history
        const explainResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "openai/gpt-5.5",
            messages: [
              {
                role: "system",
                content: `You are a flood risk analyst. The user is asking an analytical or explanatory follow-up question about the previous flood analysis results in this conversation (topic: "${parsedExtraction.topic}").

Use the FULL conversation history as the source of truth — including any property profile tables, return-period tables, and uploaded \`\`\`csv\`\`\` results. Reference specific numbers (water levels, depths, damage ratios, losses, return periods, property ids) from the prior assistant messages when explaining.

If the question is about why certain values look similar/different across points or return periods, reason about it using the actual numbers shown plus general flood-frequency knowledge (e.g. 2-year events are common/low-magnitude so values cluster; spatial resolution of the raster; shared floodplain; rounding).

**Formatting rules:**
- LaTeX only for math/formulas/Greek letters (inline $...$, block $$...$$). Never wrap currency in LaTeX — write $12,345 as plain text.
- Use markdown. Keep it concise and concrete.
- Do NOT say the data is unavailable when it's present in the conversation history.`
              },
              ...conversationHistory
            ],
          }),
        });

        if (explainResponse.ok) {
          const explainData = await explainResponse.json();
          responseMessage = explainData.choices?.[0]?.message?.content || "I couldn't generate an explanation. Please rephrase your question.";
        } else {
          responseMessage = "I'm having trouble processing your question. Please try again.";
        }
      }
    } else if (parsedExtraction.followup_period) {
      // Handle follow-up questions about specific return periods using conversation context
      const periodResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "openai/gpt-5.5",
          messages: [
            {
              role: "system",
              content: `You are a flood risk analysis assistant. The user is asking about a specific return period from previously shown flood analysis results.

**Your task:**
Look at the conversation history to find the most recent flood analysis results. Then answer the user's question focusing on the specific return period they mentioned (${parsedExtraction.period}).

**CRITICAL - Formatting Rules:**

1. **LaTeX Math Formatting** (for formulas, variables, equations ONLY):
   - Inline math: $variable$ or $equation$
   - Display/block math: $$equation$$
   - Examples: $P(N=k)$, $\\lambda$, $\\sigma$, $e^{-\\lambda}$, $\\frac{a}{b}$
   - Greek letters: $\\alpha$, $\\beta$, $\\lambda$, $\\sigma$, $\\mu$, $\\pi$

2. **NEVER use LaTeX for currency or monetary values!**
   - WRONG: $\\$7{,}814{,}195$ or $7,814,195$
   - CORRECT: $7,814,195 (plain text with dollar sign)
   - Currency should always be plain text: $100,000, $1,234.56

**Response guidelines:**
- Extract the relevant data for that specific return period from the previous results
- Focus on Water Level, Depth Above FFE, Damage Ratio, Groundup Loss, and Gross Loss for that period
- Explain what these values mean for the property's risk
- When explaining probability or statistics, use LaTeX: e.g., "The annual exceedance probability is $P = \\frac{1}{T}$ where $T$ is the return period"
- Use the damage ratio to characterize the risk level:
  - 🟢 0-25%: Low risk - minor damage expected
  - 🟡 25-50%: Moderate risk - significant repairs needed  
  - 🔴 >50%: High risk - severe damage, potential total loss
- Keep the response focused and concise
- If the 100-year flood is mentioned, note it's FEMA's standard for flood zone mapping

**Example response format:**
"For the **100-year flood** at this property:
- **Water Level**: X.XX ft
- **Depth Above FFE**: X.XX ft  
- **Damage Ratio**: 🟡 XX.X%
- **Groundup Loss**: $123,456
- **Gross Loss**: $100,000

This means [interpretation of risk based on the values]..."`
            },
            ...conversationHistory
          ],
        }),
      });

      if (periodResponse.ok) {
        const periodData = await periodResponse.json();
        responseMessage = periodData.choices?.[0]?.message?.content || "I couldn't find the previous flood analysis results. Please query a location first.";
      } else {
        responseMessage = "I'm having trouble processing your question. Please try again.";
      }
    } else if (parsedExtraction.general_risk) {
      // Handle general flood risk questions using FEMA/NOAA knowledge
      const riskResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "openai/gpt-5.5",
          messages: [
            {
              role: "system",
              content: `You are a flood risk expert assistant. Answer questions about flood risk using authoritative sources.

**CRITICAL - Formatting Rules:**

1. **LaTeX Math Formatting** (for formulas, variables, equations ONLY):
   - Inline math: $variable$ or $equation$
   - Display/block math: $$equation$$
   - Examples: $P(N=k) = e^{-\\lambda} \\frac{\\lambda^k}{k!}$
   - Greek letters: $\\alpha$, $\\beta$, $\\lambda$, $\\sigma$, $\\mu$, $\\pi$, $\\theta$
   - Fractions: $\\frac{1}{T}$ where $T$ is the return period

2. **NEVER use LaTeX for currency or monetary values!**
   - WRONG: $\\$100{,}000$ or $100,000$
   - CORRECT: $100,000 (plain text with dollar sign)
   - Currency should always be plain text: $100,000, $1,234.56

**Your knowledge sources:**
- FEMA (Federal Emergency Management Agency) - Flood zones, flood insurance, NFIP, flood maps
- NOAA (National Oceanic and Atmospheric Administration) - Weather, storm surge, climate data
- USACE (US Army Corps of Engineers) - Flood control, levees, depth-damage functions
- EPA (Environmental Protection Agency) - Floodplain management, environmental impacts

**Key topics you can explain:**
1. **Flood Zones**: A, AE, AH, AO, V, VE, X, D zones and what they mean
2. **Flood Insurance**: NFIP, coverage options, requirements, costs
3. **100-Year Flood**: Annual exceedance probability $P = \\frac{1}{100} = 0.01$ (1% annual chance)
4. **Flood Mitigation**: Elevation, barriers, flood-proofing, drainage
5. **Climate & Flooding**: Sea level rise, increased precipitation, changing patterns
6. **Flood Preparedness**: Emergency planning, evacuation, property protection
7. **Flood Frequency Analysis**: Poisson distribution $N \\sim \\text{Poisson}(\\lambda)$, Gumbel distribution

**Guidelines:**
- Cite sources when appropriate (e.g., "According to FEMA...")
- Use markdown formatting for readability
- Use LaTeX for math formulas ONLY, not for currency
- Be informative but concise
- If discussing risk at a property, remind users they can ask about a specific location
- Focus on education and actionable information`
            },
            ...conversationHistory
          ],
        }),
      });

      if (riskResponse.ok) {
        const riskData = await riskResponse.json();
        responseMessage = riskData.choices?.[0]?.message?.content || "I'm not sure how to answer that. Could you rephrase your question?";
      } else {
        responseMessage = "I'm having trouble processing your question. Please try again.";
      }
    } else if (parsedExtraction.general) {
      // Handle general questions with a second AI call for natural response
      const generalResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "openai/gpt-5.5",
          messages: [
            {
              role: "system",
              content: `You are a helpful flood risk analysis assistant. Answer the user's question naturally and conversationally.

**CRITICAL - Formatting Rules:**

1. **LaTeX Math Formatting** (for formulas, variables, equations ONLY):
   - Inline math: $variable$ or $equation$
   - Display/block math: $$equation$$
   - Examples: $P = \\frac{1}{T}$, $\\lambda$, $\\sigma$, $e^{-x}$
   - Greek letters: $\\alpha$, $\\beta$, $\\lambda$, $\\sigma$, $\\mu$

2. **NEVER use LaTeX for currency or monetary values!**
   - WRONG: $\\$100{,}000$ or $100,000$
   - CORRECT: $100,000 (plain text with dollar sign)

**Your data sources and methodology:**
- Flood water levels come from FEMA Flood Insurance Rate Maps (FIRMs) and Base Flood Elevation (BFE) data
- Building information uses the FEMA National Structure Inventory (NSI)
- Damage calculations use USACE/FEMA depth-damage functions
- Ground elevations are from USGS National Elevation Dataset (NED)
- Analysis assumes 100-year flood scenario (1% annual chance, $P = 0.01$)

**Keep responses concise but informative. Use markdown for formatting. Use LaTeX for math formulas ONLY, not for currency.**`
            },
            ...conversationHistory
          ],
        }),
      });

      if (generalResponse.ok) {
        const generalData = await generalResponse.json();
        responseMessage = generalData.choices?.[0]?.message?.content || "I'm not sure how to answer that. Could you rephrase your question?";
      } else {
        responseMessage = "I'm having trouble processing your question. Please try again.";
      }
    } else if (parsedExtraction.csv_question) {
      // Answer questions about uploaded CSV results table
      const csvResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "openai/gpt-5.5",
          messages: [
            {
              role: "system",
              content: `You are a flood risk analyst. The conversation contains a fenced \`\`\`csv\`\`\` block with flood analysis results for multiple properties. Typical columns include: id, lon, lat, water_level_{2,5,10,25,50,100,200,500}_year, depth_above_FFE_{...}_year, damage_ratio_{...}_year, found_ht, ground_elv, num_stories, val_struct.

Answer the user's question using that CSV as the source of truth. Be concise and concrete.

**Loss calculations — you CAN and SHOULD compute these from the CSV:**
- **Groundup Loss** for return period T = (damage_ratio_T_year / 100) × val_struct
- **Gross Loss** for return period T = max(0, min(Groundup Loss − Deductible, Policy Limit))
- If Deductible / Policy Limit are not provided in conversation, ASSUME reasonable defaults: Deductible = $1,000, Policy Limit = $100,000 (or 100% of val_struct if smaller). Clearly state the assumed values once at the top of your answer.
- When the user asks for groundup and/or gross loss for a return period, ALWAYS output BOTH columns. Table columns must be EXACTLY: id | lon | lat | Groundup Loss | Gross Loss — one row per property. Do NOT include val_struct or damage_ratio columns in the output table.
- Do NOT refuse on the grounds that "groundup/gross loss columns aren't in the CSV" — derive them from damage_ratio and val_struct.

**Formula formatting (CRITICAL):**
- When showing math formulas, ALWAYS use LaTeX block equations delimited by $$...$$ on their own lines. NEVER use \\(...\\) or \\[...\\] — those will render as raw text in this UI.
- Each formula on its own line, surrounded by blank lines. Example:

$$\\text{Groundup Loss} = \\frac{\\text{damage\\_ratio\\_100\\_year}}{100} \\times \\text{val\\_struct}$$

$$\\text{Gross Loss} = \\max\\left(0,\\ \\min(\\text{Groundup Loss} - \\text{Deductible},\\ \\text{Policy Limit})\\right)$$

**Rules:**
- Treat the CSV as authoritative. Do NOT say data is unavailable when it can be derived.
- Reference rows by id when relevant.
- Use markdown tables for comparisons, rankings, or per-property loss results.
- Currency in plain text ($12,345). LaTeX only for math formulas/variables, always wrapped in $$...$$ blocks.
- If a column the user asks about truly isn't in the CSV and cannot be derived, say so and list the available columns.`
            },
            ...conversationHistory
          ],
        }),
      });

      if (csvResponse.ok) {
        const csvData = await csvResponse.json();
        responseMessage = csvData.choices?.[0]?.message?.content || "I couldn't read the results table. Please try rephrasing.";
      } else {
        responseMessage = "I'm having trouble analyzing the table right now. Please try again.";
      }
    } else if (parsedExtraction.unclear) {
      // Ask clarifying questions when intent is unclear
      responseMessage = `I want to make sure I understand your question correctly. Could you clarify what you'd like to know?

**I can help you with:**
• 🏠 **Check flood risk** - Provide an address or coordinates (e.g., "123 Main St, Miami, FL")
• 📊 **Explain a metric** - Ask about damage ratio, water level, FFE, etc.
• ❓ **Answer flood questions** - General questions about flood zones, insurance, preparation
• 📈 **Analyze specific results** - Ask about a return period from previous results

What would you like to explore?`;
    } else if (parsedExtraction.off_topic) {
      responseMessage = `I'm specialized in flood risk analysis. I can help you with:

• 🏠 Finding flood levels at any location
• 📊 Explaining flood metrics (damage ratio, elevations, etc.)
• ❓ Answering general flood risk questions
• 📈 Interpreting flood risk results

Please provide an address or coordinates, like: "123 Main St, Miami, FL" or "-80.13493, 25.85401"`;
    } else if (parsedExtraction.error) {
      responseMessage = parsedExtraction.error;
    } else if (parsedExtraction.lon !== undefined && parsedExtraction.lat !== undefined) {
      // Call the flood API
      const floodUrl = `${FLOOD_API_BASE}?raster_path=./rasters/static_8band_100m.tif&lon=${parsedExtraction.lon}&lat=${parsedExtraction.lat}`;
      console.log("Calling flood API:", floodUrl);
      
      try {
        const floodResponse = await fetch(floodUrl);
        
        if (!floodResponse.ok) {
          throw new Error(`Flood API returned status ${floodResponse.status}`);
        }
        
        const floodData = await floodResponse.json();
        console.log("Flood API response:", floodData);
        
        // Build location string with address if available
        const locationStr = parsedExtraction.originalAddress 
          ? `${parsedExtraction.originalAddress}\n📌 Coordinates: ${parsedExtraction.lon.toFixed(5)}, ${parsedExtraction.lat.toFixed(5)}`
          : `Longitude ${parsedExtraction.lon}, Latitude ${parsedExtraction.lat}`;
        
        // Return periods in order (index 0-7): 2, 5, 10, 25, 50, 100, 200, 500 year
        const returnPeriodLabels = ["2-Year", "5-Year", "10-Year", "25-Year", "50-Year", "100-Year", "200-Year", "500-Year"];
        
        // API returns all three as arrays indexed 0-7
        const waterLevelArr = floodData.water_level;
        const depthAboveFFEArr = floodData.depth_above_FFE;
        const damageRatioArr = floodData.damage_ratio;
        const foundHt = floodData.found_ht;
        const groundElv = floodData.ground_elv;
        const numStories = floodData.num_stories;
        const valStruct = floodData.val_struct;
        
        console.log("Water Level Array:", waterLevelArr);
        console.log("Depth Above FFE Array:", depthAboveFFEArr);
        console.log("Damage Ratio Array:", damageRatioArr);
        
        // Check if we have valid water level data
        const hasWaterLevelData = Array.isArray(waterLevelArr) && 
          waterLevelArr.some(v => v !== null && v !== undefined && v !== "null" && v !== "None");

        // Check if we have property data (ground elevation, foundation height, etc.)
        const hasPropertyData = groundElv !== null && groundElv !== undefined && 
          foundHt !== null && foundHt !== undefined;

        if (!hasWaterLevelData) {
          responseMessage = `📍 **Location**: ${locationStr}

The given location does not have any flooding.`;
        } else if (!hasPropertyData) {
          // We have water level data but no property/building data
          responseMessage = `📍 **Location**: ${locationStr}

⚠️ **There is no property at the location you entered.**

This location has flood water level data available, but no building or property information was found. This could mean:
- The coordinates are in an undeveloped area
- The location is outside our property database coverage
- The building data is not yet available for this address

Please verify the address or coordinates and try again.`;
        } else {
          // Build the table rows from arrays
          let tableRows = "";
          for (let i = 0; i < 8; i++) {
            const label = returnPeriodLabels[i];
            
            // Access all values by array index
            const wl = waterLevelArr[i];
            const dffe = depthAboveFFEArr[i];
            const dr = damageRatioArr[i];
            
            // Format values - handle null/undefined
            const wlStr = (wl !== null && wl !== undefined && wl !== "null" && wl !== "None") 
              ? `${Number(wl).toFixed(2)} ft` : "N/A";
            const dffeStr = (dffe !== null && dffe !== undefined && dffe !== "null" && dffe !== "None") 
              ? `${Number(dffe).toFixed(2)} ft` : "N/A";
            
            // Format damage ratio with color-coded risk indicator
            let drStr = "N/A";
            let groundupLossStr = "N/A";
            let grossLossStr = "N/A";
            const deductible = 1000;
            const policyLimit = 100000;
            
            if (dr !== null && dr !== undefined && dr !== "null" && dr !== "None") {
              const drValue = Number(dr);
              let riskIndicator = "🟢"; // Green for low risk (0-25%)
              if (drValue > 50) {
                riskIndicator = "🔴"; // Red for high risk (>50%)
              } else if (drValue > 25) {
                riskIndicator = "🟡"; // Yellow for moderate risk (25-50%)
              }
              drStr = `${riskIndicator} ${drValue.toFixed(1)}%`;
              
              // Calculate Groundup Loss = Damage Ratio × Replacement Value
              if (valStruct !== null && valStruct !== undefined) {
                const groundupLoss = (drValue / 100) * Number(valStruct);
                groundupLossStr = '$' + groundupLoss.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
                
                // Calculate Gross Loss = min(Groundup Loss - Deductible, Policy Limit)
                const grossLoss = Math.max(0, Math.min(groundupLoss - deductible, policyLimit));
                grossLossStr = '$' + grossLoss.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
              }
            }
            
            tableRows += `| ${label} | ${wlStr} | ${dffeStr} | ${drStr} | ${groundupLossStr} | ${grossLossStr} |\n`;
          }

          responseMessage = `📍 **Location**: ${locationStr}

---

# Property Profile

| Attribute | Value |
|-----------|-------|
| **Building Type** | ${numStories === 'singlestory' ? 'Single-Story' : numStories === 'multistory' ? 'Multi-Story' : numStories} |
| **Ground Elevation** | ${groundElv.toFixed(2)} ft (NAVD88) |
| **Foundation Height** | ${foundHt} ft |
| **First Floor Elevation** | ${(groundElv + foundHt).toFixed(2)} ft |
| **Replacement Value** | ${valStruct !== null && valStruct !== undefined ? '$' + Number(valStruct).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) : 'N/A'} |
| **Deductible** | $1,000 |
| **Policy Limit** | $100,000 |

---

# Flood Risk by Return Period

| Return Period | Water Level | Depth Above FFE | Damage Ratio | Groundup Loss ($) | Gross Loss ($) |
|---------------|-------------|-----------------|--------------|-------------------|----------------|
${tableRows}
*FFE = First Floor Elevation*`;
        }
      } catch (floodError) {
        console.error("Flood API error:", floodError);
        responseMessage = `I found your coordinates (${parsedExtraction.lon}, ${parsedExtraction.lat}), but I couldn't retrieve the flood data at this moment. Please try again in a few seconds.`;
      }
    } else {
      responseMessage = "I couldn't understand your request. Please provide coordinates like: -80.13493, 25.85401";
    }

    // If streaming is requested, send response as SSE chunks
    if (shouldStream) {
      // Speed settings: chunk size and delay
      const speedConfig = {
        slow: { chunkSize: 3, delay: 30 },
        normal: { chunkSize: 8, delay: 10 },
        fast: { chunkSize: 20, delay: 2 },
      };
      const config = speedConfig[streamSpeed as keyof typeof speedConfig] || speedConfig.normal;
      
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          // Stream the response with configurable speed
          for (let i = 0; i < responseMessage.length; i += config.chunkSize) {
            const chunk = responseMessage.slice(i, i + config.chunkSize);
            const sseData = `data: ${JSON.stringify({
              choices: [{ delta: { content: chunk } }]
            })}\n\n`;
            controller.enqueue(encoder.encode(sseData));
            // Configurable delay between chunks
            await new Promise(resolve => setTimeout(resolve, config.delay));
          }
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        }
      });

      return new Response(stream, {
        headers: { 
          ...corsHeaders, 
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive"
        },
      });
    }

    // Non-streaming response (legacy)
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              role: "assistant",
              content: responseMessage,
            },
          },
        ],
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (e) {
    console.error("Chat error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
