// Ported from aily-openai-adapter web/src/features/usage/format-pane.jsx
// @ts-nocheck — faithful JS port; public exports typed below via JSDoc-ish usage sites
import { useEffect, useMemo, useRef, useState } from 'react'

const ROLE = { system: "系统", user: "请求", assistant: "响应", thinking: "思考", reasoning: "思考", tool: "工具" };
const MORE_FILTERS = [
  { key: "all", label: "全部" },
  { key: "request", label: "请求" },
  { key: "thinking", label: "思考" },
  { key: "tool", label: "工具" },
  { key: "reply", label: "回复" },
];

function asObj(v) {
  if (v == null || v === "") return null;
  if (typeof v === "object") return v;
  let s = String(v);
  for (let i = 0; i < 3; i++) {
    try {
      const val = JSON.parse(s);
      if (typeof val === "string") { s = val; continue; }
      return val;
    } catch { break; }
  }
  return null;
}

function extFromMime(mime, fallback) {
  const m = String(mime || "").split(";")[0].trim().toLowerCase();
  const map = { "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/svg+xml": "svg", "application/pdf": "pdf", "text/plain": "txt", "application/json": "json" };
  if (map[m]) return map[m];
  if (m.startsWith("image/")) return m.slice(6).replace(/[^a-z0-9]+/g, "") || fallback || "bin";
  return fallback || "bin";
}
function parseDataUrl(s) {
  const m = String(s || "").match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (!m) return null;
  return { mime: m[1] || "application/octet-stream", base64: !!m[2], data: m[3] || "" };
}
export function fileFromUrl(url, name = undefined) {
  if (url == null || url === "") return null;
  const s = String(url);
  const d = parseDataUrl(s);
  if (d) {
    const kind = d.mime.indexOf("image/") === 0 ? "image" : "file";
    return { kind, name: name || (kind === "image" ? "image." + extFromMime(d.mime, "png") : "file." + extFromMime(d.mime)), mime: d.mime, data: d.base64 ? d.data : undefined, url: s };
  }
  if (/^(https?:|blob:)/i.test(s)) {
    const leaf = s.split("?")[0].split("#")[0].split("/").pop() || "";
    const kind = /\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(s) ? "image" : "file";
    return { kind, name: name || decodeURIComponent(leaf) || (kind === "image" ? "image" : "file"), mime: "", url: s };
  }
  return null;
}
function fileFromSource(source, name) {
  if (!source) return null;
  if (typeof source === "string") return fileFromUrl(source, name);
  if (typeof source !== "object") return null;
  if (source.url) return fileFromUrl(source.url, name);
  if (source.data) {
    const mime = source.media_type || source.mime_type || source.mime || "application/octet-stream";
    const kind = String(mime).indexOf("image/") === 0 ? "image" : "file";
    return { kind, name: name || (kind === "image" ? "image." + extFromMime(mime, "png") : "file." + extFromMime(mime)), mime, data: source.data };
  }
  return null;
}
function fileFromB64(b64, mime, name) {
  if (!b64) return null;
  const m = mime || "image/png";
  const kind = String(m).indexOf("image/") === 0 ? "image" : "file";
  return { kind, name: name || (kind === "image" ? "image." + extFromMime(m, "png") : "file." + extFromMime(m)), mime: m, data: b64 };
}
function pushFile(files, f) {
  if (!f) return;
  const key = f.data || f.url || f.id;
  if (key && files.some((x) => (x.data || x.url || x.id) === key)) return;
  files.push(f);
}
function collectEmbeddedFiles(s, files) {
  if (!s) return;
  const re = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)|<img\b[^>]*\bsrc=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(s))) pushFile(files, fileFromUrl(m[1] || m[2]));
}
function isPreviewableImageSrc(src) {
  if (!src || typeof src !== "string") return false;
  const s = src.trim();
  if (!s) return false;
  const lower = s.toLowerCase();
  if (lower === "image" || lower === "img" || lower === "null" || lower === "undefined" || lower === "about:blank") return false;
  if (/^data:image\//i.test(s)) return true;
  if (/^https?:\/\//i.test(s)) return true;
  return false;
}
export function mediaPreviewSrc(f) {
  if (!f) return "";
  if (isPreviewableImageSrc(f.url)) return f.url.trim();
  if (f.data && isPreviewableImageSrc("data:" + (f.mime || "image/png") + ";base64," + f.data)) {
    return "data:" + (f.mime || "image/png") + ";base64," + f.data;
  }
  if (isPreviewableImageSrc(f.url)) return f.url;
  if (f.url && f.url.slice(0, 5) === "data:" && /^data:image\//i.test(f.url)) return f.url;
  if (f.data) return "data:" + (f.mime || "application/octet-stream") + ";base64," + f.data;
  return "";
}
function collectFromPart(p, texts, files) {
  if (p == null) return;
  if (typeof p === "string") {
    const asFile = fileFromUrl(p);
    if (asFile && p.slice(0, 5) === "data:") { pushFile(files, asFile); return; }
    if (p) texts.push(p);
    collectEmbeddedFiles(p, files);
    return;
  }
  if (Array.isArray(p)) { for (const x of p) collectFromPart(x, texts, files); return; }
  if (typeof p !== "object") return;
  const type = String(p.type || "").toLowerCase();
  if (type === "text" || type === "input_text" || type === "output_text") {
    const t = typeof p.text === "string" ? p.text : (typeof p.content === "string" ? p.content : "");
    if (t) { texts.push(t); collectEmbeddedFiles(t, files); }
    return;
  }
  if (type === "image_url" || type === "input_image" || type === "output_image" || type === "image_file" || type === "image" || type === "image_generation" || type === "image_generation_call") {
    const result = p.result && typeof p.result === "object" ? p.result : p;
    const url = typeof p.image_url === "string" ? p.image_url : (p.image_url && (p.image_url.url || p.image_url.data)) || p.url || result.url || "";
    const name = p.filename || p.name;
    const f = fileFromUrl(url, name) || fileFromSource(p.source, name) || fileFromB64(p.b64_json || result.b64_json, p.mime || result.mime || p.media_type, name);
    if (f) {
      if (f.kind === "image") {
        const src = mediaPreviewSrc(f);
        if (!src) return;
      }
      pushFile(files, f);
    }
    return;
  }
  if (type === "file" || type === "input_file" || type === "document" || type === "output_file") {
    const fobj = p.file && typeof p.file === "object" ? p.file : p;
    const name = fobj.filename || fobj.name || p.filename || p.name;
    const mime = fobj.mime || fobj.media_type || p.mime || p.media_type;
    const dataUrl = fobj.file_data || p.file_data || fobj.data || (typeof fobj.file_url === "string" ? fobj.file_url : fobj.file_url && fobj.file_url.url) || p.file_url;
    const f = typeof dataUrl === "string"
      ? (fileFromUrl(dataUrl, name) || (dataUrl.length > 24 && !/[\s<>]/.test(dataUrl) ? fileFromSource({ data: dataUrl, media_type: mime }, name) : null))
      : (fobj.source ? fileFromSource(fobj.source, name) : null);
    if (f) pushFile(files, f);
    else if (fobj.file_id || p.file_id) pushFile(files, { kind: "file", name: name || String(fobj.file_id || p.file_id), mime: mime || "", id: fobj.file_id || p.file_id });
    return;
  }
  if (p.image_url) {
    const url = typeof p.image_url === "string" ? p.image_url : p.image_url.url;
    pushFile(files, fileFromUrl(url, p.filename || p.name));
    return;
  }
  if (p.b64_json) { pushFile(files, fileFromB64(p.b64_json, p.mime || p.media_type || "image/png", p.filename || p.name)); return; }
  if (typeof p.text === "string" && p.text) { texts.push(p.text); collectEmbeddedFiles(p.text, files); }
  else if (typeof p.content === "string" && p.content) { texts.push(p.content); collectEmbeddedFiles(p.content, files); }
  else if (Array.isArray(p.content)) collectFromPart(p.content, texts, files);
}
function collectMessageParts(c) {
  const texts = [], files = [];
  collectFromPart(c, texts, files);
  return { text: texts.join("\n"), files };
}
function normalizeRole(role) {
  const r = String(role || "").toLowerCase();
  if (r === "system" || r === "developer") return "system";
  if (r === "user") return "user";
  if (r === "assistant") return "assistant";
  if (r === "thinking" || r === "reason" || r === "reasoning") return "thinking";
  if (r === "tool" || r === "tool_result" || r === "function" || r === "function_result") return "tool";
  return role || "user";
}
function isRequestLikeRole(role) { return role === "system" || role === "user"; }
function isThinkingRole(role) { return role === "thinking" || role === "reasoning"; }
function isToolRole(role) { return role === "tool"; }
function isReplyRole(role) { return role === "assistant"; }
export function turnMatchesMoreFilter(role, filter) {
  if (filter === "all") return true;
  if (filter === "request") return isRequestLikeRole(role);
  if (filter === "thinking") return isThinkingRole(role);
  if (filter === "tool") return isToolRole(role);
  if (filter === "reply") return isReplyRole(role);
  return true;
}
export function countTurnsForFilter(turns, filter) {
  if (filter === "all") return turns.length;
  return turns.filter((t) => turnMatchesMoreFilter(t.role, filter)).length;
}
function turnHasContent(turn) {
  return !!(String(turn.content || turn.text || "").trim() || (turn.files && turn.files.length) || (turn.images && turn.images.length));
}
function pushTurn(turns, role, content, files) {
  const text = content || "";
  const atts = files && files.length ? files.slice() : undefined;
  if (!text && !atts) return;
  const t = { role: normalizeRole(role), content: text };
  if (atts) t.files = atts;
  turns.push(t);
}
function formatToolCall(item) {
  const name = item.name || (item.function && item.function.name) || "tool";
  let args = "";
  const raw = item.arguments != null ? item.arguments : (item.function && item.function.arguments);
  if (typeof raw === "string") args = raw;
  else if (raw != null) {
    try { args = JSON.stringify(raw, null, 2); } catch { args = String(raw); }
  }
  return "[tool_call: " + name + "]\n" + args;
}
function formatToolResult(item) {
  const out = item.output != null ? item.output : item.content;
  let text = "";
  if (typeof out === "string") text = out;
  else if (out != null) {
    try { text = JSON.stringify(out, null, 2); } catch { text = String(out); }
  }
  const id = item.call_id || item.tool_call_id || item.id || "";
  return "[tool_result" + (id ? ": " + id : "") + "]\n" + text;
}
function collectTopLevelFiles(obj, files) {
  if (!obj || typeof obj !== "object") return;
  if (typeof obj.b64_json === "string") pushFile(files, fileFromB64(obj.b64_json, obj.mime || "image/png", obj.filename || obj.name));
  if (typeof obj.url === "string" && (obj.b64_json || obj.url.slice(0, 5) === "data:" || /\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(obj.url))) {
    pushFile(files, fileFromUrl(obj.url, obj.filename || obj.name));
  }
  ["images", "data", "output"].forEach((key) => {
    if (!Array.isArray(obj[key])) return;
    obj[key].forEach((item) => {
      if (!item) return;
      if (typeof item === "string") { pushFile(files, fileFromUrl(item)); return; }
      if (typeof item !== "object") return;
      if (item.type === "message" || item.type === "reasoning" || item.type === "function_call") return;
      collectFromPart(item, [], files);
      collectTopLevelFiles(item, files);
    });
  });
}
function extractInputItem(item, turns) {
  if (!item || typeof item !== "object") return;
  const t = String(item.type || "").toLowerCase();
  if (t === "function_call") { pushTurn(turns, "tool", formatToolCall(item)); return; }
  if (t === "function_call_output" || t === "function_call_result") { pushTurn(turns, "tool", formatToolResult(item)); return; }
  if (t.includes("reason")) {
    const parts = collectMessageParts(item.summary != null ? item.summary : (item.content != null ? item.content : item.text));
    pushTurn(turns, "thinking", parts.text || (typeof item.text === "string" ? item.text : ""), parts.files);
    return;
  }
  const parts = collectMessageParts(item.content != null ? item.content : item);
  pushTurn(turns, item.role || (t === "message" ? "user" : "user"), parts.text, parts.files);
}
function extractOutputItem(item, turns) {
  if (!item || typeof item !== "object") return;
  const t = String(item.type || "").toLowerCase();
  if (t.includes("reason")) {
    const reasoning = collectMessageParts(item.content).text || ((item.summary || []).map((x) => x && x.text || "").join("\n")) || (typeof item.text === "string" ? item.text : "");
    pushTurn(turns, "thinking", reasoning);
    return;
  }
  if (t === "function_call") { pushTurn(turns, "tool", formatToolCall(item)); return; }
  if (t === "function_call_output" || t === "function_call_result") { pushTurn(turns, "tool", formatToolResult(item)); return; }
  if (t === "message" || t === "output_image" || t === "image" || t === "image_generation_call" || item.role) {
    const parts = collectMessageParts(item.content != null ? item.content : item);
    pushTurn(turns, item.role || "assistant", parts.text, parts.files);
  }
}

function extractTurns(reqBody, resBody) {
  const turns = [];
  const r = asObj(reqBody);
  if (r) {
    if (r.instructions) pushTurn(turns, "system", String(r.instructions));
    if (Array.isArray(r.messages) && r.messages.length) {
      for (const m of r.messages) {
        if (typeof m === "string") { pushTurn(turns, "user", m); continue; }
        if (!m) continue;
        const role = normalizeRole(m.role || "user");
        if (role === "tool") {
          pushTurn(turns, "tool", formatToolResult({ output: m.content, call_id: m.tool_call_id || m.id }));
          continue;
        }
        if (role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length) {
          const parts = collectMessageParts(m.content);
          if (parts.text || (parts.files && parts.files.length)) pushTurn(turns, "assistant", parts.text, parts.files);
          for (const tc of m.tool_calls) pushTurn(turns, "tool", formatToolCall(tc));
          continue;
        }
        const parts = collectMessageParts(m.content);
        pushTurn(turns, role, parts.text, parts.files);
      }
    } else if (typeof r.input === "string") pushTurn(turns, "user", r.input);
    else if (Array.isArray(r.input)) {
      for (const m of r.input) {
        if (typeof m === "string") pushTurn(turns, "user", m);
        else extractInputItem(m, turns);
      }
    } else if (typeof r.prompt === "string") pushTurn(turns, "user", r.prompt);
  }
  const s = asObj(resBody);
  if (s) {
    if (Array.isArray(s.choices) && s.choices.length) {
      for (const ch of s.choices) {
        if (!ch) continue;
        if (ch.message) {
          if (ch.message.reasoning_content) pushTurn(turns, "thinking", String(ch.message.reasoning_content));
          const parts = collectMessageParts(ch.message.content);
          if (Array.isArray(ch.message.tool_calls) && ch.message.tool_calls.length) {
            if (parts.text || (parts.files && parts.files.length)) pushTurn(turns, "assistant", parts.text, parts.files);
            for (const tc of ch.message.tool_calls) pushTurn(turns, "tool", formatToolCall(tc));
          } else {
            pushTurn(turns, "assistant", parts.text, parts.files);
          }
        } else if (typeof ch.text === "string" && ch.text) {
          const parts = collectMessageParts(ch.text);
          pushTurn(turns, "assistant", parts.text, parts.files);
        }
      }
      const extra = [];
      collectTopLevelFiles(s, extra);
      if (extra.length) {
        const last = [...turns].reverse().find((t) => t.role === "assistant");
        if (last) last.files = (last.files || []).concat(extra);
        else pushTurn(turns, "assistant", "", extra);
      }
    } else if (Array.isArray(s.output)) {
      for (const item of s.output) extractOutputItem(item, turns);
    } else if (typeof s.content === "string" || s.reasoning || s.images || s.data) {
      if (typeof s.reasoning === "string" && s.reasoning) pushTurn(turns, "thinking", s.reasoning);
      const parts = collectMessageParts(s.content);
      const extra = [];
      collectTopLevelFiles(s, extra);
      pushTurn(turns, "assistant", parts.text, (parts.files || []).concat(extra));
    } else if (s.stream && (s.content || s.reasoning || s.tool_calls)) {
      if (s.reasoning) pushTurn(turns, "thinking", String(s.reasoning));
      if (Array.isArray(s.tool_calls) && s.tool_calls.length) {
        if (s.content) pushTurn(turns, "assistant", String(s.content));
        for (const tc of s.tool_calls) pushTurn(turns, "tool", formatToolCall(tc));
      } else if (s.content) pushTurn(turns, "assistant", String(s.content));
    }
  }
  return turns.filter(turnHasContent);
}

export function loadTurns(rec) {
  const fromBodies = extractTurns(rec && rec.req_body, rec && rec.res_body);
  const bodyHasReq = fromBodies.some((t) => isRequestLikeRole(t.role) || isToolRole(t.role));
  if (bodyHasReq) return fromBodies;
  const d = asObj(rec && rec.dialog);
  const fromDialog = Array.isArray(d) ? d.map((t) => ({
    role: normalizeRole(t.role),
    content: t.content || t.text || "",
    files: t.files,
  })).filter(turnHasContent) : [];
  if (fromDialog.length) {
    if (!fromBodies.length) return fromDialog;
    const req = fromDialog.filter((t) => !isReplyRole(t.role) && !isThinkingRole(t.role));
    const rest = fromBodies.filter((t) => isReplyRole(t.role) || isThinkingRole(t.role) || isToolRole(t.role));
    return req.concat(rest);
  }
  return fromBodies;
}

function attSrc(f) {
  return mediaPreviewSrc(f) || (f && f.url) || "";
}
function b64ToBlob(b64, mime) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime || "application/octet-stream" });
}
function triggerDownload(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name || "file";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function downloadFile(f) {
  if (!f) return;
  if (f.data) {
    try { triggerDownload(b64ToBlob(f.data, f.mime), f.name || "file"); } catch {}
    return;
  }
  if (f.url && f.url.slice(0, 5) === "data:") {
    const a = document.createElement("a");
    a.href = f.url;
    a.download = f.name || "file";
    document.body.appendChild(a);
    a.click();
    a.remove();
    return;
  }
  if (f.url) window.open(f.url, "_blank");
}

export function Files({ files }) {
  const [lb, setLb] = useState(null);
  if (!files || !files.length) return null;
  return (
    <>
      <div className="turn-files">
        {files.map((f, i) => {
          const src = attSrc(f);
          const name = f.name || (f.kind === "image" ? "image" : "file");
          const previewable = f.kind === "image" && isPreviewableImageSrc(src);
          return (
            <div className={"att-card" + (f.kind === "image" ? "" : " file")} key={i}>
              {previewable ? (
                <button type="button" className="att-zoom" onClick={() => setLb({ src, name, file: f })}>
                  <img src={src} alt={name} />
                </button>
              ) : null}
              <div className="att-meta"><b>{name}</b><span>{f.mime || (f.id ? "id " + f.id : "file")}</span></div>
              <button type="button" className="button secondary compact" onClick={() => downloadFile(f)}>下载</button>
            </div>
          );
        })}
      </div>
      {lb ? (
        <div className="img-lb" onClick={() => setLb(null)}>
          <button type="button" className="img-lb-x" onClick={() => setLb(null)}>×</button>
          <img src={lb.src} alt={lb.name} onClick={() => setLb(null)} />
          <div className="img-lb-bar" onClick={(e) => e.stopPropagation()}>
            <span>{lb.name}</span>
            <button type="button" className="button secondary compact" onClick={() => downloadFile(lb.file || lb)}>下载</button>
          </div>
        </div>
      ) : null}
    </>
  );
}

function extractImagesFromMarkdown(text) {
  const out = [];
  if (!text) return out;
  const re = /!\[([^\]]*)\]\(([^)]+)\)|<img[^>]+src=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(text))) {
    const raw = (m[2] || m[3] || "").trim();
    if (!isPreviewableImageSrc(raw)) continue;
    out.push(fileFromUrl(raw, (m[1] || "").trim() || "image"));
  }
  return out;
}

function turnPreviewLabel(turn) {
  const text = String(turn.content || "").replace(/\s+/g, " ").trim();
  if (text) return text.slice(0, 48);
  const files = turn.files || [];
  if (files.length) {
    const imgs = files.filter((f) => f.kind === "image").length;
    const other = files.length - imgs;
    return (other ? other + " 个文件" : "") + (other && imgs ? " · " : "") + (imgs ? imgs + " 张图" : "") || "附件";
  }
  return "(空)";
}
function turnEmptyHint(turn) {
  const files = turn.files || [];
  if (files.length) {
    const imgs = files.filter((f) => f.kind === "image").length;
    const other = files.length - imgs;
    return "无文本（" + (other ? other + " 个文件" : "") + (other && imgs ? " · " : "") + (imgs ? imgs + " 张图" : "") + "）";
  }
  return "无文本";
}
function roleBadge(role) {
  if (isThinkingRole(role)) return "reason";
  if (isReplyRole(role)) return "content";
  if (isToolRole(role)) return "tool";
  return "";
}

function TurnView({ turn, title, onCopy }) {
  const files = turn.files || [];
  const text = turn.content || "";
  return (
    <div className={"diag-turn turn" + (isThinkingRole(turn.role) ? " reasoning" : "")}>
      <div className="diag-turn-hd turn-hd">
        <b>{title}</b>
        {roleBadge(turn.role) ? <code>{roleBadge(turn.role)}</code> : null}
        <button type="button" className="button secondary compact" onClick={() => onCopy(text)}>复制</button>
      </div>
      {!String(text).trim() ? <div className="turn-empty">{turnEmptyHint(turn)}</div> : <pre className="diag-turn-body turn-body">{text}</pre>}
      <Files files={files} />
    </div>
  );
}

export function FormatPane({ rec, building }) {
  const [filter, setFilter] = useState("all");
  const [pos, setPos] = useState(0);
  const [navOpen, setNavOpen] = useState(false);
  const navRef = useRef(null);
  const listRef = useRef(null);

  const timeline = useMemo(() => {
    if (building) return [];
    return loadTurns(rec || {}).map((t, i) => ({ ...t, n: i + 1 }));
  }, [rec, building]);

  const filtered = useMemo(
    () => timeline.filter((t) => turnMatchesMoreFilter(t.role, filter)),
    [timeline, filter],
  );
  const counts = useMemo(() => ({
    all: countTurnsForFilter(timeline, "all"),
    request: countTurnsForFilter(timeline, "request"),
    thinking: countTurnsForFilter(timeline, "thinking"),
    tool: countTurnsForFilter(timeline, "tool"),
    reply: countTurnsForFilter(timeline, "reply"),
  }), [timeline]);

  const safePos = Math.max(0, Math.min(pos, Math.max(0, filtered.length - 1)));
  const current = filtered[safePos] || null;
  const currentDisplay = useMemo(() => {
    if (!current) return null;
    const md = extractImagesFromMarkdown(current.content || "").filter((f) => mediaPreviewSrc(f));
    if (!md.length) return current;
    const files = [...(current.files || []), ...md];
    const seen = new Set();
    const uniq = [];
    for (const f of files) {
      const key = f.data || f.url || f.id || f.name;
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      uniq.push(f);
    }
    return { ...current, files: uniq };
  }, [current]);

  useEffect(() => {
    setPos(0);
    setFilter("all");
    setNavOpen(false);
  }, [rec && rec.id]);

  useEffect(() => {
    if (!navOpen) return;
    function onDoc(e) {
      if (navRef.current && !navRef.current.contains(e.target)) setNavOpen(false);
    }
    function onKey(e) {
      if (e.key === "Escape") { setNavOpen(false); e.stopPropagation(); }
    }
    document.addEventListener("pointerdown", onDoc, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDoc, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [navOpen]);

  function setMoreFilter(next) {
    if (filter === next) return;
    const keepN = current && current.n;
    setFilter(next);
    setNavOpen(false);
    const list = timeline.filter((t) => turnMatchesMoreFilter(t.role, next));
    if (!list.length) { setPos(0); return; }
    const idx = keepN != null ? list.findIndex((t) => t.n === keepN) : 0;
    setPos(idx >= 0 ? idx : 0);
  }

  function selectPos(i, fromDropdown) {
    if (i < 0 || i >= filtered.length) return;
    setPos(i);
    if (fromDropdown) setNavOpen(false);
  }

  function navLabel(turn, index) {
    return (index + 1) + "/" + filtered.length + " #" + turn.n + " " + turnPreviewLabel(turn);
  }

  function copyText(text) {
    if (text) navigator.clipboard.writeText(text).catch(() => {});
  }

  function downloadPack() {
    if (!timeline.length) return;
    const blob = new Blob([JSON.stringify({
      turns: timeline.map((t) => ({
        n: t.n,
        role: t.role,
        content: t.content || "",
        files: t.files || undefined,
      })),
    }, null, 2)], { type: "application/json; charset=utf-8" });
    triggerDownload(blob, "audit-" + ((rec && rec.id) || "log") + ".json");
  }

  if (building) {
    return (
      <div className="fmt-pane" data-testid="diagnosis-more-skeleton">
        <div className="empty-pane">正在解析对话回合…</div>
      </div>
    );
  }

  if (!timeline.length) {
    return <div className="empty-pane">没有可显示的正文。</div>;
  }

  return (
    <div className="fmt-pane" data-testid="diagnosis-more-timeline">
      <div className="more-filters">
        {MORE_FILTERS.map((chip) => (
          <button
            key={chip.key}
            type="button"
            className={"button secondary compact" + (filter === chip.key ? " on" : "")}
            data-testid={"diagnosis-more-filter-" + chip.key}
            onClick={() => setMoreFilter(chip.key)}
          >{chip.label} ({counts[chip.key]})</button>
        ))}
        <button type="button" className="button secondary compact fmt-dl" onClick={downloadPack}>下载</button>
      </div>
      {!filtered.length ? (
        <div className="empty-pane">没有可显示的正文。</div>
      ) : (
        <>
          <div className="msg-pager more-nav">
            <button type="button" className="button secondary compact" disabled={safePos <= 0} onClick={() => selectPos(safePos - 1)}>上一条</button>
            <div className="more-nav-dd" ref={navRef}>
              <button
                type="button"
                className="more-nav-trigger"
                data-testid="diagnosis-more-nav"
                aria-haspopup="listbox"
                aria-expanded={navOpen}
                onClick={() => setNavOpen((v) => !v)}
              >
                <span className="more-nav-label">{current ? navLabel(current, safePos) : ""}</span>
                <span className={"more-nav-caret" + (navOpen ? " open" : "")}>▾</span>
              </button>
              {navOpen ? (
                <div className="more-nav-list" ref={listRef} role="listbox" data-testid="diagnosis-more-nav-list">
                  {filtered.map((turn, i) => (
                    <button
                      key={turn.n}
                      type="button"
                      role="option"
                      aria-selected={safePos === i}
                      className={safePos === i ? "on" : ""}
                      onClick={() => selectPos(i, true)}
                    >{navLabel(turn, i)}</button>
                  ))}
                </div>
              ) : null}
            </div>
            <button type="button" className="button secondary compact" disabled={safePos >= filtered.length - 1} onClick={() => selectPos(safePos + 1)}>下一条</button>
          </div>
          {currentDisplay ? (
            <div className="fmt-main">
              <TurnView
                turn={currentDisplay}
                title={"#" + currentDisplay.n + " · " + (ROLE[currentDisplay.role] || currentDisplay.role)}
                onCopy={copyText}
              />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

export { ROLE, normalizeRole };
