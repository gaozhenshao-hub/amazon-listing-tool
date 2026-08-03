import path from "path";

export function repoPath(...parts: string[]) {
  return path.resolve(process.cwd(), ...parts);
}
