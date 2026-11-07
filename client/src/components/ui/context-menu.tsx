import type { ComponentProps } from "react";
import * as Primitive from "@radix-ui/react-context-menu";
import { cn } from "@/lib/utils";
export const ContextMenu = Primitive.Root;
export const ContextMenuTrigger = Primitive.Trigger;
export function ContextMenuContent({
  className,
  ...props
}: ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        {...props}
        className={cn(
          "z-[300] min-w-44 rounded-md border bg-popover p-1 text-popover-foreground shadow-lg",
          className
        )}
      />
    </Primitive.Portal>
  );
}
export function ContextMenuItem({
  className,
  ...props
}: ComponentProps<typeof Primitive.Item>) {
  return (
    <Primitive.Item
      {...props}
      className={cn(
        "flex cursor-default select-none items-center rounded px-2 py-2 text-sm outline-none focus:bg-accent data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className
      )}
    />
  );
}
export function ContextMenuSeparator(
  props: ComponentProps<typeof Primitive.Separator>
) {
  return (
    <Primitive.Separator
      {...props}
      className={cn("my-1 h-px bg-border", props.className)}
    />
  );
}
