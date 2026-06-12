import * as React from "react";

import { cn } from "@/lib/utils";

function Logo({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <svg
      viewBox="0 0 471 89"
      fill="none"
      aria-label="Joyco"
      className={cn("h-8 w-auto", className)}
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        d="M33.4072 0.461909L2.37382e-06 33.8691L0 88.1758L72.626 88.1758L110.944 48.7129L110.944 88.1758L143.732 88.1758L143.732 40.7207L111.992 40.7207L93.6191 59.3682L93.6191 59.3691L23.2139 59.3691L23.2148 33.4902L109.626 33.4902L143.732 0.520508L143.732 0.461914L33.4072 0.461909Z"
        fill="currentColor"
      />
      <path
        d="M470.962 28.0098H394.123V62.3711L415.214 41.2793H471V69.2891H394.123V88.4238H360.436V0.0585938H364.084V0H470.962V28.0098Z"
        fill="currentColor"
      />
      <path
        d="M190.489 84.8682L217.911 57.8496H250.618V88.2949H156.999V0.00390625H190.489V84.8682Z"
        fill="currentColor"
      />
      <path
        d="M348.05 33.9082H301V88.0039H268V57.2803L291.372 33.9082H219.796V0.00195312H348.05V33.9082ZM300.731 30.9609V0.00292969H270.511L300.731 30.9609Z"
        fill="currentColor"
      />
    </svg>
  );
}

export { Logo };
