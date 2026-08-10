import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "next/server") {
    return nextResolve("next/server.js", context);
  }

  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
    if (
      error?.code !== "ERR_MODULE_NOT_FOUND" ||
      !isRelative ||
      extname(specifier)
    ) {
      throw error;
    }

    return nextResolve(`${specifier}.ts`, context);
  }
}

export async function load(url, context, nextLoad) {
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
