import * as Utility from './utility.js'

export function ParseMaterials(mtlText, basePath) {
  let materials = {};
  let lines = mtlText.split('\n');
  let urls = new Set();
  let scalarTokens = new Set(["ns", "ni", "d", "illum", "dielectric", "ior"]);
  let vectorTokens = new Set(["ka", "kd", "kem", "ks", "ke", "pr", "pm", "pmr", "pmr_swizzle"]);
  let stringTokens = new Set(["map_bump", "map_kd", "map_kem", "map_ks", "map_d", "map_ns", "map_pmr"]);
  let mtlName = null;
  lines.forEach((line) => {
    let tokens = line.trim().split(/[ ]+/);
    let key = tokens[0].toLowerCase();
    if (key === 'newmtl') {
      mtlName = tokens[1];
      materials[mtlName] = {};
    }
    if (mtlName) {
      let value;
      let isUrl = false;

      if (scalarTokens.has(key)) {
        value = parseFloat(tokens[1])
      } else if (vectorTokens.has(key)) {
        value = tokens.splice(1, Infinity).map(parseFloat)
      } else if (stringTokens.has(key)) {
        value = tokens[1];
        isUrl = true;
      }

      if (value) {
        if (isUrl) {
          urls.add(basePath + '/' + value);
        }
        materials[mtlName][key] = value;
      }
    }
  });

  return { materials: materials, urls: urls };
}