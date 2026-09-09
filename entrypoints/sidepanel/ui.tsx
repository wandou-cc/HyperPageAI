import type { ReactElement } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface IconTooltipProps {
  label: string;
  disabled?: boolean;
  children: ReactElement;
}

// Adds an accessible delayed label to compact icon-only controls.
export function IconTooltip({ label, disabled = false, children }: IconTooltipProps) {
  return (
    <Tooltip>
      {disabled ? (
        <TooltipTrigger render={<span className="inline-flex w-fit" />}>
          {children}
        </TooltipTrigger>
      ) : (
        <TooltipTrigger render={children} />
      )}
      <TooltipContent sideOffset={6}>{label}</TooltipContent>
    </Tooltip>
  );
}
