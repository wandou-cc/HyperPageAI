import * as React from "react"

const PortalContainerContext = React.createContext<
  HTMLElement | ShadowRoot | undefined
>(undefined)

function PortalContainerProvider({
  container,
  children,
}: {
  container: HTMLElement | ShadowRoot
  children: React.ReactNode
}) {
  return (
    <PortalContainerContext.Provider value={container}>
      {children}
    </PortalContainerContext.Provider>
  )
}

function usePortalContainer() {
  return React.useContext(PortalContainerContext)
}

export { PortalContainerProvider, usePortalContainer }
