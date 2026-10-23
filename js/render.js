// Markdown＋LaTeX を安全な HTML にする（数式は KaTeX、HTML は DOMPurify で消毒）

function katexHTML(expr, display) {
  try {
    return window.katex.renderToString(expr, { displayMode: display, throwOnError: false, output: "html", strict: "ignore" });
  } catch {
    return `<code>${escapeHTML(expr)}</code>`;
  }
}

export function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function withMath(text, toHTML) {
  const maths = [];
  const keep = (expr, display) => {
    maths.push(katexHTML(expr.trim(), display));
    return `KATEXPH${maths.length - 1}X`;
  };
  let t = String(text ?? "");
  t = t.replace(/\$\$([\s\S]+?)\$\$/g, (_, e) => keep(e, true));
  t = t.replace(/(?<!\\)\$(.+?)(?<!\\)\$/g, (_, e) => keep(e, false));
  const html = window.DOMPurify.sanitize(toHTML(t));
  return html.replace(/KATEXPH(\d+)X/g, (_, i) => maths[Number(i)]);
}

export function rich(text) {
  return withMath(text, (t) => window.marked.parse(t, { breaks: true, gfm: true }));
}

export function inline(text) {
  return withMath(text, (t) => window.marked.parseInline(t, { breaks: true, gfm: true }));
}
