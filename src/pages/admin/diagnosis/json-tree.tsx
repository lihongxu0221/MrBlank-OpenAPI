import { useMemo, useState, type ReactNode } from "react"
import { fileFromUrl, Files } from "./format-pane";

export function recoverJson(s: string): unknown | null {
  let t = String(s).replace(/\n…\(truncated\)\s*$/, "");
  try { return JSON.parse(t); } catch {}
  let inStr = false, esc = false;
  const stack: string[] = [];
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (ch === "\\") { esc = true; continue; }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === "{") stack.push("}");
    else if (ch === "[") stack.push("]");
    else if (ch === "}" || ch === "]") stack.pop();
  }
  if (inStr) t += '"';
  while (stack.length) t += stack.pop();
  try { return JSON.parse(t); } catch { return null; }
}

export function repairMojibake(s: unknown): unknown {
  if (typeof s !== "string" || !s) return s;
  if (/[\u4e00-\u9fff]/.test(s) && s.indexOf("\uFFFD") < 0) return s;
  if (s.indexOf("\uFFFD") >= 0) return s;
  try {
    const bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i) & 255;
    const u = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (/[\u4e00-\u9fff]/.test(u)) return u;
  } catch {}
  try {
    const bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i) & 255;
    const g = new TextDecoder("gbk").decode(bytes);
    if (/[\u4e00-\u9fff]/.test(g)) return g;
  } catch {}
  return s;
}

function repairJsonValue(v: unknown): unknown {
  if (typeof v === "string") return repairMojibake(v);
  if (Array.isArray(v)) return v.map(repairJsonValue);
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>)) o[k] = repairJsonValue((v as Record<string, unknown>)[k])
    return o;
  }
  return v;
}

export function parseBody(v: unknown): { kind: "empty" | "json" | "text"; value?: unknown; truncated?: boolean } {
  if (v == null || v === "") return { kind: "empty" };
  if (typeof v === "object") return { kind: "json", value: repairJsonValue(v) };
  let s = String(v);
  for (let i = 0; i < 3; i++) {
    try {
      const val = JSON.parse(s);
      if (typeof val === "string") { s = val; continue; }
      return { kind: "json", value: repairJsonValue(val) };
    } catch {}
    break;
  }
  const recovered = recoverJson(s);
  if (recovered) return { kind: "json", value: repairJsonValue(recovered), truncated: true };
  const fixed = String(repairMojibake(s) ?? s);
  if (fixed !== s) {
    try {
      const val = JSON.parse(fixed);
      if (typeof val === "object") return { kind: "json", value: repairJsonValue(val) };
    } catch {}
  }
  return { kind: "text", value: fixed };
}

export function prettyDump(v: unknown): string {
  if (v == null || v === "") return "";
  if (typeof v === "object") { try { return JSON.stringify(v, null, 2); } catch { return String(v); } }
  const s = String(v);
  try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s; }
}

export function prettyHeaders(v: unknown): string {
  if (v == null || v === "") return "";
  let obj = v;
  if (typeof v === "string") { try { obj = JSON.parse(v); } catch { return v; } }
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    return Object.entries(obj).map(([k, val]) => k + ": " + (Array.isArray(val) ? val.join(", ") : val)).join("\n");
  }
  return prettyDump(v);
}

function KeyLabel({ name }: { name?: string | null }) {
  if (name == null) return null;
  return <><span className="jk">{name}</span>: </>;
}

function JsonArray({ arr }: { arr: unknown[] }) {
  const size = 20;
  const [page, setPage] = useState(0);
  const total = arr.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const p = Math.max(0, Math.min(page, pages - 1));
  const start = p * size;
  const slice = arr.slice(start, start + size);
  return (
    <>
      {total > size ? (
        <div className="msg-pager">
          <button type="button" className="button secondary compact" disabled={p === 0} onClick={() => setPage(p - 1)}>上一页</button>
          <span>{(start + 1) + "–" + Math.min(start + size, total) + " / " + total}</span>
          <button type="button" className="button secondary compact" disabled={p >= pages - 1} onClick={() => setPage(p + 1)}>下一页</button>
        </div>
      ) : null}
      {slice.map((x, i) => <JsonNode key={start + i} value={x} name={String(start + i)} />)}
    </>
  );
}

function JsonNode({ value, name, defaultOpen = false }: { value: unknown; name?: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen);
  if (value === null) return <div className="jl"><KeyLabel name={name} /><span className="jnull">null</span></div>;
  if (typeof value === "boolean") return <div className="jl"><KeyLabel name={name} /><span className="jb">{String(value)}</span></div>;
  if (typeof value === "number") return <div className="jl"><KeyLabel name={name} /><span className="jn">{value}</span></div>;
  if (typeof value === "string") {
    const dataFile = value.slice(0, 5) === "data:" ? fileFromUrl(value) : null;
    if (dataFile && (dataFile.data || dataFile.url)) {
      return (
        <div className="jl">
          <KeyLabel name={name} />
          <span className="js">{JSON.stringify(value.slice(0, 48) + "…")}</span> <span className="jm">{value.length}</span>
          <Files files={[dataFile]} />
        </div>
      );
    }
    if (value.length > 160) {
      return (
        <details className="jd" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
          <summary><KeyLabel name={name} /><span className="js">{JSON.stringify(value.slice(0, 96) + "…")}</span> <span className="jm">{value.length}</span></summary>
          {open ? <pre className="diag-turn-body">{value}</pre> : null}
        </details>
      );
    }
    return <div className="jl"><KeyLabel name={name} /><span className="js">{JSON.stringify(value)}</span></div>;
  }
  if (Array.isArray(value)) {
    if (!value.length) return <div className="jl"><KeyLabel name={name} /><span className="jm">[]</span></div>;
    return (
      <details className="jd" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
        <summary><KeyLabel name={name} /><span className="jm">[{value.length}]</span></summary>
        {open ? <JsonArray arr={value} /> : null}
      </details>
    );
  }
  if (typeof value === "object") {
    const keys = Object.keys(value as object);
    if (!keys.length) return <div className="jl"><KeyLabel name={name} /><span className="jm">{"{}"}</span></div>;
    return (
      <details className="jd" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
        <summary><KeyLabel name={name} /><span className="jm">{"{...}"}</span></summary>
        {open ? keys.map((k) => <JsonNode key={k} value={(value as Record<string, unknown>)[k]} name={k} />) : null}
      </details>
    );
  }
  return <div className="jl"><KeyLabel name={name} />{String(value)}</div>;
}

export function BodyView({ title, raw, field, onCopy }: { title: string; raw: unknown; field?: string; onCopy?: (field: string, pretty?: string) => void }) {
  const parsed = useMemo(() => parseBody(raw), [raw]);
  const [src, setSrc] = useState(false);
  if (parsed.kind === "empty") return null;
  if (parsed.kind === "text") {
    return (
      <div className="body-view">
        <div className="body-cap">
          <p className="sub">{title} · 文本</p>
          {field ? <button type="button" className="button secondary compact" onClick={() => onCopy && onCopy(field)}>复制</button> : null}
        </div>
        <div className="diag-dump">{String(parsed.value ?? "")}</div>
      </div>
    );
  }
  const pretty = prettyDump(parsed.value);
  return (
    <div className="body-view">
      <div className="body-cap">
        <p className="sub">{title + (parsed.truncated ? " · JSON（截断预览）" : " · JSON")}</p>
        <button type="button" className="button secondary compact" onClick={() => setSrc((v) => !v)}>View source</button>
        {field ? <button type="button" className="button secondary compact" onClick={() => onCopy && onCopy(field, pretty)}>复制</button> : null}
      </div>
      <div className="json-wrap">
        {src ? <pre className="diag-dump json-src">{pretty}</pre> : <div className="diag-json-tree"><JsonNode value={parsed.value} defaultOpen /></div>}
      </div>
    </div>
  );
}

export function EmptyPane({ children }: { children?: ReactNode }) {
  return <div className="empty-pane">{children}</div>;
}
