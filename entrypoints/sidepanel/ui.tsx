import type { ReactElement } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface IconTooltipProps {
  label: string;
  children: ReactElement;
}

// Adds an accessible delayed label to compact icon-only controls.
export function IconTooltip({ label, children }: IconTooltipProps) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent sideOffset={6}>{label}</TooltipContent>
    </Tooltip>
  );
}
