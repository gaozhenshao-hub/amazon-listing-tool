export const manualTextClass = (manual?: boolean) =>
  manual ? " !bg-amber-100 !text-amber-950" : "";

export function ManualText({
  text,
  manual,
}: {
  text: string;
  manual?: boolean;
}) {
  return manual ? (
    <mark className="rounded-sm bg-amber-100 text-amber-950">{text}</mark>
  ) : (
    <>{text}</>
  );
}

export function manuallyEdited(
  item: { manual?: boolean; manualFields?: string[] },
  field: string
) {
  return item.manualFields?.length
    ? item.manualFields.includes(field)
    : !!item.manual;
}
