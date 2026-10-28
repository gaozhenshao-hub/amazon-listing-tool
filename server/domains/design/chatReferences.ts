import { jsonValue } from "./repository";

// Rows arrive newest first. An explicit reset is a durable boundary, including
// an empty set; old conversations are recovered from all earlier turns.
export function collectChatReferences(
  turns: any[],
  incoming: string[],
  replace = false
) {
  if (replace) return [...new Set(incoming)];
  const relevant = [];
  for (const turn of turns) {
    relevant.push(turn);
    if (jsonValue<any>(turn.params, {}).chatReferenceReset) break;
  }
  return [
    ...new Set([
      ...relevant
        .reverse()
        .flatMap(turn => [
          ...jsonValue<string[]>(turn.referenceIds, []),
          ...(jsonValue<any>(turn.plan, {})?.referenceIds || []),
        ]),
      ...incoming,
    ]),
  ];
}
