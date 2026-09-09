import { Menu } from "@base-ui/react/menu";
import { usePortalContainer } from "@/components/ui/portal-container";
import { cn } from "@/lib/utils";

const DropdownMenu = Menu.Root;
const DropdownMenuTrigger = Menu.Trigger;
const DropdownMenuGroup = Menu.Group;

function DropdownMenuContent({
  className,
  side = "bottom",
  align = "start",
  ...props
}: Menu.Popup.Props & Pick<Menu.Positioner.Props, "side" | "align">) {
  const container = usePortalContainer();
  return (
    <Menu.Portal container={container}>
      <Menu.Positioner side={side} align={align} sideOffset={6} className="isolate z-50 outline-none">
        <Menu.Popup
          data-slot="dropdown-menu-content"
          className={cn("max-h-(--available-height) min-w-44 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md outline-none", className)}
          {...props}
        />
      </Menu.Positioner>
    </Menu.Portal>
  );
}

function DropdownMenuItem({ className, ...props }: Menu.Item.Props) {
  return (
    <Menu.Item
      data-slot="dropdown-menu-item"
      className={cn("flex cursor-default items-center gap-2 rounded-sm px-2 py-2 text-sm outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0", className)}
      {...props}
    />
  );
}

export { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem };
