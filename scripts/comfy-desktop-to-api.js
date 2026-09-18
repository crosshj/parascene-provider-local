"use strict";

/**
 * Flatten a Comfy desktop workflow (nodes/links + subgraphs) to /prompt API JSON.
 * Drops notes, GemmaAPITextEncode, api-key widgets, and HuggingFace download nodes.
 */
const fs = require("fs");

const SKIP_TYPES = new Set([
  "MarkdownNote",
  "Note",
  "GemmaAPITextEncode",
]);

const CONTROL_WIDGETS = new Set([
  "fixed",
  "randomize",
  "increment",
  "decrement",
  "increment-wrap",
  "decrement-wrap",
]);

const HF_RE = /huggingface\.co/i;
const API_KEY_RE = /ltx_api_key|api_key|has ltxv api key/i;
const DOWNLOAD_RE = /huggingface|downloadandload|download.?model/i;

function subgraphById(definitions) {
  const map = new Map();
  const list = definitions?.subgraphs || [];
  const arr = Array.isArray(list) ? list : Object.values(list);
  for (const sg of arr) {
    if (sg?.id) map.set(String(sg.id), sg);
  }
  return map;
}

function widgetNames(node) {
  const names = [];
  for (const inp of node.inputs || []) {
    if (inp?.widget?.name) names.push(inp.widget.name);
    else if (inp?.widget && inp.name) names.push(inp.name);
  }
  return names;
}

const PRIMITIVE_VALUE_TYPES = new Set([
  "PrimitiveStringMultiline",
  "PrimitiveString",
  "PrimitiveFloat",
  "PrimitiveInt",
  "PrimitiveBoolean",
]);

const KNOWN_WIDGET_MAPS = {
  LoadImage: ["image"],
  LoadVideo: ["file"],
  LoadAudio: ["audio"],
  SaveAudioAdvanced: ["filename_prefix", "format", "quality"],
  SaveVideo: ["filename_prefix", "format"],
  SaveAudio: ["filename_prefix"],
};

function widgetValues(node) {
  const type = String(node.type || "");
  const names = widgetNames(node);
  const values = Array.isArray(node.widgets_values) ? node.widgets_values : [];
  const out = {};
  if (!names.length && PRIMITIVE_VALUE_TYPES.has(type) && values.length) {
    const v = values[0];
    if (v !== undefined && typeof v !== "object") out.value = v;
    return out;
  }
  const mapped = names.length ? names : KNOWN_WIDGET_MAPS[type] || [];
  let wi = 0;
  for (const name of mapped) {
    while (wi < values.length && typeof values[wi] === "object") wi += 1;
    if (wi >= values.length) break;
    const v = values[wi++];
    if (typeof v === "string" && CONTROL_WIDGETS.has(v)) continue;
    if (v !== undefined && typeof v !== "object") out[name] = v;
  }
  return out;
}

function topLinks(desktop) {
  const byId = new Map();
  for (const link of desktop.links || []) {
    if (Array.isArray(link)) {
      byId.set(link[0], {
        from: String(link[1]),
        fromSlot: link[2],
        to: String(link[3]),
        toSlot: link[4],
      });
    } else if (link && typeof link === "object") {
      byId.set(link.id, {
        from: String(link.origin_id),
        fromSlot: link.origin_slot,
        to: String(link.target_id),
        toSlot: link.target_slot,
      });
    }
  }
  return byId;
}

function subgraphLinks(sg) {
  return (sg.links || []).map((link) => {
    if (Array.isArray(link)) {
      return {
        from: String(link[1]),
        fromSlot: link[2],
        to: String(link[3]),
        toSlot: link[4],
      };
    }
    return {
      from: String(link.origin_id),
      fromSlot: link.origin_slot,
      to: String(link.target_id),
      toSlot: link.target_slot,
    };
  });
}

function prefixId(prefix, id) {
  return prefix ? `${prefix}:${id}` : String(id);
}

function shouldSkipNode(node) {
  const type = String(node.type || "");
  const title = String(node.title || node.properties?.["Node name for S&R"] || "");
  if (SKIP_TYPES.has(type)) return true;
  if (DOWNLOAD_RE.test(type) || DOWNLOAD_RE.test(title)) return true;
  if (API_KEY_RE.test(title) && /boolean|stringcontains|primitive/i.test(type)) {
    return true;
  }
  const values = JSON.stringify(node.widgets_values || []);
  if (HF_RE.test(values) && /download|url/i.test(type + title)) return true;
  return false;
}

function convertNode(node, widgets) {
  const inputs = { ...widgets };
  return {
    inputs,
    class_type: String(node.type),
    _meta: { title: node.title || node.type },
  };
}

function flatten(desktop) {
  const sgs = subgraphById(desktop.definitions);
  const links = topLinks(desktop);
  const out = {};
  const outputMap = new Map(); // `${instanceId}:${slot}` -> [srcId, srcSlot]
  const rerouteMap = new Map();

  function addNode(id, node) {
    if (shouldSkipNode(node)) return;
    if (node.type === "Reroute") {
      rerouteMap.set(String(id), null);
      return;
    }
    out[String(id)] = convertNode(node, widgetValues(node));
  }

  function resolveInstanceInput(instance, slot, parentPrefix) {
    const inp = (instance.inputs || [])[slot];
    if (!inp) return null;
    if (inp.link != null && links.has(inp.link)) {
      const src = links.get(inp.link);
      return resolveSource(src.from, src.fromSlot, parentPrefix);
    }
    const widgets = widgetValues(instance);
    const name = inp.widget?.name || inp.name;
    if (name && widgets[name] !== undefined) {
      return { literal: widgets[name], name };
    }
    return null;
  }

  function resolveSource(fromId, fromSlot, parentPrefix) {
    const raw = String(fromId);
    const key = `${raw}:${fromSlot}`;
    if (outputMap.has(key)) return outputMap.get(key);
    const mapped = parentPrefix ? prefixId(parentPrefix, raw) : raw;
    if (rerouteMap.has(mapped) && rerouteMap.get(mapped)) {
      return rerouteMap.get(mapped);
    }
    return [mapped, fromSlot];
  }

  const pendingWires = [];

  function applyLiteral(dest, destName, destType, lit) {
    if (!dest || !destName || API_KEY_RE.test(destName)) return;
    const typeOk =
      !destType ||
      destType === "*" ||
      (destType === "BOOLEAN" && typeof lit === "boolean") ||
      (destType === "INT" && Number.isFinite(Number(lit))) ||
      (destType === "FLOAT" && Number.isFinite(Number(lit))) ||
      (destType === "STRING" && typeof lit === "string") ||
      (destType === "COMBO" && typeof lit === "string");
    if (!typeOk) return;
    dest.inputs[destName] =
      destType === "INT" || destType === "FLOAT" ? Number(lit) : lit;
  }

  function applyLink(destId, destName, src) {
    if (rerouteMap.has(destId)) {
      rerouteMap.set(destId, src);
      return;
    }
    const dest = out[destId];
    if (dest && destName && Array.isArray(src) && !API_KEY_RE.test(destName)) {
      dest.inputs[destName] = src;
    }
  }

  function inlineSubgraph(instance, sg, prefix) {
    const innerPrefix = prefix ? `${prefix}:${instance.id}` : String(instance.id);
    const inputNodeId = String(sg.inputNode?.id ?? -10);
    const outputNodeId = String(sg.outputNode?.id ?? -20);

    for (const node of sg.nodes || []) {
      if (sgs.has(String(node.type))) {
        inlineSubgraph(node, sgs.get(String(node.type)), innerPrefix);
      } else {
        addNode(prefixId(innerPrefix, node.id), node);
      }
    }

    for (const link of subgraphLinks(sg)) {
      const destNode = (sg.nodes || []).find((n) => String(n.id) === String(link.to));
      const destName = destNode?.inputs?.[link.toSlot]?.name;
      const destType = destNode?.inputs?.[link.toSlot]?.type;
      const destId = prefixId(innerPrefix, link.to);

      if (link.from === inputNodeId) {
        pendingWires.push({
          kind: "instance-input",
          instance,
          prefix,
          slot: link.fromSlot,
          destId,
          destName,
          destType,
        });
        continue;
      }

      const src = resolveSource(link.from, link.fromSlot, innerPrefix);
      if (link.to === outputNodeId) {
        outputMap.set(`${instance.id}:${link.toSlot}`, src);
        outputMap.set(`${innerPrefix}:${link.toSlot}`, src);
        continue;
      }
      applyLink(destId, destName, src);
    }
  }

  for (const node of desktop.nodes || []) {
    if (sgs.has(String(node.type))) {
      inlineSubgraph(node, sgs.get(String(node.type)), "");
    } else {
      addNode(String(node.id), node);
    }
  }

  for (const wire of pendingWires) {
    const src = resolveInstanceInput(wire.instance, wire.slot, wire.prefix);
    if (!src) continue;
    if (src.literal !== undefined) {
      applyLiteral(out[wire.destId], wire.destName, wire.destType, src.literal);
      continue;
    }
    applyLink(wire.destId, wire.destName, src);
  }

  // Top-level links between non-subgraph nodes
  for (const node of desktop.nodes || []) {
    for (const inp of node.inputs || []) {
      if (inp.link == null || !links.has(inp.link)) continue;
      const src0 = links.get(inp.link);
      const src = resolveSource(src0.from, src0.fromSlot, "");
      const destId = String(node.id);
      if (sgs.has(String(node.type))) continue;
      applyLink(destId, inp.name, src);
    }
  }

  // Drop leftover api-key fields and dead Gemma refs
  for (const node of Object.values(out)) {
    for (const key of Object.keys(node.inputs)) {
      if (API_KEY_RE.test(key)) delete node.inputs[key];
      const val = node.inputs[key];
      if (Array.isArray(val) && !out[val[0]]) delete node.inputs[key];
    }
  }

  // Force local prompt path on leftover switches that lost a Gemma input
  for (const node of Object.values(out)) {
    if (node.class_type !== "ComfySwitchNode") continue;
    if (!node.inputs.on_true || !out[node.inputs.on_true[0]]) {
      if (node.inputs.on_false) {
        node.inputs.switch = false;
      }
    }
  }

  // SaveAudioAdvanced → mp3
  for (const node of Object.values(out)) {
    if (node.class_type === "SaveAudioAdvanced") {
      node.inputs.format = "mp3";
    }
  }

  return out;
}

function main() {
  const [, , src, dest] = process.argv;
  if (!src || !dest) {
    console.error("usage: node scripts/comfy-desktop-to-api.js <src> <dest>");
    process.exit(1);
  }
  const desktop = JSON.parse(fs.readFileSync(src, "utf8"));
  const api = flatten(desktop);
  fs.writeFileSync(dest, `${JSON.stringify(api, null, 2)}\n`);
  const types = {};
  for (const n of Object.values(api)) {
    types[n.class_type] = (types[n.class_type] || 0) + 1;
  }
  console.log(`${src} -> ${dest} (${Object.keys(api).length} nodes)`);
  console.log(
    "  types:",
    Object.entries(types)
      .map(([t, c]) => `${t}(${c})`)
      .join(", "),
  );
}

if (require.main === module) main();

module.exports = { flatten };
