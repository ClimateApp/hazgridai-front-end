// Proxies CSV uploads to the wildfire risk API (which is HTTP-only and not CORS-enabled).
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-api-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Expose-Headers": "content-disposition",
};

const UPSTREAM = "http://34.203.215.187:8000/risk/csv";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ detail: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return new Response(
        JSON.stringify({ detail: "Missing 'file' form field" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const fwd = new FormData();
    fwd.append("file", file, file.name || "input.csv");

    // Forward optional default_structure_val only when the client supplied a non-empty value.
    const dsv = form.get("default_structure_val");
    if (typeof dsv === "string" && dsv.trim() !== "") {
      fwd.append("default_structure_val", dsv.trim());
    }

    const headers: Record<string, string> = {};
    const apiKey = req.headers.get("x-api-key") || Deno.env.get("WILDFIRE_API_KEY");
    if (apiKey) headers["X-API-Key"] = apiKey;

    const upstream = await fetch(UPSTREAM, {
      method: "POST",
      headers,
      body: fwd,
    });

    const body = await upstream.arrayBuffer();
    const outHeaders = new Headers(corsHeaders);
    const ct = upstream.headers.get("content-type");
    if (ct) outHeaders.set("Content-Type", ct);
    const cd = upstream.headers.get("content-disposition");
    if (cd) outHeaders.set("Content-Disposition", cd);

    return new Response(body, { status: upstream.status, headers: outHeaders });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Proxy error";
    return new Response(JSON.stringify({ detail: message }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
