import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("next/") && !extname(specifier)) {
    return nextResolve(`${specifier}.js`, context);
  }

  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
    if (
      (error?.code !== "ERR_MODULE_NOT_FOUND" && error?.code !== "ERR_UNSUPPORTED_DIR_IMPORT") ||
      !isRelative ||
      extname(specifier)
    ) {
      throw error;
    }

    if (error?.code === "ERR_UNSUPPORTED_DIR_IMPORT") {
      return nextResolve(`${specifier}/index.js`, context);
    }

    try {
      return await nextResolve(`${specifier}.js`, context);
    } catch (javascriptError) {
      if (javascriptError?.code !== "ERR_MODULE_NOT_FOUND") throw javascriptError;
      return nextResolve(`${specifier}.ts`, context);
    }
  }
}

export async function load(url, context, nextLoad) {
  if (url.startsWith("file:") && extname(fileURLToPath(url)) === ".json") {
    const source = await readFile(fileURLToPath(url), "utf8");
    return {
      format: "module",
      source: `export default ${source.trim()};`,
      shortCircuit: true,
    };
  }
  if (!url.startsWith("file:") || extname(fileURLToPath(url)) !== ".ts") {
    return nextLoad(url, context);
  }

  const fileName = fileURLToPath(url);
  const source = await readFile(fileName, "utf8");
  const compiled = ts.transpileModule(source, {
    fileName,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      verbatimModuleSyntax: true,
    },
  });

  return { format: "module", source: compiled.outputText, shortCircuit: true };
}
