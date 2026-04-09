import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Sparkles } from "lucide-react";

interface SopStep {
  title?: string;
  action?: string;
  detail?: string;
  tip?: string;
}

interface SopData {
  title?: string;
  level?: string;
  businessModule?: string;
  applicableScenarios?: string;
  preconditions?: string | string[];
  steps?: SopStep[];
  tags?: string[];
}

interface SopContentRendererProps {
  extractedContent?: string | null;
}

/**
 * Renders structured SOP content from JSON stored in extractedContent field.
 * Falls back gracefully if content is not valid SOP JSON.
 */
export function SopContentRenderer({ extractedContent }: SopContentRendererProps) {
  if (!extractedContent) return null;

  let sop: SopData | null = null;
  try {
    const parsed = JSON.parse(extractedContent);
    if (parsed && parsed.title && (parsed.steps || parsed.applicableScenarios)) {
      sop = parsed as SopData;
    }
  } catch {
    return null;
  }

  if (!sop) return null;

  const preconditionsList = sop.preconditions
    ? Array.isArray(sop.preconditions)
      ? sop.preconditions
      : [sop.preconditions]
    : [];

  return (
    <Card className="border-orange-200 bg-orange-50/30">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
          <Sparkles className="h-4 w-4 text-orange-500" />
          标准SOP内容
          {sop.level && (
            <Badge variant="outline" className="text-xs">{sop.level}</Badge>
          )}
          {sop.businessModule && (
            <Badge variant="outline" className="text-xs">{sop.businessModule}</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {sop.applicableScenarios && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-1 uppercase tracking-wide">适用场景</p>
            <p className="text-sm">{sop.applicableScenarios}</p>
          </div>
        )}

        {preconditionsList.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-1 uppercase tracking-wide">前置条件</p>
            <ul className="space-y-1">
              {preconditionsList.map((p, i) => (
                <li key={i} className="text-sm flex gap-2">
                  <span className="text-orange-500 font-medium flex-shrink-0">{i + 1}.</span>
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {sop.steps && sop.steps.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
              操作步骤（共{sop.steps.length}步）
            </p>
            <div className="space-y-3">
              {sop.steps.map((step, i) => (
                <div key={i} className="flex gap-3">
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-orange-500 text-white text-xs flex items-center justify-center font-medium">
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{step.title || step.action}</p>
                    {step.detail && (
                      <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{step.detail}</p>
                    )}
                    {step.tip && (
                      <p className="text-xs text-orange-600 mt-1 italic bg-orange-50 rounded px-2 py-1">
                        💡 {step.tip}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Returns true if the given string is valid SOP JSON content
 */
export function isSopContent(extractedContent?: string | null): boolean {
  if (!extractedContent) return false;
  try {
    const parsed = JSON.parse(extractedContent);
    return !!(parsed && parsed.title && (parsed.steps || parsed.applicableScenarios));
  } catch {
    return false;
  }
}
