const BLOCKED_HOSTS = new Set(["localhost", "localhost.localdomain", "0.0.0.0", "::1", "[::1]"]);

function isPrivateIpv4(hostname) {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) return false;
  const values = parts.map(Number);
  if (values.some((value) => value < 0 || value > 255)) return false;
  const [a, b] = values;
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function isPrivateIpv6(hostname) {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return host === "::1" || host.startsWith("::ffff:") || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe8") || host.startsWith("fe9") || host.startsWith("fea") || host.startsWith("feb");
}

export function isSafePublicHttpUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) return false;
  if (url.port && url.port !== "80" && url.port !== "443") return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  return !!host && !BLOCKED_HOSTS.has(host) && !host.endsWith(".local") && !isPrivateIpv4(host) && !isPrivateIpv6(host);
}

export function decodeHtml(value = "") {
  const named = { amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"' };
  return String(value).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    const key = entity.toLowerCase();
    if (key[0] === "#") {
      const number = key[1] === "x" ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10);
      return Number.isFinite(number) && number >= 0 && number <= 0x10ffff ? String.fromCodePoint(number) : match;
    }
    return named[key] || match;
  });
}

function textFromHtml(value = "") {
  return decodeHtml(String(value)
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|canvas|template|iframe)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|hr|p|div|article|main|section|li|h[1-6]|tr|blockquote)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim());
}

function firstMatch(html, pattern) {
  return html.match(pattern)?.[1] || "";
}

export function extractReadableHtml(html, url = "") {
  const source = String(html || "");
  const title = textFromHtml(firstMatch(source, /<title\b[^>]*>([\s\S]*?)<\/title>/i));
  const description = decodeHtml(
    firstMatch(source, /<meta\b(?=[^>]*(?:name|property)=["'](?:description|og:description)["'])[^>]*content=["']([^"']*)["'][^>]*>/i)
      || firstMatch(source, /<meta\b(?=[^>]*content=["'][^"']*["'])[^>]*(?:name|property)=["'](?:description|og:description)["'][^>]*content=["']([^"']*)["'][^>]*>/i)
  ).replace(/\s+/g, " ").trim();
  const article = firstMatch(source, /<(?:article|main)\b[^>]*>([\s\S]*?)<\/(?:article|main)>/i);
  const text = textFromHtml(article || source);
  return { title: title || url, description, text };
}
