import type { ImageOutline } from "@shared/imagePlanning";
import { isWhiteBackgroundMain } from "@shared/imagePlanning";
import type { ListingAggregation } from "@shared/listingAggregation";
import { moduleLabels } from "@shared/modulePlanning";
import { resolveQuestionIds } from "@shared/questionMerging";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

type Position = { id: string; label: string; title: string };
export type CoverageGroup = ReturnType<typeof suiteCoverage>[number];

export function suiteCoverage(outline: ImageOutline, data: ListingAggregation) {
  const labels = moduleLabels(outline.groups);
  const positions = outline.groups.flatMap((group, index) =>
    isWhiteBackgroundMain(group)
      ? []
      : group.items.map((item, ordinal) => ({
          item,
          position: {
            id: item.id,
            label: `${labels[index]} · ${ordinal + 1}`,
            title: item.title || "",
          },
          questions: resolveQuestionIds(item.questionIds, data.questions),
        }))
  );
  return [
    { name: "功能", key: "featureIds", nodes: data.features || [] },
    { name: "用户获益", key: "benefitIds", nodes: data.selling },
    {
      name: "好评覆盖",
      key: "reviewIds",
      nodes: data.reviews.filter(node => node.sentiment === "positive"),
    },
    {
      name: "差评规避",
      key: "reviewIds",
      nodes: data.reviews.filter(node => node.sentiment === "negative"),
    },
    { name: "买家问题", key: "questionIds", nodes: data.questions },
  ].map(({ name, key, nodes }) => ({
    name,
    rows: nodes
      .map(node => ({
        id: node.id,
        label: node.text,
        positions: positions
          .filter(({ item, questions }) =>
            (key === "questionIds"
              ? questions
              : item[key as "featureIds" | "benefitIds" | "reviewIds"]
            ).includes(node.id)
          )
          .map(({ position }) => position),
      }))
      .sort(
        (a, b) =>
          a.positions.length - b.positions.length ||
          a.label.localeCompare(b.label, "zh-CN")
      ),
  }));
}

export function SuiteCoverageDialog({
  groups,
  onClose,
  onLocate,
}: {
  groups: CoverageGroup[];
  onClose: () => void;
  onLocate: (position: Position) => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        className="max-h-[85vh] max-w-4xl overflow-y-auto"
      >
        <DialogTitle>卖点覆盖度</DialogTitle>
        <p className="text-sm text-muted-foreground">
          按已保存的图位关联统计，从 0 个图位开始排列。
        </p>
        {groups.map(group => (
          <section
            key={group.name}
            aria-label={group.name}
            className="space-y-2"
          >
            <h3 className="font-semibold">{group.name}</h3>
            {group.rows.length ? (
              <table className="w-full table-fixed border-collapse text-left text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="w-2/5 p-2">标签</th>
                    <th className="p-2">关联图位</th>
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map(row => (
                    <tr key={row.id} className="border-b">
                      <td className="break-words p-2 align-top">{row.label}</td>
                      <td className="p-2">
                        <span className="mr-2 text-xs text-muted-foreground">
                          {row.positions.length} 个图位
                        </span>
                        {row.positions.map(position => (
                          <Button
                            key={position.id}
                            variant="link"
                            size="sm"
                            className="h-auto p-1"
                            title={position.title}
                            onClick={() => onLocate(position)}
                          >
                            {position.label}
                          </Button>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-sm text-muted-foreground">
                当前还没有此类标签。
              </p>
            )}
          </section>
        ))}
      </DialogContent>
    </Dialog>
  );
}
