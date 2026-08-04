import fs from "fs";
import path from "path";

export function repoPath(...parts: string[]) {
  return path.resolve(process.cwd(), ...parts);
}

export function readRepoSources(...relativePaths: string[]) {
  return relativePaths
    .map(relativePath => fs.readFileSync(repoPath(relativePath), "utf-8"))
    .join("\n");
}
