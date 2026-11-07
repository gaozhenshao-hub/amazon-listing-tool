import type { ComponentProps } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./dialog";
import { cn } from "@/lib/utils";
export const Sheet = Dialog;
export const SheetTitle = DialogTitle;
export function SheetHeader(props: ComponentProps<typeof DialogHeader>) {
  return (
    <DialogHeader
      {...props}
      className={cn("border-b px-5 py-5 pr-12", props.className)}
    />
  );
}
export function SheetContent({
  className,
  ...props
}: ComponentProps<typeof DialogContent>) {
  return (
    <DialogContent
      aria-describedby={undefined}
      {...props}
      className={cn(
        "inset-y-0 right-0 left-auto top-0 block h-dvh w-full max-w-full translate-x-0 translate-y-0 overflow-y-auto rounded-none border-l p-0 sm:max-w-md",
        className
      )}
    />
  );
}
