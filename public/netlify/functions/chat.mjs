import OpenAI from "openai";
import fs from "node:fs";
import path from "node:path";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function chunkText(text, chunkSize = 900, overlap = 120) {
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    chunks.push(text.slice(i, i + chunkSize));
    i += chunkSize - overlap;
  }
  return chunks;
}

function scoreChunk(q, chunk) {
  // superenkel scoring: ordmatchning
  const words = q.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const hay = chunk.toLowerCase();
  let score = 0;
  for (const w of words) if (hay.includes(w)) score += 1;
  return score;
}

function loadKnowledgeBase() {
  const dir = path.resolve("content");
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".md"));
  const docs = files.map((f) => ({
    name: f,
    text: fs.readFileSync(path.join(dir, f), "utf8")
  }));
  return docs;
}

const KB = loadKnowledgeBase();
const KB_CHUNKS = KB.flatMap(doc =>
  chunkText(doc.text).map((c, idx) => ({
    id: `${doc.name}#${idx + 1}`,
    doc: doc.name,
    text: c
  }))
);

function retrieve(query, k = 6) {
  const scored = KB_CHUNKS
    .map(ch => ({ ...ch, score: scoreChunk(query, ch.text) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);

  // om allt är 0, plocka ändå lite “about/faq”
  const fallback = scored.every(s => s.score === 0);
  if (fallback) {
    const preferred = KB_CHUNKS.filter(ch => ["about.md", "faq.md"].includes(ch.doc)).slice(0, k);
    return preferred.length ? preferred : scored;
  }
  return scored;
}

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    const { message, history = [] } = await req.json();

    const top = retrieve(message, 7);
    const context = top.map(t => `SOURCE: ${t.doc}\n${t.text}`).join("\n\n---\n\n");
    const sources = [...new Set(top.map(t => t.doc))];

    const system = `
Du är en rekryterar-assistent för kandidaten Mattias.
Regler:
- Svara ENDAST med stöd av källorna i CONTEXT. Hitta inte på.
- Om du saknar info: säg det tydligt och föreslå att rekryteraren kontaktar Mattias.
- Dela aldrig känsliga personuppgifter.
- Svara kort, konkret och professionellt.
- Avsluta med 2–4 förslag på följdfrågor.
Returnera svaret i JSON med nycklarna: answer, suggested_questions (array).
`;

    // Begränsa history lite (bra för kostnad/latens)
    const trimmedHistory = history.slice(-8).map(m => ({
      role: m.role,
      content: m.content
    }));

    const input = [
      { role: "system", content: system },
      {
        role: "user",
        content:
`CONTEXT:
${context}

CHAT HISTORY:
${trimmedHistory.map(m => `${m.role.toUpperCase()}: ${m.content}`).join("\n")}

QUESTION:
${message}

Svara som JSON: {"answer":"...","suggested_questions":["...","..."]}`
      }
    ];

    const resp = await openai.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5.2",
      input
    });

    const text = resp.output_text || "";
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { answer: text || "Jag kunde inte skapa ett svar just nu.", suggested_questions: [] };
    }

    return new Response(
      JSON.stringify({
        answer: parsed.answer?.trim() || "",
        sources,
        suggested_questions: Array.isArray(parsed.suggested_questions) ? parsed.suggested_questions : []
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err?.message || "Server error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
