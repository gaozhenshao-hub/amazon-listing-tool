// Shared helpers for keyword router modules

// Helper: build product context string for AI prompts
export function buildProductContext(project: any): string {
  const parts: string[] = [];
  if (project.name) parts.push(`Product: ${project.name}`);
  if (project.brand) parts.push(`Brand: ${project.brand}`);
  if (project.productName) parts.push(`Product Name: ${project.productName}`);
  if (project.category) parts.push(`Category: ${project.category}`);
  if (project.targetMarket) parts.push(`Target Market: ${project.targetMarket}`);
  if (project.productFeatures) {
    try {
      const features = JSON.parse(project.productFeatures);
      parts.push(`Features: ${features.join(", ")}`);
    } catch { /* ignore */ }
  }
  return parts.join("\n");
}

// Helper: chunk array for batch AI processing
export function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
