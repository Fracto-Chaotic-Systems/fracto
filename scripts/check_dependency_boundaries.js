import path from "node:path";
import { audit_dependency_boundaries } from "./dependency_boundaries.js";

const root = path.resolve(import.meta.dirname, "..");
const findings = audit_dependency_boundaries(root);
for (const item of findings)
  console.log(`${item.file}:${item.line}: ${item.reason} (${item.specifier})`);
console.log(`Dependency audit: ${findings.length} violation(s).`);
if (findings.length && !process.argv.includes("--report")) process.exitCode = 1;
