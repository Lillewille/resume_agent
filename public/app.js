const chatEl = document.getElementById("chat");
const form = document.getElementById("form");
const input = document.getElementById("input");

const history = []; // { role: "user"|"assistant", content: string }

function addMessage(role, text, meta = null) {
  const wrap = document.createElement("div");
  wrap.className = `msg ${role}`;

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;

  wrap.appendChild(bubble);

  if (meta?.sources?.length) {
    const sources = document.createElement("div");
    sources.className = "sources";
    sources.innerHTML =
      "<strong>Källor:</strong> " + meta.sources.map(s => `<span class="src">${s}</span>`).join(" ");
    wrap.appendChild(sources);
  }

  if (meta?.suggested_questions?.length) {
    const sug = document.createElement("div");
    sug.className = "suggest-inline";
    meta.suggested_questions.slice(0, 3).forEach(q => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = q;
      b.onclick = () => send(q);
      sug.appendChild(b);
    });
    wrap.appendChild(sug);
  }

  chatEl.appendChild(wrap);
  chatEl.scrollTop = chatEl.scrollHeight;
}

async function send(text) {
  if (!text?.trim()) return;

  addMessage("user", text);
  history.push({ role: "user", content: text });

  input.value = "";
  input.focus();

  const res = await fetch("/.netlify/functions/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: text, history })
  });

  const data = await res.json();
  if (!res.ok) {
    addMessage("assistant", data?.error || "Något gick fel.");
    return;
  }

  addMessage("assistant", data.answer, {
    sources: data.sources,
    suggested_questions: data.suggested_questions
  });

  history.push({ role: "assistant", content: data.answer });
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  send(input.value);
});

document.querySelectorAll(".suggest button").forEach(btn => {
  btn.addEventListener("click", () => send(btn.dataset.q));
});
