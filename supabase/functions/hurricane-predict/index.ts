import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { BlobReader, ZipReader, Uint8ArrayWriter } from "https://esm.sh/@zip.js/zip.js@2.7.45";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const API_BASE = "http://98.88.30.73:8000";

const contentTypeFor = (name: string) => {
  if (name.endsWith(".csv")) return "text/csv";
  if (name.endsWith(".tif") || name.endsWith(".tiff")) return "image/tiff";
  if (name.endsWith(".json")) return "application/json";
  if (name.endsWith(".txt")) return "text/plain";
  return "application/octet-stream";
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData?.user) return json({ error: "Unauthorized" }, 401);
    const userId = userData.user.id;

    const url = new URL(req.url);
    const action = url.searchParams.get("action") || "submit";

    // ---------- CHAT (conversational assistant) ----------
    if (action === "chat") {
      const body = await req.json().catch(() => ({}));
      const messages = (body.messages as Array<{ role: string; content: string }>) || [];
      const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
      if (!LOVABLE_API_KEY) return json({ error: "AI not configured" }, 500);

      const hasTrack = Boolean(body.has_track);
      const systemPrompt = `You are a helpful assistant for a coastal hurricane storm-surge & wind prediction tool.

What this tool does:
- Given a hurricane track file (.txt), it runs a coastal flood / storm-surge prediction and returns:
  • Best storm map (CSV)
  • Water-level raster (TIF)
  • Similarity report (CSV)

Input file format (.txt hurricane track) — 10 whitespace-separated columns per data row:
ID  Y-m-d  H:M:S  LON(deg)  LAT(deg)  CP(Pa)  RMW(m)  VMAX(m/s)  TRANSPEEDX(m/s)  TRANSPEEDY(m/s)

How users interact:
- Paperclip = attach a .txt track file. Gear = adjust parameters (n_stations, station_stride, num_workers, raster_res). Send = run prediction.
- Users can also chat to ask questions, or ask you to modify the previously-attached track and re-run.

ACTION TAG — re-running with modifications:
${hasTrack
  ? `A track file IS currently loaded in this conversation. When the user asks you to modify it and re-run the prediction (e.g. "increase CP by 5%", "lower vmax by 10 m/s", "shift the track 0.5° north"), you MUST end your reply with EXACTLY one tag of the form:

<run_prediction>{"modifications":[{"field":"<cp|vmax|lon|lat|rmw>","op":"<scale|add|set>","value":<number>}],"note":"<short human description>"}</run_prediction>

Rules:
- "scale" multiplies the field (e.g. +5% => {"op":"scale","value":1.05}).
- "add" adds a delta (can be negative).
- "set" replaces every row's value with the given number.
- Multiple modifications can be combined in the array.
- Briefly confirm what you're doing in plain text BEFORE the tag (1–2 sentences). Do NOT promise to "start the job" without emitting the tag — the tag is what actually triggers the run.
- Do NOT emit the tag if the user is only asking a question or chatting.`
  : `No track file is currently loaded. If the user asks to modify and re-run, tell them to first attach a .txt track file with the paperclip.`}

Be concise, friendly, and technical when needed. Use markdown. Do not invent numeric results — only the prediction backend produces actual numbers.`;

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
        return json({ error: `AI error (${aiRes.status})`, details: t.slice(0, 500) }, 502);
      }

      return new Response(aiRes.body, {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
        },
      });
    }

    // ---------- STATUS ----------
    if (action === "status") {
      const jobId = url.searchParams.get("job_id");
      if (!jobId) return json({ error: "Missing job_id" }, 400);
      const r = await fetch(`${API_BASE}/status/${jobId}`);
      const text = await r.text();
      return new Response(text, {
        status: r.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---------- RESULT ----------
    if (action === "result") {
      const body = await req.json().catch(() => ({}));
      const jobId = body.job_id as string | undefined;
      const conversationId = (body.conversation_id as string) || crypto.randomUUID();
      const messageId = (body.message_id as string) || crypto.randomUUID();
      if (!jobId) return json({ error: "Missing job_id" }, 400);

      const r = await fetch(`${API_BASE}/result/${jobId}`);
      if (!r.ok) {
        const t = await r.text().catch(() => "");
        return json({ error: `Result fetch failed (${r.status})`, details: t.slice(0, 500) }, 502);
      }
      const zipBytes = new Uint8Array(await r.arrayBuffer());
      const zipReader = new ZipReader(new BlobReader(new Blob([zipBytes])));
      const entries = await zipReader.getEntries();
      const files: { name: string; path: string; signedUrl: string; size: number }[] = [];

      for (const entry of entries) {
        if (entry.directory || !entry.getData) continue;
        const data = await entry.getData(new Uint8ArrayWriter());
        const name = entry.filename.split("/").pop() || entry.filename;
        const path = `${userId}/${conversationId}/${messageId}/${name}`;
        const { error: upErr } = await supabase.storage
          .from("hurricane-results")
          .upload(path, data, { contentType: contentTypeFor(name), upsert: true });
        if (upErr) {
          console.error(`upload ${name}:`, upErr);
          continue;
        }
        const { data: signed } = await supabase.storage
          .from("hurricane-results")
          .createSignedUrl(path, 60 * 60 * 24 * 7);
        if (signed) files.push({ name, path, signedUrl: signed.signedUrl, size: data.byteLength });
      }
      await zipReader.close();
      return json({ files, message_id: messageId });
    }

    // ---------- SUBMIT ----------
    const incoming = await req.formData();
    const file = incoming.get("file");
    if (!(file instanceof File)) return json({ error: "Missing 'file' field (.txt)" }, 400);

    const forward = new FormData();
    forward.append("file", file, file.name || "track.txt");
    for (const k of ["n_stations", "station_stride", "num_workers", "raster_res"]) {
      const v = incoming.get(k);
      if (v !== null && v !== "") forward.append(k, v as string);
    }

    console.log(`[hurricane-predict] submit ${file.name} (${file.size} bytes)`);
    let upstream: Response;
    try {
      upstream = await fetch(`${API_BASE}/predict`, { method: "POST", body: forward });
    } catch (e) {
      return json(
        { error: "Could not reach prediction service", details: e instanceof Error ? e.message : String(e) },
        502
      );
    }
    if (!upstream.ok) {
      const t = await upstream.text().catch(() => "");
      return json({ error: `Predict error (${upstream.status})`, details: t.slice(0, 500) }, 502);
    }
    const submitData = await upstream.json().catch(() => ({}));
    return json(submitData);
  } catch (e) {
    console.error("[hurricane-predict] error:", e);
    return json({ error: "Internal error", details: e instanceof Error ? e.message : String(e) }, 500);
  }
});
